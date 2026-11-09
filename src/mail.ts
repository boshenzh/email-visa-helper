import type { AppConfig } from "./config.ts";
import { normalizeEmail } from "./security.ts";
import type { Store } from "./store.ts";
import type { OutboxDraft } from "./types.ts";

export class MailTransientError extends Error {}
export class MailPermanentError extends Error {}

export interface OutboundMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
  /** Outbox id. The Resend adapter sends this as the Idempotency-Key HTTP header. */
  idempotencyKey: string;
  /** Configured mailbox, never the inbound Reply-To header. */
  replyTo: string;
  inReplyTo: string;
  references: string[];
}

export interface EmailTransport {
  send(message: OutboundMessage): Promise<{ messageId: string }>;
}

/**
 * Cloudflare Email Sending REST API.
 * POST /accounts/{account_id}/email/sending/send
 * Docs checked 2026-11-08. This is not the inbound Email Routing handler,
 * and it is not generic SMTP.
 */
export function cloudflareRestTransport(accountId: string, token: string, fetchImpl: typeof fetch): EmailTransport {
  return {
    async send(message) {
      const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`;
      let last: Error = new MailTransientError("send failed");
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            to: message.to,
            from: message.from,
            subject: message.subject,
            text: message.text,
          }),
        });
        if (response.status === 429 || response.status >= 500) {
          last = new MailTransientError(`status ${response.status}`);
          continue;
        }
        const payload = (await response.json().catch(() => ({}))) as {
          success?: boolean;
          result?: { messageId?: string; message_id?: string };
        };
        if (!response.ok || payload.success === false) {
          throw new MailPermanentError(`status ${response.status}`);
        }
        const messageId = payload.result?.messageId ?? payload.result?.message_id;
        if (!messageId) throw new MailPermanentError("missing message id");
        return { messageId };
      }
      throw last;
    },
  };
}

/**
 * Resend REST API. POST https://api.resend.com/emails
 * Used when Cloudflare Email Sending is unavailable (Workers Free).
 * The Idempotency-Key HTTP header is the outbox id. It is not an email header.
 * reply_to is the configured mailbox. The recipient is the message `to`, already allowlisted.
 */
export function resendRestTransport(apiKey: string, fetchImpl: typeof fetch): EmailTransport {
  return {
    async send(message) {
      const emailHeaders: Record<string, string> = {};
      const inReplyTo = bracketMessageId(message.inReplyTo);
      if (inReplyTo) emailHeaders["In-Reply-To"] = inReplyTo;
      const references = message.references.map(bracketMessageId).filter((id): id is string => Boolean(id));
      if (references.length > 0) emailHeaders.References = references.join(" ");
      const body: Record<string, unknown> = {
        from: message.from,
        to: [message.to],
        subject: message.subject.replace(/[\r\n]+/g, " ").slice(0, 300),
        text: message.text,
      };
      if (message.replyTo) body.reply_to = message.replyTo;
      if (Object.keys(emailHeaders).length > 0) body.headers = emailHeaders;
      const encoded = JSON.stringify(body);
      let last: Error = new MailTransientError("send failed");
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            "Idempotency-Key": message.idempotencyKey,
          },
          body: encoded,
        });
        if (response.status === 429 || response.status >= 500) {
          await response.arrayBuffer().catch(() => undefined);
          last = new MailTransientError(`status ${response.status}`);
          continue;
        }
        const payload = (await response.json().catch(() => ({}))) as { id?: string };
        if (!response.ok || typeof payload.id !== "string" || payload.id.length === 0) {
          throw new MailPermanentError(`status ${response.status}`);
        }
        return { messageId: payload.id };
      }
      throw last;
    },
  };
}

/** Process transport. Resend stays available when AUTO_REPLY=off so an operator can send one stored draft. Cloudflare is built whenever automatic sending is on. */
export function configuredTransport(config: AppConfig, fetchImpl: typeof fetch): EmailTransport | null {
  if (config.profile !== "synthetic_test" || config.publicLaunch !== "blocked" || config.testSenderAllowlist.length === 0) {
    return null;
  }
  if (config.deliveryMode === "resend" && config.resendApiKey && normalizeEmail(config.resendFrom)) {
    return resendRestTransport(config.resendApiKey, fetchImpl);
  }
  if (
    config.deliveryMode === "cloudflare" &&
    config.autoReply !== "off" &&
    config.cloudflareAccountId &&
    config.cloudflareEmailToken
  ) {
    return cloudflareRestTransport(config.cloudflareAccountId, config.cloudflareEmailToken, fetchImpl);
  }
  return null;
}

export function resendDeliveryState(config: AppConfig, transportReady: boolean): "off" | "manual" | "auto" {
  if (config.deliveryMode !== "resend" || !transportReady || !config.resendApiKey || !normalizeEmail(config.resendFrom)) return "off";
  if (config.profile !== "synthetic_test" || config.publicLaunch !== "blocked") return "off";
  return config.autoReply === "off" ? "manual" : "auto";
}

const AUTO_ALL_REASONS = new Set([
  "GENERAL_INFORMATION",
  "CLERICAL_APPLICANT_CONTROLLED",
  "REGULATED_REVIEW_REQUIRED",
  "OUT_OF_SCOPE",
  "rate_limit",
  "deleted",
  "delete_refused",
]);

/** general_info sends one category. all sends every customer reply to an allowlisted authenticated sender. */
export function shouldAutoSend(config: AppConfig, draft: OutboxDraft): boolean {
  if (config.autoReply === "off" || config.profile !== "synthetic_test" || config.publicLaunch !== "blocked") return false;
  if (config.deliveryMode !== "cloudflare" && config.deliveryMode !== "resend") return false;
  if (draft.status === "suppressed" || draft.status === "held_unverified") return false;
  if (!draft.to || !config.testSenderAllowlist.includes(draft.to)) return false;
  if (config.autoReply === "general_info") return draft.reason === "GENERAL_INFORMATION";
  if (config.autoReply === "all") return AUTO_ALL_REASONS.has(draft.reason);
  return false;
}

export async function maybeAutoSend(store: Store, draft: OutboxDraft, config: AppConfig, transport: EmailTransport | null): Promise<OutboxDraft> {
  if (!shouldAutoSend(config, draft)) return draft;
  if (!transport) {
    store.log("send_not_configured", { outboxId: draft.id });
    return draft;
  }
  return dispatchOutbox(store, draft, transport, senderFrom(config), config.testSenderAllowlist, config.mailbox);
}

/** Operator hand send of one stored draft. Ignores AUTO_REPLY. The recipient is the address already on the row. */
export async function sendStoredDraft(
  store: Store,
  config: AppConfig,
  transport: EmailTransport | null,
  outboxId: string,
): Promise<OutboxDraft> {
  if (config.publicLaunch !== "blocked") throw new MailPermanentError("public launch is blocked");
  if (config.profile !== "synthetic_test") throw new MailPermanentError("synthetic_test profile required");
  if (!transport) throw new MailPermanentError("send not configured");
  if (!/^[a-f0-9]{32}$/.test(outboxId)) throw new MailPermanentError("outbox item not found");
  const draft = store.readOutbox(outboxId);
  if (!draft) throw new MailPermanentError("outbox item not found");
  return dispatchOutbox(store, draft, transport, senderFrom(config), config.testSenderAllowlist, config.mailbox);
}

function senderFrom(config: AppConfig): string {
  return config.deliveryMode === "resend" ? config.resendFrom : config.mailbox;
}

function bracketMessageId(id: string): string | null {
  const trimmed = id.trim();
  if (!trimmed || trimmed.length > 200 || /[\r\n\0]/.test(trimmed) || /[^\x21-\x7e]/.test(trimmed)) return null;
  const bare = trimmed.replace(/^<|>$/g, "");
  if (!bare || bare.includes("<") || bare.includes(">") || /\s/.test(bare)) return null;
  return `<${bare}>`;
}

/** Sends only the address already stored on the draft. A second call after success does not send again. */
export async function dispatchOutbox(
  store: Store,
  draft: OutboxDraft,
  transport: EmailTransport,
  from: string,
  allowlist: readonly string[],
  replyTo = "",
): Promise<OutboxDraft> {
  const current = store.readOutbox(draft.id) ?? draft;
  if (current.status === "sent" || current.status === "queued") return current;
  if (!current.to) throw new MailPermanentError("missing recipient");
  if (!allowlist.includes(current.to)) {
    store.log("send_blocked", { outboxId: current.id, reason: "recipient_not_allowlisted" });
    return current;
  }
  const queued: OutboxDraft = {
    ...current,
    status: "queued",
    providerAttempted: true,
    attempts: current.attempts + 1,
  };
  store.writeOutbox(queued);
  try {
    const result = await transport.send({
      to: current.to,
      from,
      subject: current.subject,
      text: current.text,
      idempotencyKey: current.id,
      replyTo,
      inReplyTo: current.inReplyTo,
      references: current.references,
    });
    const sent: OutboxDraft = { ...queued, status: "sent", providerMessageId: result.messageId };
    store.writeOutbox(sent);
    store.log("outbox_sent", { outboxId: sent.id, providerMessageId: result.messageId });
    return sent;
  } catch (error) {
    const failed: OutboxDraft = { ...queued, status: "failed" };
    store.writeOutbox(failed);
    store.log("outbox_failed", { outboxId: failed.id, transient: error instanceof MailTransientError });
    return failed;
  }
}
