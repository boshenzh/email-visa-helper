import { PEAK_CACHE_MISS_USD_PER_MILLION, type AppConfig } from "./config.ts";
import { assertPublicPayload } from "./harness.ts";
import { officialSummary, type OfficialTopic, type Snapshots, OFFICIAL_TOPICS } from "./knowledge.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
}

export interface PublicLoopResult {
  ran: boolean;
  reason: string;
  topic: OfficialTopic | null;
  requests: unknown[];
  explanation: string | null;
  toolNames: string[];
  modelCalls: number;
  stopped: string;
  discardedModelText: boolean;
  reasoningDiscarded: boolean;
  estimatedCostUsd: number;
  error?: string;
}

const SYSTEM = [
  "You explain published UK visitor information.",
  "The user message is only a topic id. There is no person, application, or document in this request.",
  "Call lookup_official with that topic id or another allowlisted topic id.",
  "Write a short general explanation of the tool result.",
  "Do not say that any person qualifies, should apply, or will be approved.",
  "Do not invent fees, times, or rules. If a figure is not in the tool result, say it was not in the snapshot.",
  "State that the wording is AI-generated and is not professional advice.",
].join(" ");

function toolSchema() {
  return [
    {
      type: "function",
      function: {
        name: "lookup_official",
        description: "Read one public UK visitor snapshot. The topic id must be one of the enum values.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            topic: {
              type: "string",
              enum: [...OFFICIAL_TOPICS],
            },
          },
          required: ["topic"],
        },
      },
    },
  ];
}

export function priceUsd(model: string, inputTokens: number, outputTokens: number): number {
  if (model !== "deepseek-flash" && model !== "deepseek-v4-pro") {
    throw new Error("No published price for this model id. Refusing to estimate one.");
  }
  const price = PEAK_CACHE_MISS_USD_PER_MILLION[model];
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

export function buildChatBody(config: AppConfig, messages: ChatMessage[]): Record<string, unknown> {
  const body = {
    model: config.deepseekModel,
    messages,
    tools: toolSchema(),
    tool_choice: "auto",
    thinking: { type: "disabled" as const },
    stream: false,
  };
  assertPublicPayload(JSON.stringify(body));
  return body;
}

export function acceptGeneralExplanation(text: string, snapshots: Snapshots): { ok: true; text: string } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(trimmed)) return { ok: false, reason: "identifier" };
  if (/\b(you qualify|you are eligible|you should apply|you will be approved|you are approved|you need a visa|i recommend you|based on your nationality|your application will)\b/i.test(trimmed)) {
    return { ok: false, reason: "personal_conclusion" };
  }
  const allowed = new Set<number>(Object.values(snapshots.feesGbp));
  for (const match of trimmed.matchAll(/£\s?(\d+(?:\.\d+)?)/g)) {
    if (!allowed.has(Number(match[1]))) return { ok: false, reason: "unstated_fee" };
  }
  return { ok: true, text: trimmed };
}

/**
 * Bounded Chat Completions tool loop. The only user text is `topic: <id>`.
 * Tool results are official snapshots. reasoning_content is dropped and not returned.
 */
export async function runPublicTopicLoop(input: {
  topic: OfficialTopic;
  config: AppConfig;
  apiKey: string;
  transport: typeof fetch;
  snapshots: Snapshots;
  secrets?: readonly string[];
  now?: () => number;
}): Promise<PublicLoopResult> {
  const empty = (reason: string, stopped: string, extra: Partial<PublicLoopResult> = {}): PublicLoopResult => ({
    ran: false,
    reason,
    topic: input.topic,
    requests: [],
    explanation: null,
    toolNames: [],
    modelCalls: 0,
    stopped,
    discardedModelText: false,
    reasoningDiscarded: false,
    estimatedCostUsd: 0,
    ...extra,
  });
  if (!input.apiKey.trim()) {
    return empty("no_api_key", "live_test_blocked", {
      error: "DEEPSEEK_API_KEY is not in this process. Do not paste it into chat or source.",
    });
  }
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `topic: ${input.topic}` },
  ];
  const requests: unknown[] = [];
  const toolNames: string[] = [];
  let estimatedCostUsd = 0;
  let reportedTokens = 0;
  let reasoningDiscarded = false;
  let discardedModelText = false;
  const started = (input.now ?? Date.now)();
  const clock = input.now ?? Date.now;
  let modelCalls = 0;
  while (modelCalls < input.config.maxModelCalls) {
    if (clock() - started >= input.config.maxWallMs) {
      return { ...empty("wall_clock", "wall_clock"), ran: requests.length > 0, requests, toolNames, modelCalls, reasoningDiscarded, estimatedCostUsd };
    }
    if (estimatedCostUsd >= input.config.maxCostUsd) {
      return { ...empty("cost_cap", "cost_cap"), ran: true, requests, toolNames, modelCalls, reasoningDiscarded, estimatedCostUsd };
    }
    if (reportedTokens >= input.config.maxTokens) {
      return { ...empty("token_budget", "token_budget"), ran: true, requests, toolNames, modelCalls, reasoningDiscarded, estimatedCostUsd };
    }
    let body: Record<string, unknown>;
    try {
      body = buildChatBody(input.config, messages);
      assertPublicPayload(JSON.stringify(body), input.secrets ?? []);
      if (messages[1]?.content !== `topic: ${input.topic}`) {
        return empty("payload_blocked", "payload_blocked", { error: "user message is not a topic id", requests, modelCalls, reasoningDiscarded, estimatedCostUsd });
      }
    } catch (error) {
      return empty("payload_blocked", "payload_blocked", {
        error: error instanceof Error ? error.message : "blocked",
        requests,
        modelCalls,
        reasoningDiscarded,
        estimatedCostUsd,
        ran: requests.length > 0,
      });
    }
    requests.push(body);
    modelCalls += 1;
    let response: DeepSeekResponse;
    try {
      response = await postWithRetries(input.config.deepseekBaseUrl, input.apiKey, body, input.transport);
    } catch (error) {
      return {
        ...empty("provider_failure", "provider_failure", {
          error: error instanceof Error ? error.message : "provider failure",
          requests,
          modelCalls,
          toolNames,
          reasoningDiscarded,
          estimatedCostUsd,
        }),
        ran: true,
      };
    }
    const message = response.choices?.[0]?.message;
    if (!message) {
      return { ...empty("empty", "empty", { requests, modelCalls, toolNames, reasoningDiscarded, estimatedCostUsd }), ran: true };
    }
    if (typeof message.reasoning_content === "string" && message.reasoning_content.length > 0) reasoningDiscarded = true;
    const usage = response.usage ?? {};
    const inTokens = usage.prompt_tokens ?? 0;
    const outTokens = usage.completion_tokens ?? 0;
    reportedTokens += inTokens + outTokens;
    estimatedCostUsd += priceUsd(input.config.deepseekModel, inTokens, outTokens);
    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      const content = typeof message.content === "string" ? message.content : "";
      const accepted = acceptGeneralExplanation(content, input.snapshots);
      if (!accepted.ok) {
        return {
          ran: true,
          reason: "output_rejected",
          topic: input.topic,
          requests,
          explanation: null,
          toolNames,
          modelCalls,
          stopped: "output_rejected",
          discardedModelText: true,
          reasoningDiscarded,
          estimatedCostUsd,
          error: accepted.reason,
        };
      }
      return {
        ran: true,
        reason: "explained",
        topic: input.topic,
        requests,
        explanation: accepted.text,
        toolNames,
        modelCalls,
        stopped: "completed",
        discardedModelText: false,
        reasoningDiscarded,
        estimatedCostUsd,
      };
    }
    if (toolNames.length + toolCalls.length > input.config.maxToolActions) {
      return { ...empty("tool_budget", "tool_budget"), ran: true, requests, toolNames, modelCalls, reasoningDiscarded, discardedModelText, estimatedCostUsd };
    }
    messages.push({
      role: "assistant",
      content: typeof message.content === "string" ? message.content : null,
      tool_calls: toolCalls.map((call) => ({
        id: String(call.id),
        type: "function" as const,
        function: { name: String(call.function?.name ?? ""), arguments: String(call.function?.arguments ?? "{}") },
      })),
    });
    for (const call of toolCalls) {
      const name = String(call.function?.name ?? "");
      toolNames.push(name === "lookup_official" ? name : "rejected");
      let summary = "rejected";
      if (name === "lookup_official") {
        summary = officialSummary(input.snapshots, parseTopic(call.function?.arguments));
      }
      messages.push({ role: "tool", tool_call_id: String(call.id), content: summary });
    }
  }
  return { ...empty("model_budget", "model_budget"), ran: true, requests, toolNames, modelCalls, reasoningDiscarded, estimatedCostUsd };
}

export async function runSyntheticPublicAdapter(input: {
  config: AppConfig;
  apiKey: string;
  fetchImpl: typeof fetch;
  lookup?: (topic: OfficialTopic) => string;
  now?: () => number;
}): Promise<{
  modelRequests: unknown[];
  discardedModelText: boolean;
  reasoningDiscarded: boolean;
  estimatedCostUsd: number;
  stopped: string;
  error?: string;
}> {
  const { loadSnapshots } = await import("./knowledge.ts");
  const loop = await runPublicTopicLoop({
    topic: "fees",
    config: input.config,
    apiKey: input.apiKey,
    transport: input.fetchImpl,
    snapshots: loadSnapshots(input.config),
    now: input.now,
  });
  return {
    modelRequests: loop.requests,
    discardedModelText: loop.discardedModelText,
    reasoningDiscarded: loop.reasoningDiscarded,
    estimatedCostUsd: loop.estimatedCostUsd,
    stopped: loop.stopped,
    error: loop.error,
  };
}

function parseTopic(raw: string | undefined): OfficialTopic {
  try {
    const parsed = JSON.parse(raw ?? "{}") as { topic?: string };
    if (OFFICIAL_TOPICS.includes(parsed.topic as OfficialTopic)) return parsed.topic as OfficialTopic;
  } catch {
    return "checker";
  }
  return "checker";
}

interface DeepSeekResponse {
  choices?: {
    message?: {
      content?: string | null;
      reasoning_content?: string;
      tool_calls?: { id: string; type?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

async function postWithRetries(baseUrl: string, apiKey: string, body: Record<string, unknown>, fetchImpl: typeof fetch): Promise<DeepSeekResponse> {
  let lastError = "request failed";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 429 || response.status >= 500) {
      lastError = `status ${response.status}`;
      continue;
    }
    if (!response.ok) throw new Error(`DeepSeek request failed with ${response.status}`);
    return (await response.json()) as DeepSeekResponse;
  }
  throw new Error(lastError);
}

export function inboundMustNotCallNetwork(): typeof fetch {
  return async () => {
    throw new Error("Inbound processing tried to call the network. That path is blocked.");
  };
}

export function assertNoApplicantLeak(requests: unknown[], secrets: string[]): void {
  assertPublicPayload(JSON.stringify(requests), secrets);
}
