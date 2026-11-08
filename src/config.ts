import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface AppConfig {
  root: string;
  mode: "mock" | "live";
  deepseekBaseUrl: string;
  deepseekModel: string;
  deepseekThinking: "disabled";
  ingressToken: string;
  operatorToken: string;
  mailbox: string;
  host: string;
  port: number;
  dataDir: string;
  knowledgePath: string;
  vaultKey: string;
  deliveryMode: "preview";
  autoReply: "off";
  publicLaunch: "blocked";
  killSwitch: boolean;
  caseTtlDays: number;
  maxModelCalls: number;
  maxToolActions: number;
  maxWallMs: number;
  maxTokens: number;
  maxCostUsd: number;
  senderHourlyLimit: number;
  globalHourlyLimit: number;
  maxRepliesPerThread: number;
  maxTextChars: number;
  maxAttachmentBytes: number;
  maxAttachments: number;
}

function num(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return value;
}

function requiredLiteral<T extends string>(env: NodeJS.ProcessEnv, name: string, allowed: readonly T[], fallback: T): T {
  const raw = (env[name] ?? fallback).trim();
  if (!allowed.includes(raw as T)) {
    throw new Error(`${name} must be one of ${allowed.join(", ")}`);
  }
  return raw as T;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<AppConfig> = {}): AppConfig {
  const thinking = (env.DEEPSEEK_THINKING ?? "disabled").trim();
  if (thinking !== "disabled") {
    throw new Error("DEEPSEEK_THINKING must stay disabled. This demo does not retain reasoning content.");
  }
  const model = (env.DEEPSEEK_MODEL ?? "deepseek-flash").trim();
  if (model !== "deepseek-flash" && model !== "deepseek-v4-pro") {
    throw new Error(
      "DEEPSEEK_MODEL must be deepseek-flash or deepseek-v4-pro. Those are the Chat Completions model ids documented on 2026-11-08. Legacy aliases are not accepted here.",
    );
  }
  const delivery = requiredLiteral(env, "DELIVERY_MODE", ["preview"] as const, "preview");
  const autoReply = requiredLiteral(env, "AUTO_REPLY", ["off"] as const, "off");
  const launch = requiredLiteral(env, "PUBLIC_LAUNCH", ["blocked"] as const, "blocked");
  const mode = requiredLiteral(env, "AGENT_MODE", ["mock", "live"] as const, "mock");
  const config: AppConfig = {
    root,
    mode,
    deepseekBaseUrl: (env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, ""),
    deepseekModel: model,
    deepseekThinking: "disabled",
    ingressToken: env.INGRESS_TOKEN ?? "",
    operatorToken: env.OPERATOR_TOKEN ?? "",
    mailbox: (env.MAILBOX ?? "visa@boshen.dev").trim().toLowerCase(),
    host: env.LISTEN_HOST ?? "127.0.0.1",
    port: num(env, "PORT", 8080),
    dataDir: path.resolve(env.DATA_DIR ?? path.join(root, "data")),
    knowledgePath: path.join(root, "knowledge", "uk", "snapshots.json"),
    vaultKey: env.VAULT_KEY ?? "",
    deliveryMode: delivery,
    autoReply,
    publicLaunch: launch,
    killSwitch: (env.KILL_SWITCH ?? "off").trim() === "on",
    caseTtlDays: num(env, "CASE_TTL_DAYS", 30),
    maxModelCalls: num(env, "MAX_MODEL_CALLS", 6),
    maxToolActions: num(env, "MAX_TOOL_ACTIONS", 8),
    maxWallMs: num(env, "MAX_WALL_MS", 20_000),
    maxTokens: num(env, "MAX_TOKENS", 8_000),
    maxCostUsd: num(env, "MAX_COST_USD", 0.25),
    senderHourlyLimit: num(env, "SENDER_HOURLY_LIMIT", 8),
    globalHourlyLimit: num(env, "GLOBAL_HOURLY_LIMIT", 100),
    maxRepliesPerThread: num(env, "MAX_REPLIES_PER_THREAD", 5),
    maxTextChars: num(env, "MAX_TEXT_CHARS", 20_000),
    maxAttachmentBytes: num(env, "MAX_ATTACHMENT_BYTES", 5_000_000),
    maxAttachments: num(env, "MAX_ATTACHMENTS", 5),
  };
  return { ...config, ...overrides, deliveryMode: "preview", autoReply: "off", publicLaunch: "blocked", deepseekThinking: "disabled" };
}

export const DOCUMENTED_MODELS = ["deepseek-flash", "deepseek-v4-pro"] as const;

/** Peak cache-miss USD per 1M tokens from the DeepSeek pricing page, accessed 2026-11-08. Local ceiling only, not an invoice. */
export const PEAK_CACHE_MISS_USD_PER_MILLION: Record<(typeof DOCUMENTED_MODELS)[number], { input: number; output: number }> = {
  "deepseek-flash": { input: 0.3, output: 1.2 },
  "deepseek-v4-pro": { input: 1.32, output: 3.96 },
};
