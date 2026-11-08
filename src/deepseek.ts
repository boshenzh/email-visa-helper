import { PEAK_CACHE_MISS_USD_PER_MILLION, type AppConfig } from "./config.ts";
import { assertPublicPayload } from "./harness.ts";
import type { OfficialTopic } from "./knowledge.ts";
import type { PublicView } from "./types.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
}

export interface DeepSeekResult {
  modelRequests: unknown[];
  discardedModelText: boolean;
  reasoningDiscarded: boolean;
  estimatedCostUsd: number;
  stopped: string;
  error?: string;
}

const SYSTEM = [
  "You are a wording assistant for a synthetic demo with no person on file.",
  "You may call lookup_official for a public topic.",
  "Do not ask for or invent identity, travel-document numbers, or contact details.",
  "There is no person described in this request.",
  "Any wording you produce is AI-generated, may be wrong, and is not professional advice.",
].join(" ");

function tools() {
  return [
    {
      type: "function",
      function: {
        name: "lookup_official",
        description: "Read a public UK visitor snapshot by topic id.",
        parameters: {
          type: "object",
          properties: { topic: { type: "string", enum: ["fees", "eta", "documents", "processing", "visitor", "routes", "translations", "identity", "checker"] } },
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
    tools: tools(),
    tool_choice: "auto",
    thinking: { type: "disabled" as const },
    stream: false,
  };
  assertPublicPayload(JSON.stringify(body));
  return body;
}

/**
 * Synthetic public adapter. Inbound mail never calls this.
 * Live HTTP is used only when mode is live, a key is already in the environment,
 * and fetchImpl is the real network. Tests pass a fake fetch.
 * reasoning_content is dropped and is not returned.
 */
export async function runSyntheticPublicAdapter(input: {
  config: AppConfig;
  apiKey: string;
  fetchImpl: typeof fetch;
  lookup: (topic: OfficialTopic) => string;
  now?: () => number;
}): Promise<DeepSeekResult> {
  if (!input.config.mode || input.apiKey.trim() === "") {
    return { modelRequests: [], discardedModelText: false, reasoningDiscarded: false, estimatedCostUsd: 0, stopped: "live_test_blocked", error: "DEEPSEEK_API_KEY is not in this process. Do not paste it into chat or source." };
  }
  const view: PublicView = {
    category: "GENERAL_INFORMATION",
    purposeBand: "ordinary_visitor",
    missing: ["official_checker_result"],
    checkerRecorded: false,
    reviewFlags: [],
    synthetic: true,
  };
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Public view only: ${JSON.stringify(view)}. Choose lookup_official if you need a published fee snapshot.` },
  ];
  const modelRequests: unknown[] = [];
  let estimatedCostUsd = 0;
  let discardedModelText = false;
  let reasoningDiscarded = false;
  let rounds = 0;
  while (rounds < input.config.maxModelCalls) {
    rounds += 1;
    let body: Record<string, unknown>;
    try {
      body = buildChatBody(input.config, messages);
    } catch (error) {
      return { modelRequests, discardedModelText, reasoningDiscarded, estimatedCostUsd, stopped: "payload_blocked", error: error instanceof Error ? error.message : "blocked" };
    }
    if (estimatedCostUsd >= input.config.maxCostUsd) {
      return { modelRequests, discardedModelText, reasoningDiscarded, estimatedCostUsd, stopped: "cost_cap" };
    }
    modelRequests.push(body);
    let response: DeepSeekResponse;
    try {
      response = await postWithRetries(input.config.deepseekBaseUrl, input.apiKey, body, input.fetchImpl);
    } catch (error) {
      return {
        modelRequests,
        discardedModelText,
        reasoningDiscarded,
        estimatedCostUsd,
        stopped: "provider_failure",
        error: error instanceof Error ? error.message : "provider failure",
      };
    }
    const message = response.choices?.[0]?.message;
    if (!message) return { modelRequests, discardedModelText, reasoningDiscarded, estimatedCostUsd, stopped: "empty", error: "no message" };
    if (typeof message.reasoning_content === "string" && message.reasoning_content.length > 0) {
      reasoningDiscarded = true;
    }
    const usage = response.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
    estimatedCostUsd += priceUsd(input.config.deepseekModel, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0);
    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      if (typeof message.content === "string" && message.content.length > 0) discardedModelText = true;
      return { modelRequests, discardedModelText, reasoningDiscarded, estimatedCostUsd, stopped: "completed" };
    }
    messages.push({
      role: "assistant",
      content: typeof message.content === "string" ? message.content : null,
      tool_calls: toolCalls.map((call) => ({
        id: String(call.id),
        type: "function",
        function: { name: String(call.function?.name ?? ""), arguments: String(call.function?.arguments ?? "{}") },
      })),
    });
    for (const call of toolCalls) {
      const name = String(call.function?.name ?? "");
      let summary = "Tool rejected.";
      if (name === "lookup_official") {
        let topic: OfficialTopic = "checker";
        try {
          const parsed = JSON.parse(String(call.function?.arguments ?? "{}")) as { topic?: string };
          if (parsed.topic === "fees" || parsed.topic === "eta" || parsed.topic === "documents" || parsed.topic === "processing" || parsed.topic === "visitor" || parsed.topic === "routes" || parsed.topic === "translations" || parsed.topic === "identity" || parsed.topic === "checker") {
            topic = parsed.topic;
          }
        } catch {
          topic = "checker";
        }
        summary = input.lookup(topic);
      }
      messages.push({ role: "tool", tool_call_id: String(call.id), content: summary });
    }
  }
  return { modelRequests, discardedModelText, reasoningDiscarded, estimatedCostUsd, stopped: "model_budget" };
}

interface DeepSeekResponse {
  choices?: { message?: { content?: string | null; reasoning_content?: string; tool_calls?: { id: string; function?: { name?: string; arguments?: string } }[] } }[];
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
