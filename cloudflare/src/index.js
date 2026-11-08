import { extractTextPlain, headerMap } from "./mime.js";

/**
 * Cloudflare Email Routing adapter for visa@boshen.dev.
 * It forwards a normalized event to the Node runtime and does not send mail.
 * message.reply() and the send_email binding are intentionally not used.
 * Auto-reply stays off until a later review. See docs/SETUP.md.
 */
export default {
  async email(message, env, ctx) {
    const mailbox = String(env.MAILBOX ?? "visa@boshen.dev").toLowerCase();
    const recipient = String(message.to ?? "").toLowerCase();
    if (!recipient.includes(mailbox)) {
      await preserveOrReject(message, env, "recipient is not the configured mailbox");
      return;
    }
    if (message.rawSize > 1_000_000) {
      message.setReject("message exceeds the assistant size limit");
      return;
    }
    if (!env.RUNTIME_URL || !env.INGRESS_TOKEN) {
      console.log(JSON.stringify({ event: "runtime_unconfigured" }));
      await preserveOrReject(message, env, "visa assistant is not configured");
      return;
    }
    let raw = "";
    try {
      raw = await readCapped(message.raw, 1_000_000);
    } catch (error) {
      console.log(JSON.stringify({ event: "read_failed", message: String(error).slice(0, 160) }));
      await preserveOrReject(message, env, "message could not be read");
      return;
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
    if (env.OPERATOR_FORWARD_ADDRESS) {
      ctx.waitUntil(message.forward(env.OPERATOR_FORWARD_ADDRESS));
    }
    const task = fetch(env.RUNTIME_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.INGRESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(event),
    })
      .then((response) => {
        console.log(JSON.stringify({ event: "runtime_result", status: response.status }));
      })
      .catch((error) => {
        console.log(JSON.stringify({ event: "runtime_error", message: String(error).slice(0, 160) }));
      });
    ctx.waitUntil(task);
  },
};

async function preserveOrReject(message, env, reason) {
  if (env.OPERATOR_FORWARD_ADDRESS) {
    await message.forward(env.OPERATOR_FORWARD_ADDRESS);
    return;
  }
  message.setReject(reason);
}

async function readCapped(stream, cap) {
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
