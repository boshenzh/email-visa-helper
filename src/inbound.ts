import crypto from "node:crypto";
import type { AppConfig } from "./config.ts";
import { renderReviewNote, renderSourceLedger, renderUnknowns, renderWorksheet } from "./artifacts.ts";
import { runPublicTopicLoop } from "./deepseek.ts";
import { classify, emptyFacts, extractFacts, publicText, type Intake } from "./intake.ts";
import { loadSnapshots } from "./knowledge.ts";
import { maybeAutoSend, type EmailTransport } from "./mail.ts";
import { composeReply } from "./reply.ts";
import {
  authenticateSender,
  loopReason,
  normalizeMessageId,
  randomToken,
  sha256,
} from "./security.ts";
import { Store } from "./store.ts";
import type { AttachmentMeta, InboundEvent, InboundResult, OutboxDraft } from "./types.ts";

export interface Runtime {
  config: AppConfig;
  store: Store;
  /** Mocked or live Chat Completions transport. Absent means the model is not called. */
  modelTransport?: typeof fetch;
  /** Mocked or live Email Sending transport. Absent means a configured auto-reply stays a draft. */
  mailTransport?: EmailTransport;
  now?: () => Date;
}

const ALLOWED_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain"]);

export function parseInboundEvent(input: unknown, limits: { maxTextChars: number; maxAttachmentBytes: number; maxAttachments: number }): InboundEvent | { error: string } {
  if (!input || typeof input !== "object") return { error: "expected an object" };
  const record = input as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.slice(0, limits.maxTextChars) : "";
  const allReferences = Array.isArray(record.references) ? record.references.filter((item): item is string => typeof item === "string") : [];
  const references = allReferences.slice(0, 100);
  const extra: Record<string, string> = {};
  if (record.extraHeaders && typeof record.extraHeaders === "object") {
    for (const [key, value] of Object.entries(record.extraHeaders as Record<string, unknown>)) {
      if (typeof value === "string") extra[key.toLowerCase()] = value.slice(0, 300);
    }
  }
  const attachments: AttachmentMeta[] = [];
  if (Array.isArray(record.attachments)) {
    for (const item of record.attachments.slice(0, limits.maxAttachments)) {
      if (!item || typeof item !== "object") continue;
      const attachment = item as Record<string, unknown>;
      const filename = sanitizeFilename(typeof attachment.filename === "string" ? attachment.filename : "attachment");
      const mediaType = typeof attachment.mediaType === "string" ? attachment.mediaType.toLowerCase() : "application/octet-stream";
      const bytes = typeof attachment.bytes === "number" && Number.isFinite(attachment.bytes) ? attachment.bytes : 0;
      const accepted = ALLOWED_TYPES.has(mediaType) && bytes > 0 && bytes <= limits.maxAttachmentBytes;
      attachments.push({ filename, mediaType, bytes, accepted });
    }
  }
  const messageId = normalizeMessageId(typeof record.messageId === "string" ? record.messageId : "");
  if (!messageId) return { error: "messageId is required" };
  return {
    envelopeFrom: str(record.envelopeFrom),
    envelopeTo: str(record.envelopeTo),
    headerFrom: str(record.headerFrom),
    replyTo: str(record.replyTo),
    subject: str(record.subject).slice(0, 300),
    messageId,
    inReplyTo: normalizeMessageId(str(record.inReplyTo)),
    references: references.map(normalizeMessageId).filter(Boolean),
    authenticationResults: str(record.authenticationResults).slice(0, 2000),
    autoSubmitted: str(record.autoSubmitted),
    precedence: str(record.precedence),
    extraHeaders: extra,
    text,
    htmlIgnored: record.htmlIgnored !== false,
    attachments,
    referenceCount: allReferences.length,
  };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function sanitizeFilename(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "attachment";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  return cleaned || "attachment";
}

export async function handleInbound(raw: unknown, runtime: Runtime): Promise<InboundResult> {
  const { config, store } = runtime;
  const now = runtime.now ?? (() => new Date());
  const snapshots = loadSnapshots(config);
  const parsed = parseInboundEvent(raw, config);
  if ("error" in parsed) {
    return emptyResult("rejected", parsed.error);
  }
  const threadId = parsed.references[0] || parsed.inReplyTo || parsed.messageId;
  const loopSignal = loopReason({
    mailbox: config.mailbox,
    headerFrom: parsed.headerFrom,
    envelopeFrom: parsed.envelopeFrom,
    subject: parsed.subject,
    autoSubmitted: parsed.autoSubmitted,
    precedence: parsed.precedence,
    extraHeaders: parsed.extraHeaders,
    referencesCount: parsed.referenceCount,
  });
  const idem = store.beginIdempotency(parsed.messageId);
  if (idem === "done") {
    const saved = store.readIdempotency(parsed.messageId)?.result as InboundResult | undefined;
    if (saved) return { ...saved, action: saved.action === "rejected" ? "rejected" : "duplicate" };
  }
  if (idem === "processing") {
    return emptyResult("retry", "This message is already being handled. Retry shortly.");
  }
  if (loopSignal) {
    const result = finish(store, parsed.messageId, {
      ...emptyResult("suppressed", "No reply, to avoid a mail loop."),
      stopped: loopSignal,
    });
    store.log("suppressed", { messageId: sha256(parsed.messageId), reason: loopSignal });
    return result;
  }
  if (config.killSwitch) {
    const reply = composeReply({ snapshots, intake: killedIntake(), stopped: "completed", downloadPath: null, deleted: false, killed: true });
    const draft = makeDraft(parsed, null, threadId, null, reply, "suppressed", "kill_switch");
    store.writeOutbox(draft);
    return finish(store, parsed.messageId, { ...emptyResult("suppressed", reply), outboxId: draft.id, reply, stopped: "kill_switch" });
  }
  const sender = authenticateSender(parsed.authenticationResults, parsed.headerFrom, config.mailbox);
  if (config.profile === "synthetic_test" && (!sender.ok || !config.testSenderAllowlist.includes(sender.email))) {
    store.log("sender_not_allowlisted", { verified: sender.ok });
    return finish(store, parsed.messageId, {
      ...emptyResult("rejected", "This test deployment only accepts the operator allowlist. Nothing was stored and the model was not called.\n"),
      modelReason: "sender_not_allowlisted",
      stopped: "not_allowlisted",
    });
  }
  const caseId = sender.ok ? store.caseIdForSender(sender.email) : store.quarantineId(parsed.messageId);
  const existing = sender.ok ? store.readCase(caseId) : null;
  const text = publicText(parsed);
  const secrets = [parsed.replyTo, parsed.headerFrom, parsed.envelopeFrom, sender.email].filter(Boolean);
  if (!store.consumeRate("global", config.globalHourlyLimit, now().getTime()) || !store.consumeRate(sender.ok ? `sender:${sender.email}` : `unverified:${sha256(parsed.envelopeFrom || parsed.messageId)}`, config.senderHourlyLimit, now().getTime())) {
    const reply = composeReply({
      snapshots,
      intake: rateIntake(),
      stopped: "completed",
      downloadPath: null,
      deleted: false,
      killed: false,
      note: "A local rate limit paused this message. Nothing was submitted.",
    });
    const created = makeDraft(parsed, sender.ok ? caseId : null, threadId, sender.ok ? sender.email : null, reply, sender.ok ? "draft" : "held_unverified", "rate_limit");
    store.writeOutbox(created);
    const draft = await maybeAutoSend(store, created, config, runtime.mailTransport ?? null);
    store.log("rate_limited", { caseId: sender.ok ? caseId : null }, secrets);
    return finish(store, parsed.messageId, { ...emptyResult("draft", reply), caseId: sender.ok ? caseId : null, outboxId: draft.id, category: "GENERAL_INFORMATION", reply, stopped: "rate_limit" });
  }
  if (!sender.ok) {
    const reply = "Hello,\n\nI’m the AI preparation assistant for visa@boshen.dev. I couldn’t verify that this message’s From address passed DMARC, so I didn’t open a case. Reply-To is not used.\n\nVisa Helper\n";
    const created = makeDraft(parsed, null, threadId, null, reply, "held_unverified", sender.reason);
    store.writeOutbox(created);
    const draft = await maybeAutoSend(store, created, config, runtime.mailTransport ?? null);
    store.log("unverified_sender", { reason: sender.reason, messageId: sha256(parsed.messageId) }, secrets);
    return finish(store, parsed.messageId, { ...emptyResult("draft", reply), outboxId: draft.id, reply, stopped: "unverified" });
  }
  const previous = existing ? store.readVault(caseId) : null;
  const extracted = extractFacts(text, previous);
  const intake = classify(text, extracted.facts, extracted.changedNationality, Boolean(existing));
  const preserveCase = Boolean(existing) && (intake.category === "OUT_OF_SCOPE" || intake.bareGreeting);
  secrets.push(extracted.facts.nationality, extracted.facts.residence);
  if (intake.deleteRequested) {
    if (existing && existing.sender === sender.email) {
      store.removeCase(caseId);
      const reply = composeReply({ snapshots, intake, stopped: "completed", downloadPath: null, deleted: true, killed: false });
      const created = makeDraft(parsed, null, threadId, sender.email, reply, "draft", "deleted");
      store.writeOutbox(created);
      const draft = await maybeAutoSend(store, created, config, runtime.mailTransport ?? null);
      store.log("deleted", { caseId }, secrets);
      return finish(store, parsed.messageId, { ...emptyResult("deleted", reply), outboxId: draft.id, reply, stopped: "deleted" });
    }
    const reply = "Hello,\n\nI can delete only the case already bound to this verified sender. I will not delete a case because an email address was typed in the message.\n\nVisa Helper\n";
    const created = makeDraft(parsed, existing ? caseId : null, threadId, sender.email, reply, "draft", "delete_refused");
    store.writeOutbox(created);
    const draft = await maybeAutoSend(store, created, config, runtime.mailTransport ?? null);
    return finish(store, parsed.messageId, { ...emptyResult("rejected", reply), caseId: existing?.id ?? null, outboxId: draft.id, reply, stopped: "delete_refused" });
  }
  const threadReplies = store.listOutbox().filter((item) => item.threadId === threadId && item.status !== "suppressed").length;
  if (threadReplies >= config.maxRepliesPerThread) {
    store.log("thread_cap", { threadId: sha256(threadId) }, secrets);
    return finish(store, parsed.messageId, { ...emptyResult("suppressed", "Thread reply cap reached."), stopped: "thread_cap" });
  }
  const record = {
    id: caseId,
    sender: sender.email,
    verified: true,
    createdAt: existing?.createdAt ?? now().toISOString(),
    updatedAt: now().toISOString(),
    category: existing && preserveCase ? existing.category : intake.category,
    purposeBand: existing && preserveCase ? existing.purposeBand : intake.facts.purposeBand,
    reviewFlags: existing && preserveCase ? existing.reviewFlags : intake.reviewFlags,
    missing: existing && preserveCase ? existing.missing : intake.missing,
    synthetic: false,
    threadIds: [...new Set([...(existing?.threadIds ?? []), threadId])],
    messageIds: [...new Set([...(existing?.messageIds ?? []), parsed.messageId])],
    artifactNames: existing?.artifactNames ?? [],
    consentNoticeShown: true,
    vaultMode: config.vaultKey.length >= 16 ? "aes-256-gcm" as const : "plaintext-demo" as const,
  };
  store.writeCase(record);
  if (!(existing && (intake.category === "OUT_OF_SCOPE" || intake.bareGreeting))) store.writeVault(caseId, intake.facts);
  const artifactNames: string[] = [];
  const refreshWorksheet =
    !intake.bareGreeting &&
    (intake.category === "CLERICAL_APPLICANT_CONTROLLED" ||
      (intake.category !== "OUT_OF_SCOPE" &&
        (existing?.artifactNames ?? []).includes("worksheet.md") &&
        (intake.facts.purposeBand === "ordinary_visitor" || intake.reviewFlags.includes("minor"))));
  if (refreshWorksheet) {
    store.writeArtifact(caseId, "worksheet.md", renderWorksheet(intake.facts, record, snapshots));
    store.writeArtifact(caseId, "unknowns.md", renderUnknowns(intake.missing));
    store.writeArtifact(caseId, "source-ledger.md", renderSourceLedger(snapshots));
    artifactNames.push("worksheet.md", "unknowns.md", "source-ledger.md");
  }
  if (intake.category === "REGULATED_REVIEW_REQUIRED") {
    store.writeArtifact(caseId, "review-note.md", renderReviewNote(intake.facts, intake.reviewFlags, snapshots));
    artifactNames.push("review-note.md");
  }
  const model = await explainPublicTopic({
    runtime,
    snapshots,
    topic: intake.publicTopic,
    secrets,
    category: intake.category,
  });
  for (const request of model.requests) store.logModel(request);
  let downloadPath: string | null = null;
  if (intake.exportRequested) {
    store.writeArtifact(caseId, "source-ledger.md", renderSourceLedger(snapshots));
    if (!artifactNames.includes("source-ledger.md")) artifactNames.push("source-ledger.md");
    const token = randomToken();
    store.saveDownload(sha256(token), caseId, "source-ledger.md", new Date(now().getTime() + 24 * 60 * 60 * 1000).toISOString());
    downloadPath = `/v1/artifacts/${token}`;
  }
  record.artifactNames = [...new Set([...(existing?.artifactNames ?? []), ...artifactNames])];
  store.writeCase(record);
  const reply = composeReply({
    snapshots,
    intake,
    stopped: model.stopped,
    downloadPath,
    deleted: false,
    killed: false,
    modelExplanation: model.explanation,
  });
  const created = makeDraft(parsed, caseId, threadId, sender.email, reply, "draft", intake.category);
  store.writeOutbox(created);
  const draft = await maybeAutoSend(store, created, config, runtime.mailTransport ?? null);
  store.log(
    "draft_ready",
    {
      caseId,
      category: intake.category,
      flags: intake.reviewFlags,
      tools: model.toolNames,
      modelRequests: model.requests.length,
      modelReason: model.reason,
      stopped: model.stopped,
      delivery: draft.status,
      textChars: parsed.text.length,
    },
    secrets,
  );
  return finish(store, parsed.messageId, {
    ok: true,
    action: "draft",
    caseId,
    outboxId: draft.id,
    category: intake.category,
    reviewFlags: intake.reviewFlags,
    reply,
    artifactNames: record.artifactNames,
    modelRequests: model.requests.length,
    modelReason: model.reason,
    toolNames: model.toolNames,
    stopped: model.stopped,
  });
}

async function explainPublicTopic(input: {
  runtime: Runtime;
  snapshots: ReturnType<typeof loadSnapshots>;
  topic: Intake["publicTopic"];
  secrets: string[];
  category: Intake["category"];
}): Promise<{ requests: unknown[]; explanation: string | null; toolNames: string[]; stopped: string; reason: string }> {
  if (!input.topic) {
    const reason = input.category === "OUT_OF_SCOPE" ? "out_of_scope" : input.category === "REGULATED_REVIEW_REQUIRED" ? "personal_or_uncertain" : "no_public_topic";
    return { requests: [], explanation: null, toolNames: [], stopped: "not_called", reason };
  }
  const transport = input.runtime.modelTransport;
  if (!transport || !input.runtime.config.deepseekApiKey) {
    return { requests: [], explanation: null, toolNames: [], stopped: "not_called", reason: "no_transport" };
  }
  const loop = await runPublicTopicLoop({
    topic: input.topic,
    config: input.runtime.config,
    apiKey: input.runtime.config.deepseekApiKey,
    transport,
    snapshots: input.snapshots,
    secrets: input.secrets,
    now: () => (input.runtime.now ?? (() => new Date()))().getTime(),
  });
  return {
    requests: loop.requests,
    explanation: loop.explanation,
    toolNames: loop.toolNames,
    stopped: loop.stopped,
    reason: loop.reason,
  };
}

export function approveOutbox(store: Store, id: string): OutboxDraft {
  const item = store.readOutbox(id);
  if (!item) throw new Error("outbox item not found");
  if (item.status === "suppressed" || item.status === "held_unverified") return item;
  const next: OutboxDraft = { ...item, status: "approved_not_sent", providerAttempted: false };
  store.writeOutbox(next);
  return next;
}

export function deleteAuthorized(store: Store, caseId: string, actor: { operator: boolean; senderEmail: string | null }): void {
  const record = store.readCase(caseId);
  if (!record) throw new Error("case not found");
  if (actor.operator) {
    store.removeCase(caseId);
    return;
  }
  if (!actor.senderEmail || actor.senderEmail !== record.sender) throw new Error("not authorized");
  store.removeCase(caseId);
}

function finish(store: Store, messageId: string, result: InboundResult): InboundResult {
  store.finishIdempotency(messageId, result);
  return result;
}

function makeDraft(
  event: InboundEvent,
  caseId: string | null,
  threadId: string,
  to: string | null,
  text: string,
  status: OutboxDraft["status"],
  reason: string,
): OutboxDraft {
  const id = crypto.randomBytes(16).toString("hex");
  return {
    id,
    caseId,
    threadId,
    idempotencyKey: sha256(`${event.messageId}:${status}`),
    to,
    subject: event.subject.toLowerCase().startsWith("re:") ? event.subject : `Re: ${event.subject || "UK visitor preparation"}`,
    text,
    status,
    reason,
    providerAttempted: false,
    providerMessageId: null,
    attempts: 0,
    createdAt: new Date().toISOString(),
    inReplyTo: event.messageId,
    references: [...event.references, event.messageId].slice(-20),
  };
}

function emptyResult(action: InboundResult["action"], reply: string): InboundResult {
  return {
    ok: action === "draft" || action === "duplicate" || action === "deleted",
    action,
    caseId: null,
    outboxId: null,
    category: null,
    reviewFlags: [],
    reply,
    artifactNames: [],
    modelRequests: 0,
    modelReason: "not_run",
    toolNames: [],
    stopped: "completed",
  };
}

function killedIntake(): Intake {
  return {
    facts: emptyFacts(),
    category: "GENERAL_INFORMATION",
    reviewFlags: [],
    missing: [],
    inScope: true,
    injectionIgnored: false,
    deleteRequested: false,
    exportRequested: false,
    asksPersonalVerdict: false,
    publicTopic: null,
    mentionsFunds: false,
    bareGreeting: false,
  };
}

function rateIntake(): Intake {
  return killedIntake();
}

