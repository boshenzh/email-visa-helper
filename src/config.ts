import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeEmail } from "./security.ts";

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
  deepseekApiKey: string;
  deliveryMode: "preview" | "cloudflare" | "resend";
  autoReply: "off" | "general_info" | "all";
  cloudflareAccountId: string;
  cloudflareEmailToken: string;
  resendApiKey: string;
  resendFrom: string;
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
  profile: "dry_run" | "synthetic_test";
  testSenderAllowlist: string[];
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
  const delivery = requiredLiteral(env, "DELIVERY_MODE", ["preview", "cloudflare", "resend"] as const, "preview");
  const autoReply = requiredLiteral(env, "AUTO_REPLY", ["off", "general_info", "all"] as const, "off");
  const launch = requiredLiteral(env, "PUBLIC_LAUNCH", ["blocked"] as const, "blocked");
  const mode = requiredLiteral(env, "AGENT_MODE", ["mock", "live"] as const, "mock");
  const config: AppConfig = {
    root,
    mode,
    deepseekBaseUrl: (env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, ""),
    deepseekModel: model,
    deepseekThinking: "disabled",
    deepseekApiKey: env.DEEPSEEK_API_KEY ?? "",
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
    cloudflareAccountId: env.CLOUDFLARE_ACCOUNT_ID ?? "",
    cloudflareEmailToken: env.CLOUDFLARE_EMAIL_API_TOKEN ?? "",
    resendApiKey: (env.RESEND_API_KEY ?? "").trim(),
    resendFrom: (env.RESEND_FROM ?? "").trim(),
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
    profile: requiredLiteral(env, "DEPLOYMENT_PROFILE", ["dry_run", "synthetic_test"] as const, "dry_run"),
    testSenderAllowlist: parseAllowlist(env.TEST_SENDER_ALLOWLIST),
  };
  const merged = { ...config, ...overrides, publicLaunch: "blocked" as const, deepseekThinking: "disabled" as const };
  assertDeployment(merged);
  return merged;
}

export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "") return [];
  const parts = raw.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  const emails = parts.map((part) => normalizeEmail(part));
  if (emails.some((email) => email.length === 0) || new Set(emails).size !== emails.length) {
    throw new Error("TEST_SENDER_ALLOWLIST must be a comma-separated list of email addresses.");
  }
  return emails;
}

/** Refuses public activation and refuses live model or sending without an explicit test allowlist. */
export function assertDeployment(config: AppConfig): void {
  if (config.publicLaunch !== "blocked") {
    throw new Error("PUBLIC_LAUNCH cannot be opened.");
  }
  if (config.deliveryMode === "resend" && (!config.resendApiKey || !normalizeEmail(config.resendFrom))) {
    throw new Error("DELIVERY_MODE=resend requires RESEND_API_KEY and RESEND_FROM.");
  }
  if (config.profile === "dry_run") {
    if (config.mode !== "mock" || config.autoReply !== "off" || config.deliveryMode !== "preview") {
      throw new Error(
        "dry_run refuses AGENT_MODE=live, AUTO_REPLY, and DELIVERY_MODE=cloudflare or resend. Set DEPLOYMENT_PROFILE=synthetic_test and a non-empty TEST_SENDER_ALLOWLIST.",
      );
    }
    return;
  }
  if (config.testSenderAllowlist.length === 0) {
    throw new Error("synthetic_test requires TEST_SENDER_ALLOWLIST before intake, model calls, or sending.");
  }
}

export const DOCUMENTED_MODELS = ["deepseek-flash", "deepseek-v4-pro"] as const;

/** Peak cache-miss USD per 1M tokens from the DeepSeek pricing page, accessed 2026-11-08. Local ceiling only, not an invoice. */
export const PEAK_CACHE_MISS_USD_PER_MILLION: Record<(typeof DOCUMENTED_MODELS)[number], { input: number; output: number }> = {
  "deepseek-flash": { input: 0.3, output: 1.2 },
  "deepseek-v4-pro": { input: 1.32, output: 3.96 },
};
