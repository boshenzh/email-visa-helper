import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, type AppConfig } from "../src/config.ts";
import { handleInbound, type Runtime } from "../src/inbound.ts";
import { Store } from "../src/store.ts";
import type { InboundResult } from "../src/types.ts";

export function tempRuntime(overrides: Partial<AppConfig> = {}): Runtime {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "visa-helper-"));
  const config = loadConfig({}, { dataDir, ingressToken: "ingress-token-for-tests-0123456789", operatorToken: "operator-token-for-tests-0123456789", ...overrides });
  const store = new Store(config);
  store.init();
  return { config, store };
}

export function verified(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    envelopeFrom: "synthetic@example.com",
    envelopeTo: "visa@boshen.dev",
    headerFrom: "Synthetic Person <synthetic@example.com>",
    replyTo: "evil@example.com",
    subject: "UK visitor preparation",
    inReplyTo: "",
    references: [],
    authenticationResults: "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=example.com",
    autoSubmitted: "no",
    precedence: "",
    extraHeaders: {},
    text: "I want to visit the UK as a tourist. What is the Standard Visitor fee?",
    htmlIgnored: true,
    attachments: [],
    ...partial,
    messageId: `<${String(partial.messageId ?? "msg-1")}@example.com>`,
  };
}

export function send(runtime: Runtime, partial: Record<string, unknown> = {}): Promise<InboundResult> {
  return handleInbound(verified(partial), runtime);
}

export function readLog(runtime: Runtime): string {
  const file = path.join(runtime.config.dataDir, "logs", "events.jsonl");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

export function outboxCount(runtime: Runtime): number {
  return fs.readdirSync(path.join(runtime.config.dataDir, "outbox")).filter((name) => name.endsWith(".json")).length;
}
