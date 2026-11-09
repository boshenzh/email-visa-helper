/** Minimal MIME reader. Plain text wins. An HTML-only body is reduced to text. Attachment bytes are not returned. */

export function extractTextPlain(raw) {
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  const match = /\r?\n\r?\n/.exec(text);
  const headerBlob = match ? text.slice(0, match.index) : text;
  const body = match ? text.slice(match.index + match[0].length) : "";
  const headers = parseHeaders(headerBlob);
  const contentType = headers["content-type"] ?? "text/plain";
  if (/multipart\//i.test(contentType)) {
    const boundary = /boundary="?([^";]+)"?/i.exec(contentType);
    if (!boundary) return { text: "", htmlIgnored: true, attachments: [] };
    return parseMultipart(body, boundary[1]);
  }
  if (/text\/html/i.test(contentType)) {
    return { text: htmlToText(decodeBody(body, headers["content-transfer-encoding"])).slice(0, 20_000), htmlIgnored: false, attachments: [] };
  }
  if (/text\/plain/i.test(contentType) || !headers["content-type"]) {
    return { text: decodeBody(body, headers["content-transfer-encoding"]).slice(0, 20_000), htmlIgnored: true, attachments: [] };
  }
  return {
    text: "",
    htmlIgnored: true,
    attachments: [{ filename: "attachment", mediaType: contentType.split(";")[0].trim(), bytes: body.length }],
  };
}

export function headerMap(headers) {
  const out = {};
  if (!headers || typeof headers.get !== "function") return out;
  for (const name of ["subject", "from", "message-id", "in-reply-to", "references", "authentication-results", "auto-submitted", "precedence", "reply-to", "x-visa-agent"]) {
    const value = headers.get(name);
    if (value) out[name] = value;
  }
  return out;
}

function parseHeaders(blob) {
  const unfolded = blob.replace(/\r?\n[ \t]+/g, " ");
  const headers = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return headers;
}

function parseMultipart(body, boundary) {
  const parts = body.split(new RegExp(`--${escapeRegExp(boundary)}`));
  let text = "";
  let htmlText = "";
  let htmlIgnored = false;
  const attachments = [];
  for (const part of parts) {
    if (!part || part.startsWith("--") || part.trim() === "") continue;
    const match = /\r?\n\r?\n/.exec(part);
    if (!match) continue;
    const headers = parseHeaders(part.slice(0, match.index));
    const content = part.slice(match.index + match[0].length).replace(/\r?\n$/, "");
    const type = headers["content-type"] ?? "text/plain";
    const disposition = headers["content-disposition"] ?? "";
    const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? "";
    if (/attachment/i.test(disposition) || filename) {
      attachments.push({ filename: filename || "attachment", mediaType: type.split(";")[0].trim(), bytes: content.length });
      continue;
    }
    if (/text\/html/i.test(type)) {
      htmlText += htmlToText(decodeBody(content, headers["content-transfer-encoding"]));
      continue;
    }
    if (/text\/plain/i.test(type)) {
      text += decodeBody(content, headers["content-transfer-encoding"]);
    }
  }
  if (text.trim()) return { text: text.slice(0, 20_000), htmlIgnored: htmlText.trim().length > 0, attachments };
  if (htmlText.trim()) return { text: htmlText.slice(0, 20_000), htmlIgnored: false, attachments };
  return { text: "", htmlIgnored, attachments };
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, digits) => String.fromCharCode(Number(digits)))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeBody(content, encoding) {
  const value = (encoding ?? "").toLowerCase();
  if (value.includes("base64")) {
    try {
      return Buffer.from(content.replace(/\s/g, ""), "base64").toString("utf8");
    } catch {
      return "";
    }
  }
  if (value.includes("quoted-printable")) {
    return content
      .replace(/=\r?\n/g, "")
      .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  }
  return content;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
