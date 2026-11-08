import http from "node:http";
import { runPublicTopicLoop } from "./deepseek.ts";
import { approveOutbox, deleteAuthorized, handleInbound, type Runtime } from "./inbound.ts";
import { loadSnapshots, OFFICIAL_TOPICS, type OfficialTopic } from "./knowledge.ts";
import { sha256, tokensMatch } from "./security.ts";
import type { Store } from "./store.ts";

export function createServer(runtime: Runtime): http.Server {
  return http.createServer((req, res) => {
    void handle(req, res, runtime).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "error";
      sendJson(res, 500, { ok: false, error: message.slice(0, 200) });
    });
  });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, runtime: Runtime): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      profile: runtime.config.profile,
      mode: runtime.config.mode,
      autoReply: runtime.config.autoReply,
      delivery: runtime.config.deliveryMode,
      publicLaunch: runtime.config.publicLaunch,
      modelCallsOnInbound: Boolean(runtime.modelTransport),
      emailSending: Boolean(runtime.mailTransport),
      testSenderAllowlistCount: runtime.config.testSenderAllowlist.length,
    });
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/v1/artifacts/")) {
    const token = decodeURIComponent(url.pathname.slice("/v1/artifacts/".length));
    if (!/^[a-f0-9]{64}$/.test(token)) return sendJson(res, 404, { ok: false, error: "not found" });
    const record = runtime.store.readDownload(sha256(token));
    if (!record || Date.parse(record.expiresAt) < Date.now()) return sendJson(res, 404, { ok: false, error: "not found" });
    const body = runtime.store.readArtifact(record.caseId, record.artifact);
    res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(body);
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/synthetic/explain") {
    if (runtime.config.profile !== "synthetic_test") return sendJson(res, 403, { ok: false, error: "synthetic_test profile required" });
    if (!authorized(req, runtime.config.operatorToken)) return sendJson(res, 401, { ok: false, error: "unauthorized" });
    const raw = await readBody(req);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return sendJson(res, 400, { ok: false, error: "invalid json" });
    }
    if ("text" in parsed || "email" in parsed || "messages" in parsed || "prompt" in parsed) {
      return sendJson(res, 400, { ok: false, error: "applicant text is not accepted" });
    }
    const topic = parsed.topic;
    if (typeof topic !== "string" || !OFFICIAL_TOPICS.includes(topic as OfficialTopic)) {
      return sendJson(res, 400, { ok: false, error: "topic must be an official topic id" });
    }
    if (!runtime.modelTransport || !runtime.config.deepseekApiKey) {
      return sendJson(res, 503, { ok: false, stopped: "no_api_key", topic });
    }
    const loop = await runPublicTopicLoop({
      topic: topic as OfficialTopic,
      config: runtime.config,
      apiKey: runtime.config.deepseekApiKey,
      transport: runtime.modelTransport,
      snapshots: loadSnapshots(runtime.config),
    });
    for (const request of loop.requests) runtime.store.logModel(request);
    sendJson(res, loop.explanation ? 200 : 422, {
      ok: Boolean(loop.explanation),
      topic,
      explanation: loop.explanation,
      stopped: loop.stopped,
      reason: loop.reason,
      modelRequests: loop.requests.length,
      toolNames: loop.toolNames,
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/email/inbound") {
    if (!authorized(req, runtime.config.ingressToken)) return sendJson(res, 401, { ok: false, error: "unauthorized" });
    const body = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return sendJson(res, 400, { ok: false, error: "invalid json" });
    }
    const result = await handleInbound(parsed, runtime);
    sendJson(res, result.action === "rejected" ? 400 : 200, result);
    return;
  }
  const approve = /^\/v1\/outbox\/([a-f0-9]{32})\/approve$/.exec(url.pathname);
  if (req.method === "POST" && approve) {
    if (!authorized(req, runtime.config.operatorToken)) return sendJson(res, 401, { ok: false, error: "unauthorized" });
    sendJson(res, 200, approveOutbox(runtime.store, approve[1]));
    return;
  }
  const remove = /^\/v1\/cases\/([a-f0-9]{64})\/delete$/.exec(url.pathname);
  if (req.method === "POST" && remove) {
    if (!authorized(req, runtime.config.operatorToken)) return sendJson(res, 401, { ok: false, error: "unauthorized" });
    deleteAuthorized(runtime.store, remove[1], { operator: true, senderEmail: null });
    runtime.store.log("operator_deleted", { caseId: remove[1] });
    sendJson(res, 200, { ok: true, deleted: remove[1] });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/maintenance/sweep") {
    if (!authorized(req, runtime.config.operatorToken)) return sendJson(res, 401, { ok: false, error: "unauthorized" });
    sendJson(res, 200, runtime.store.sweepExpired(new Date()));
    return;
  }
  sendJson(res, 404, { ok: false, error: "not found" });
}

function authorized(req: http.IncomingMessage, expected: string): boolean {
  if (expected.length < 16) return false;
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return tokensMatch(token, expected);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

export function listen(server: http.Server, runtime: { config: { host: string; port: number }; store: Store }): Promise<void> {
  runtime.store.init();
  return new Promise((resolve) => {
    server.listen(runtime.config.port, runtime.config.host, () => resolve());
  });
}
