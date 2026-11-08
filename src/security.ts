import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function tokensMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function normalizeEmail(value: string): string {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : "";
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

export function normalizeMessageId(value: string): string {
  return value.trim().replace(/^<|>$/g, "").toLowerCase();
}

export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  const unique = [...secrets].filter((secret) => secret.trim().length >= 3).sort((a, b) => b.length - a.length);
  for (const secret of unique) {
    out = out.split(secret).join("[redacted]");
  }
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
  out = out.replace(/\b(?:passport|account|sort code|iban)\s*[:#-]?\s*[A-Z0-9-]{6,}\b/gi, "[redacted-id]");
  return out;
}

export function assertCaseId(caseId: string): void {
  if (!/^[a-f0-9]{64}$/.test(caseId)) throw new Error("bad case id");
}

export function safeJoin(root: string, caseId: string, ...parts: string[]): string {
  assertCaseId(caseId);
  for (const part of parts) {
    if (part.length === 0 || part.includes("\0") || part.includes("/") || part.includes("\\") || part === "." || part === "..") {
      throw new Error("path not allowed");
    }
  }
  const caseRoot = path.resolve(root, "cases", caseId);
  const target = path.resolve(caseRoot, ...parts);
  const prefix = caseRoot.endsWith(path.sep) ? caseRoot : caseRoot + path.sep;
  if (target !== caseRoot && !target.startsWith(prefix)) throw new Error("path escape");
  let cursor = path.resolve(root);
  for (const segment of ["cases", caseId, ...parts]) {
    cursor = path.join(cursor, segment);
    if (fs.existsSync(cursor)) {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error("symlink not allowed");
    }
  }
  return target;
}

export interface SenderDecision {
  ok: boolean;
  email: string;
  reason: string;
}

/** Trust only a Cloudflare Authentication-Results header from mx.cloudflare.net with dmarc=pass aligned to the header From domain. */
export function authenticateSender(authenticationResults: string, headerFrom: string, mailbox: string): SenderDecision {
  const email = normalizeEmail(headerFrom);
  const domain = emailDomain(email);
  const first = authenticationResults.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  if (!/^mx\.cloudflare\.net\b/i.test(first.trim())) {
    return { ok: false, email: "", reason: "authserv" };
  }
  const dmarc = /(?:^|[;\s])dmarc=(pass|fail|none|neutral|temperror|permerror)/i.exec(first);
  if (!dmarc || dmarc[1].toLowerCase() !== "pass") {
    return { ok: false, email: "", reason: "dmarc" };
  }
  const aligned = /header\.from=([^;\s]+)/i.exec(first);
  if (!aligned || aligned[1].toLowerCase() !== domain || domain.length === 0) {
    return { ok: false, email: "", reason: "alignment" };
  }
  if (email === mailbox.toLowerCase()) return { ok: false, email: "", reason: "self" };
  return { ok: true, email, reason: "dmarc_pass" };
}

export function loopReason(input: {
  mailbox: string;
  headerFrom: string;
  envelopeFrom: string;
  subject: string;
  autoSubmitted: string;
  precedence: string;
  extraHeaders: Record<string, string>;
  referencesCount: number;
}): string | null {
  const from = normalizeEmail(input.headerFrom);
  const envelope = normalizeEmail(input.envelopeFrom);
  const auto = input.autoSubmitted.trim().toLowerCase();
  if (auto && auto !== "no") return "auto_submitted";
  const precedence = input.precedence.trim().toLowerCase();
  if (precedence === "bulk" || precedence === "list" || precedence === "junk") return "precedence";
  if (input.extraHeaders["x-visa-agent"]?.toLowerCase() === "yes") return "our_header";
  if (from === input.mailbox || envelope === input.mailbox) return "self";
  if (from.startsWith("mailer-daemon@") || from.startsWith("postmaster@") || envelope.startsWith("mailer-daemon@") || envelope.startsWith("postmaster@")) {
    return "bounce";
  }
  if (/^(auto(matic)?[\s-]?reply|out of office|undeliverable|delivery status notification)/i.test(input.subject.trim())) {
    return "auto_subject";
  }
  if (input.referencesCount > 100) return "references_limit";
  return null;
}

const PASSPORT_LABEL = /(?:passport|travel\s*document)\s*(?:number|no\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{5,})/i;
const BANK_LABEL = /(?:account|card)\s*(?:number|no\.?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9\s-]{5,})|\b(?:sort\s*code|iban)\s*[:#-]?\s*([A-Z0-9][A-Z0-9\s-]{5,})/i;

export function sensitiveMarkers(text: string): { passportNumberPresent: boolean; bankDetailPresent: boolean; stripped: string } {
  const passportNumberPresent = PASSPORT_LABEL.test(text);
  const bankDetailPresent = BANK_LABEL.test(text);
  const stripped = text.replace(PASSPORT_LABEL, "passport number: [not stored]").replace(BANK_LABEL, "account detail: [not stored]");
  return { passportNumberPresent, bankDetailPresent, stripped };
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function encryptJson(value: unknown, secret: string): { enc: "aes-256-gcm"; iv: string; tag: string; data: string } {
  const key = crypto.scryptSync(secret, "visa-helper-vault-v1", 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { enc: "aes-256-gcm", iv: iv.toString("base64"), tag: tag.toString("base64"), data: data.toString("base64") };
}

export function decryptJson<T>(payload: { iv: string; tag: string; data: string }, secret: string): T {
  const key = crypto.scryptSync(secret, "visa-helper-vault-v1", 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(payload.data, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(plain) as T;
}
