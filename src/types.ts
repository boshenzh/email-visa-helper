export type Category =
  | "GENERAL_INFORMATION"
  | "CLERICAL_APPLICANT_CONTROLLED"
  | "REGULATED_REVIEW_REQUIRED"
  | "OUT_OF_SCOPE";

export type PurposeBand =
  | "ordinary_visitor"
  | "study"
  | "work"
  | "family_residence"
  | "transit"
  | "marriage"
  | "medical"
  | "paid_engagement"
  | "in_uk"
  | "asylum"
  | "unknown"
  | "none";

export interface AttachmentMeta {
  filename: string;
  mediaType: string;
  bytes: number;
  accepted: boolean;
}

export interface InboundEvent {
  envelopeFrom: string;
  envelopeTo: string;
  headerFrom: string;
  replyTo: string;
  subject: string;
  messageId: string;
  inReplyTo: string;
  references: string[];
  authenticationResults: string;
  autoSubmitted: string;
  precedence: string;
  extraHeaders: Record<string, string>;
  text: string;
  htmlIgnored: boolean;
  attachments: AttachmentMeta[];
  referenceCount: number;
}

export type PrepStage =
  | "INTAKE"
  | "ROUTE_CHECK"
  | "PURPOSE_AND_TRIP"
  | "DOCUMENT_CHECKLIST"
  | "DOCUMENT_TRACKING"
  | "SUPPORTING_LETTERS"
  | "FINAL_PACK"
  | "DONE"
  | "ESCALATED";

export type DocStatus = "ready" | "pending" | "missing";

export type ReplyLanguage = "en" | "zh";

export interface CheckerStatement {
  result: "visa" | "eta" | "neither" | "unknown";
  date: string;
}

export interface VaultFacts {
  nationality: string;
  residence: string;
  currentLocation: string;
  documentType: string;
  adult: "yes" | "no" | "unknown";
  purposeText: string;
  purposeBand: PurposeBand;
  arrival: string;
  departure: string;
  dependants: string;
  fundingNote: string;
  checker: CheckerStatement | null;
  refusal: "yes" | "no" | "unsure" | "unknown";
  criminal: "yes" | "no" | "unsure" | "unknown";
  passportNumberPresent: boolean;
  bankDetailPresent: boolean;
  /** What the customer says they already have. Never a scan. */
  documents: Record<string, DocStatus>;
  docsAnswered: boolean;
  draftAccepted: boolean;
  travellerCount: number;
  travellerNote: string;
}

export interface CaseRecord {
  id: string;
  sender: string | null;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
  category: Category;
  purposeBand: PurposeBand;
  reviewFlags: string[];
  missing: string[];
  synthetic: boolean;
  threadIds: string[];
  messageIds: string[];
  artifactNames: string[];
  consentNoticeShown: boolean;
  vaultMode: "aes-256-gcm" | "plaintext-demo";
  stage: PrepStage;
  language: ReplyLanguage;
  packHash: string;
  checklistDelivered: boolean;
  lettersDelivered: boolean;
}

export interface PublicView {
  category: Category;
  purposeBand: PurposeBand;
  missing: string[];
  checkerRecorded: boolean;
  reviewFlags: string[];
  synthetic: boolean;
}

export interface OutboxDraft {
  id: string;
  caseId: string | null;
  threadId: string;
  idempotencyKey: string;
  to: string | null;
  subject: string;
  text: string;
  status: "draft" | "approved_not_sent" | "queued" | "sent" | "failed" | "suppressed" | "held_unverified";
  reason: string;
  providerAttempted: boolean;
  providerMessageId: string | null;
  attempts: number;
  createdAt: string;
  inReplyTo: string;
  references: string[];
  /** Markdown pack attached on the Resend send. Null until FINAL_PACK. */
  packFile: { filename: string; contentType: string; text: string } | null;
}

export interface InboundResult {
  ok: boolean;
  action: "draft" | "suppressed" | "duplicate" | "retry" | "deleted" | "rejected";
  caseId: string | null;
  outboxId: string | null;
  category: Category | null;
  reviewFlags: string[];
  reply: string;
  artifactNames: string[];
  modelRequests: number;
  modelReason: string;
  toolNames: string[];
  stopped: string;
}
