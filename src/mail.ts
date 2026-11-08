import type { AppConfig } from "./config.ts";
import type { Store } from "./store.ts";
import type { OutboxDraft } from "./types.ts";

export class MailTransientError extends Error {}
export class MailPermanentError extends Error {}

export interface OutboundMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
  idempotencyKey: string;
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

export async function maybeAutoSend(store: Store, draft: OutboxDraft, config: AppConfig, transport: EmailTransport | null): Promise<OutboxDraft> {
  if (config.autoReply !== "general_info" || config.deliveryMode !== "cloudflare") return draft;
  if (draft.reason !== "GENERAL_INFORMATION" || !draft.to) return draft;
  if (!transport) {
    store.log("send_not_configured", { outboxId: draft.id });
    return draft;
  }
  return dispatchOutbox(store, draft, transport, config.mailbox);
}

/** Sends only the address already stored on the draft. A second call after success does not send again. */
export async function dispatchOutbox(store: Store, draft: OutboxDraft, transport: EmailTransport, from: string): Promise<OutboxDraft> {
  const current = store.readOutbox(draft.id) ?? draft;
  if (current.status === "sent" && current.providerMessageId) return current;
  if (current.status === "queued") return current;
  if (!current.to) throw new MailPermanentError("missing recipient");
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
      idempotencyKey: current.idempotencyKey,
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
