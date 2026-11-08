import type { AppConfig } from "./config.ts";
import { officialSummary, type OfficialTopic, type Snapshots, OFFICIAL_TOPICS } from "./knowledge.ts";
import type { PublicView } from "./types.ts";

export interface Observation {
  tool: string;
  ok: boolean;
  publicSummary: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ModelTurn {
  toolCalls: ToolCall[];
  final: boolean;
  reportedTokens: number;
}

export interface Model {
  complete(view: PublicView, observations: Observation[]): Promise<ModelTurn>;
}

export interface LoopResult {
  observations: Observation[];
  toolNames: string[];
  modelCalls: number;
  reportedTokens: number;
  stopped: "completed" | "tool_budget" | "model_budget" | "token_budget" | "wall_clock";
}

export function publicViewOf(input: {
  category: PublicView["category"];
  purposeBand: PublicView["purposeBand"];
  missing: string[];
  checkerRecorded: boolean;
  reviewFlags: string[];
  synthetic: boolean;
}): PublicView {
  return {
    category: input.category,
    purposeBand: input.purposeBand,
    missing: [...input.missing],
    checkerRecorded: input.checkerRecorded,
    reviewFlags: [...input.reviewFlags],
    synthetic: input.synthetic,
  };
}

export function assertPublicPayload(payload: string, secrets: readonly string[] = []): void {
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(payload)) {
    throw new Error("model payload blocked: email");
  }
  const lowered = payload.toLowerCase();
  for (const phrase of ["immigration status", "account number", "sort code", "vault.json", "raw email"]) {
    if (lowered.includes(phrase)) throw new Error(`model payload blocked: ${phrase}`);
  }
  for (const secret of secrets) {
    if (secret.trim().length >= 4 && payload.includes(secret)) throw new Error("model payload blocked: applicant value");
  }
}

export class LocalPolicyModel implements Model {
  async complete(view: PublicView, observations: Observation[]): Promise<ModelTurn> {
    const called = new Set(observations.filter((item) => item.ok).map((item) => item.tool));
    const call = (name: string, args: Record<string, unknown> = {}): ModelTurn => ({
      final: false,
      reportedTokens: 50,
      toolCalls: [{ id: `local-${name}`, name, arguments: args }],
    });
    if (view.category === "OUT_OF_SCOPE") return { final: true, toolCalls: [], reportedTokens: 20 };
    if (!called.has("lookup_official")) {
      const topic: OfficialTopic = view.purposeBand === "transit" ? "routes" : view.reviewFlags.length > 0 ? "checker" : "fees";
      return call("lookup_official", { topic });
    }
    if (!called.has("list_gaps")) return call("list_gaps");
    if (view.category === "REGULATED_REVIEW_REQUIRED" && !called.has("flag_review")) return call("flag_review");
    if (view.category === "CLERICAL_APPLICANT_CONTROLLED" && !called.has("build_worksheet")) return call("build_worksheet");
    return { final: true, toolCalls: [], reportedTokens: 20 };
  }
}

export async function runLoop(input: {
  view: PublicView;
  model: Model;
  config: AppConfig;
  now?: () => number;
  snapshots: Snapshots;
  onTool: (name: string, args: Record<string, unknown>) => Observation;
}): Promise<LoopResult> {
  const observations: Observation[] = [];
  const toolNames: string[] = [];
  let modelCalls = 0;
  let reportedTokens = 0;
  const started = (input.now ?? Date.now)();
  const clock = input.now ?? Date.now;
  while (true) {
    if (clock() - started >= input.config.maxWallMs) {
      return { observations, toolNames, modelCalls, reportedTokens, stopped: "wall_clock" };
    }
    if (modelCalls >= input.config.maxModelCalls) {
      return { observations, toolNames, modelCalls, reportedTokens, stopped: "model_budget" };
    }
    if (reportedTokens >= input.config.maxTokens) {
      return { observations, toolNames, modelCalls, reportedTokens, stopped: "token_budget" };
    }
    modelCalls += 1;
    const turn = await input.model.complete(input.view, observations);
    reportedTokens += turn.reportedTokens;
    if (turn.final || turn.toolCalls.length === 0) {
      return { observations, toolNames, modelCalls, reportedTokens, stopped: "completed" };
    }
    for (const call of turn.toolCalls) {
      if (toolNames.length >= input.config.maxToolActions) {
        return { observations, toolNames, modelCalls, reportedTokens, stopped: "tool_budget" };
      }
      const name = allowTool(call.name);
      toolNames.push(name ?? "rejected");
      if (!name) {
        observations.push({ tool: "rejected", ok: false, publicSummary: "Tool rejected. Recipients and shell commands are not available." });
        continue;
      }
      const args = sanitizeArgs(name, call.arguments);
      if (name === "lookup_official") {
        const topic = args.topic as OfficialTopic;
        observations.push({ tool: name, ok: true, publicSummary: officialSummary(input.snapshots, topic) });
        input.onTool(name, args);
        continue;
      }
      observations.push(input.onTool(name, args));
    }
  }
}

function allowTool(name: string): "lookup_official" | "list_gaps" | "build_worksheet" | "flag_review" | null {
  if (name === "lookup_official" || name === "list_gaps" || name === "build_worksheet" || name === "flag_review") return name;
  return null;
}

function sanitizeArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name === "lookup_official") {
    const topic = typeof args.topic === "string" ? args.topic : "";
    if (!OFFICIAL_TOPICS.includes(topic as OfficialTopic)) {
      return { topic: "checker" };
    }
    return { topic };
  }
  return {};
}
