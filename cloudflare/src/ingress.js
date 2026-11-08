/**
 * Inbound Email Routing adapter.
 *
 * Cloudflare's email handler page (updated 2026-10-30) documents
 * message.setReject(reason) as a permanent SMTP error. That page does not
 * document a transient SMTP status or an automatic retry of email().
 * A community report shows an uncaught exception returning "521 Upstream
 * error", which is also a permanent status. This adapter therefore does not
 * throw in order to ask for a retry.
 *
 * Returning without forward, reply, or setReject lets the Worker accept the
 * message and drop it. Every path here either forwards to an operator-marked
 * verified destination, or calls setReject.
 *
 * message.forward only succeeds for a destination address already verified in
 * the Cloudflare account. The worker cannot see that dashboard list, so it
 * forwards only when OPERATOR_FORWARD_VERIFIED is exactly "true".
 */

import { extractTextPlain, headerMap } from "./mime.js";

export function canonicalAddress(value) {
  const raw = String(value ?? "").trim();
  const angled = raw.match(/<([^<>]+)>/);
  const addr = (angled ? angled[1] : raw).trim().toLowerCase().replace(/^mailto:/, "");
  const match = addr.match(/^([^@\s]+)@([^@\s]+)$/);
  if (!match) return null;
  let domain = match[2];
  if (domain.endsWith(".")) domain = domain.slice(0, -1);
  const local = match[1];
  if (!local || !domain || domain.includes("..") || local.includes("..")) return null;
  return { local, domain, address: `${local}@${domain}` };
}

/** Exact mailbox, or a subaddress of that local part (visa+tag@domain). Not a substring. */
export function sameMailbox(envelopeTo, mailbox) {
  const got = canonicalAddress(envelopeTo);
  const want = canonicalAddress(mailbox);
  if (!got || !want) return false;
  if (got.domain !== want.domain) return false;
  if (got.local === want.local) return true;
  const prefix = `${want.local}+`;
  return got.local.startsWith(prefix) && got.local.length > prefix.length;
}

export function authorizedForwardAddress(env) {
  if (String(env.OPERATOR_FORWARD_VERIFIED ?? "").trim().toLowerCase() !== "true") return null;
  const dest = canonicalAddress(env.OPERATOR_FORWARD_ADDRESS);
  const box = canonicalAddress(env.MAILBOX ?? "visa@boshen.dev");
  if (!dest || !box) return null;
  if (dest.domain === box.domain && (dest.local === box.local || dest.local.startsWith(`${box.local}+`))) return null;
  return dest.address;
}

export async function handleEmail(message, env, fetchImpl = fetch) {
  const mailbox = env.MAILBOX ?? "visa@boshen.dev";
  if (!sameMailbox(message.to, mailbox)) {
    message.setReject("recipient is not the configured mailbox");
    return { outcome: "reject", reason: "recipient_mismatch" };
  }
  if (Number(message.rawSize) > 1_000_000) {
    message.setReject("message exceeds the assistant size limit");
    return { outcome: "reject", reason: "too_large" };
  }
  const forwardTo = authorizedForwardAddress(env);
  let preserved = false;
  if (forwardTo && message.canBeForwarded !== false) {
    try {
      await message.forward(forwardTo);
      preserved = true;
    } catch (error) {
      console.log(JSON.stringify({ event: "forward_failed", message: String(error).slice(0, 160) }));
      message.setReject("verified forward failed");
      return { outcome: "reject", reason: "forward_failed" };
    }
  }
  if (!env.RUNTIME_URL || !env.INGRESS_TOKEN) {
    return failOrPreserved(message, preserved, "runtime_unconfigured");
  }
  let raw = "";
  try {
    raw = await readCapped(message.raw, 1_000_000);
  } catch (error) {
    console.log(JSON.stringify({ event: "read_failed", message: String(error).slice(0, 160) }));
    return failOrPreserved(message, preserved, "read_failed");
  }
  const headers = headerMap(message.headers);
  const parsed = extractTextPlain(raw);
  const references = String(headers.references ?? "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 100);
  const event = {
    envelopeFrom: String(message.from ?? ""),
    envelopeTo: String(message.to ?? ""),
    headerFrom: headers.from ?? "",
    replyTo: headers["reply-to"] ?? "",
    subject: headers.subject ?? "",
    messageId: headers["message-id"] ?? "",
    inReplyTo: headers["in-reply-to"] ?? "",
    references,
    authenticationResults: headers["authentication-results"] ?? "",
    autoSubmitted: headers["auto-submitted"] ?? "",
    precedence: headers.precedence ?? "",
    extraHeaders: headers["x-visa-agent"] ? { "x-visa-agent": headers["x-visa-agent"] } : {},
    text: parsed.text,
    htmlIgnored: true,
    attachments: parsed.attachments,
  };
  const timeoutMs = Number(env.RUNTIME_TIMEOUT_MS || 20_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20_000);
  try {
    const response = await fetchImpl(env.RUNTIME_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.INGRESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.log(JSON.stringify({ event: "runtime_status", status: response.status }));
      return failOrPreserved(message, preserved, `runtime_status_${response.status}`);
    }
    console.log(JSON.stringify({ event: "runtime_ok", status: response.status, preserved }));
    return { outcome: preserved ? "accepted_and_preserved" : "accepted", reason: "runtime_ok" };
  } catch (error) {
    console.log(JSON.stringify({ event: "runtime_unreachable", message: String(error).slice(0, 160) }));
    return failOrPreserved(message, preserved, "runtime_unreachable");
  } finally {
    clearTimeout(timer);
  }
}

function failOrPreserved(message, preserved, reason) {
  if (preserved) return { outcome: "preserved", reason };
  message.setReject(`runtime unavailable: ${reason}`);
  return { outcome: "reject", reason };
}

async function readCapped(stream, cap) {
  if (typeof stream === "string") return stream.slice(0, cap);
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > cap) throw new Error("too_large");
    chunks.push(next.value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
