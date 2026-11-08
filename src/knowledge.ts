import fs from "node:fs";
import type { AppConfig } from "./config.ts";

export interface Snapshots {
  accessed: string;
  accessedTimezone: string;
  recheckBeforeUse: boolean;
  notPermanent: boolean;
  note: string;
  feesGbp: {
    standardVisitorUpTo6Months: number;
    longTerm2Year: number;
    longTerm5Year: number;
    longTerm10Year: number;
    medicalUpTo11Months: number;
    academicUpTo12Months: number;
    eta: number;
    visitorInTransitLandside: number;
    directAirsideTransit: number;
  };
  feeNotes: string[];
  times: {
    standardVisitor: string;
    marriageVisitor: string;
    transit: string;
    student: string;
    skilledWorker: string;
    familyOutsideUk: string;
    etaUsual: string;
  };
  timeNotes: string[];
  identityOutcome: {
    visitorApplyPage: string;
    processingPage: string;
    demoRule: string;
  };
  eligibilityNotes: string[];
  documents: {
    updated: string;
    url: string;
    menu: string[];
    lessUseful: string[];
    translations: string;
    bookings: string;
  };
  applicationMechanics: string[];
  eta: { url: string; applyUrl: string; notes: string[] };
  routes: { id: string; label: string; url: string; demo: string }[];
}

export function loadSnapshots(config: AppConfig): Snapshots {
  const parsed = JSON.parse(fs.readFileSync(config.knowledgePath, "utf8")) as Snapshots;
  const fee = parsed.feesGbp.standardVisitorUpTo6Months;
  const eta = parsed.feesGbp.eta;
  if (fee !== 135 || eta !== 20) {
    throw new Error("Refusing to start: snapshot fees are not the 2026-11-08 checked figures (£135 visitor, £20 ETA). Update the file only after re-reading the official pages.");
  }
  if (parsed.times.standardVisitor !== "3 weeks") {
    throw new Error("Refusing to start: snapshot visitor processing time is not the checked 3 weeks.");
  }
  if (parsed.accessed !== "2026-11-08") {
    throw new Error("Snapshot access date must be updated in the loader check when the sources are re-read.");
  }
  return parsed;
}

export type OfficialTopic =
  | "fees"
  | "eta"
  | "documents"
  | "processing"
  | "visitor"
  | "routes"
  | "translations"
  | "identity"
  | "checker";

export const OFFICIAL_TOPICS: readonly OfficialTopic[] = [
  "fees",
  "eta",
  "documents",
  "processing",
  "visitor",
  "routes",
  "translations",
  "identity",
  "checker",
];

export function officialSummary(snapshots: Snapshots, topic: OfficialTopic): string {
  const when = `${snapshots.accessed} (${snapshots.accessedTimezone})`;
  switch (topic) {
    case "fees":
      return `Snapshot ${when}, recheck before payment. Standard Visitor up to 6 months: £${snapshots.feesGbp.standardVisitorUpTo6Months}. Long-term 2/5/10 year: £${snapshots.feesGbp.longTerm2Year}/£${snapshots.feesGbp.longTerm5Year}/£${snapshots.feesGbp.longTerm10Year}. ETA: £${snapshots.feesGbp.eta}. These are published figures, not a quote for one person.`;
    case "eta":
      return `Snapshot ${when}. ETA £${snapshots.feesGbp.eta} per person including children. ${snapshots.times.etaUsual}. Valid 2 years or until the passport expires, whichever is sooner. Not a visa and not guaranteed entry. ${snapshots.eta.url}`;
    case "documents":
      return `Supporting-documents guide updated ${snapshots.documents.updated}. General menu only, not a personal evidence list. No universal minimum balance or universal six-month statement was stated. ${snapshots.documents.url}`;
    case "processing":
      return `Snapshot ${when}. Standard Visitor usually ${snapshots.times.standardVisitor} after identity and required documents. Family partner/parent/child/adult relative outside the UK usually ${snapshots.times.familyOutsideUk}. Not a promise.`;
    case "visitor":
      return `Standard Visitor overview: usually up to 6 months for permitted activities. Not every business or work activity is allowed. https://www.gov.uk/standard-visitor`;
    case "routes":
      return snapshots.routes.map((route) => `${route.label}: ${route.url}`).join("\n");
    case "translations":
      return snapshots.documents.translations;
    case "identity":
      return `${snapshots.identityOutcome.visitorApplyPage} ${snapshots.identityOutcome.processingPage} ${snapshots.identityOutcome.demoRule}`;
    case "checker":
      return "Use https://www.gov.uk/check-uk-visa and record the result and date yourself. This assistant does not decide visa, ETA, or neither.";
    default:
      return "Unknown topic.";
  }
}
