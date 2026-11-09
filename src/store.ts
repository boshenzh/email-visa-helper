import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "./config.ts";
import { decryptJson, encryptJson, redact, safeJoin, sha256 } from "./security.ts";
import type { CaseRecord, OutboxDraft, VaultFacts } from "./types.ts";

export interface IdempotencyRecord {
  status: "processing" | "done";
  result?: unknown;
}

export class Store {
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  init(): void {
    for (const dir of ["cases", "outbox", "idempotency", "logs", "ratelimit", "downloads"]) {
      fs.mkdirSync(path.join(this.config.dataDir, dir), { recursive: true, mode: 0o700 });
    }
  }

  private writeJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  private readJson<T>(file: string): T | null {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  }

  log(event: string, fields: Record<string, unknown>, secrets: readonly string[] = []): void {
    const line = redact(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }), secrets);
    fs.appendFileSync(path.join(this.config.dataDir, "logs", "events.jsonl"), line + "\n", { mode: 0o600 });
  }

  logModel(payload: unknown): void {
    fs.appendFileSync(
      path.join(this.config.dataDir, "logs", "model-requests.jsonl"),
      JSON.stringify(payload) + "\n",
      { mode: 0o600 },
    );
  }

  caseIdForSender(email: string): string {
    return sha256(email.trim().toLowerCase());
  }

  quarantineId(messageId: string): string {
    return sha256(`quarantine:${messageId}`);
  }

  readCase(caseId: string): CaseRecord | null {
    return this.readJson<CaseRecord>(safeJoin(this.config.dataDir, caseId, "case.json"));
  }

  writeCase(record: CaseRecord): void {
    this.writeJson(safeJoin(this.config.dataDir, record.id, "case.json"), record);
  }

  writeVault(caseId: string, facts: VaultFacts): void {
    const file = safeJoin(this.config.dataDir, caseId, "vault.json");
    if (this.config.vaultKey.length >= 16) {
      this.writeJson(file, encryptJson(facts, this.config.vaultKey));
    } else {
      this.writeJson(file, { enc: "plaintext-demo", facts });
    }
  }

  readVault(caseId: string): VaultFacts | null {
    const file = safeJoin(this.config.dataDir, caseId, "vault.json");
    const raw = this.readJson<Record<string, unknown>>(file);
    if (!raw) return null;
    if (raw.enc === "aes-256-gcm") {
      if (this.config.vaultKey.length < 16) throw new Error("vault key missing");
      return decryptJson<VaultFacts>(raw as { iv: string; tag: string; data: string }, this.config.vaultKey);
    }
    return (raw.facts as VaultFacts) ?? null;
  }

  vaultFileContains(caseId: string, needle: string): boolean {
    const file = safeJoin(this.config.dataDir, caseId, "vault.json");
    return fs.readFileSync(file, "utf8").includes(needle);
  }

  writeArtifact(caseId: string, name: string, body: string): void {
    if (!/^[a-z0-9-]{1,40}\.md$/.test(name)) throw new Error("artifact name not allowed");
    const file = safeJoin(this.config.dataDir, caseId, name);
    fs.writeFileSync(file, body, { mode: 0o600 });
  }

  readArtifact(caseId: string, name: string): string {
    if (!/^[a-z0-9-]{1,40}\.md$/.test(name)) throw new Error("artifact name not allowed");
    const file = safeJoin(this.config.dataDir, caseId, name);
    return fs.readFileSync(file, "utf8");
  }

  removeCase(caseId: string): void {
    const dir = safeJoin(this.config.dataDir, caseId);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  writeOutbox(draft: OutboxDraft): void {
    if (!/^[a-f0-9]{32}$/.test(draft.id)) throw new Error("bad outbox id");
    this.writeJson(path.join(this.config.dataDir, "outbox", `${draft.id}.json`), draft);
  }

  readOutbox(id: string): OutboxDraft | null {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("bad outbox id");
    return this.readJson<OutboxDraft>(path.join(this.config.dataDir, "outbox", `${id}.json`));
  }

  listOutbox(): OutboxDraft[] {
    const dir = path.join(this.config.dataDir, "outbox");
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.readJson<OutboxDraft>(path.join(dir, name)))
      .filter((item): item is OutboxDraft => item !== null);
  }

  beginIdempotency(messageId: string): "started" | "done" | "processing" {
    const file = path.join(this.config.dataDir, "idempotency", `${sha256(messageId)}.json`);
    if (fs.existsSync(file)) {
      const current = this.readJson<IdempotencyRecord>(file);
      return current?.status === "done" ? "done" : "processing";
    }
    this.writeJson(file, { status: "processing" } satisfies IdempotencyRecord);
    return "started";
  }

  readIdempotency(messageId: string): IdempotencyRecord | null {
    return this.readJson<IdempotencyRecord>(path.join(this.config.dataDir, "idempotency", `${sha256(messageId)}.json`));
  }

  finishIdempotency(messageId: string, result: unknown): void {
    this.writeJson(path.join(this.config.dataDir, "idempotency", `${sha256(messageId)}.json`), {
      status: "done",
      result,
    } satisfies IdempotencyRecord);
  }

  forceIdempotency(messageId: string, record: IdempotencyRecord): void {
    this.writeJson(path.join(this.config.dataDir, "idempotency", `${sha256(messageId)}.json`), record);
  }

  consumeRate(bucket: string, limit: number, now: number): boolean {
    const file = path.join(this.config.dataDir, "ratelimit", `${sha256(bucket)}.json`);
    const windowStart = now - 60 * 60 * 1000;
    const current = this.readJson<{ hits: number[] }>(file) ?? { hits: [] };
    const hits = current.hits.filter((hit) => hit >= windowStart);
    if (hits.length >= limit) {
      this.writeJson(file, { hits });
      return false;
    }
    hits.push(now);
    this.writeJson(file, { hits });
    return true;
  }

  saveDownload(tokenHash: string, caseId: string, artifact: string, expiresAt: string): void {
    this.writeJson(path.join(this.config.dataDir, "downloads", `${tokenHash}.json`), { caseId, artifact, expiresAt });
  }

  readDownload(tokenHash: string): { caseId: string; artifact: string; expiresAt: string } | null {
    if (!/^[a-f0-9]{64}$/.test(tokenHash)) return null;
    return this.readJson(path.join(this.config.dataDir, "downloads", `${tokenHash}.json`));
  }

  sweepExpired(now: Date): { removed: string[]; warning: string } {
    const ttlMs = this.config.caseTtlDays * 24 * 60 * 60 * 1000;
    const removed: string[] = [];
    const casesDir = path.join(this.config.dataDir, "cases");
    if (!fs.existsSync(casesDir)) return { removed, warning: "" };
    for (const id of fs.readdirSync(casesDir)) {
      if (!/^[a-f0-9]{64}$/.test(id)) continue;
      const record = this.readCase(id);
      if (!record) continue;
      if (now.getTime() - Date.parse(record.updatedAt) < ttlMs) continue;
      this.removeCase(id);
      removed.push(id);
    }
    return {
      removed,
      warning:
        "Demo TTL is a product choice for this store only. It is not a legal retention period, and it does not delete provider-side copies.",
    };
  }
}
