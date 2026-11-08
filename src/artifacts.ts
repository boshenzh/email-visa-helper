import type { Snapshots } from "./knowledge.ts";
import type { CaseRecord, VaultFacts } from "./types.ts";

function stillBlank(facts: VaultFacts, missing: readonly string[]): string {
  const required = missing.length
    ? ["Required labels still blank:", ...missing.map((item) => `- ${item}`), "A blank required label is not filled by this worksheet."]
    : ["Required intake labels are filled. That is not an eligibility finding."];
  const optional: string[] = [];
  if (!facts.currentLocation.trim()) optional.push("- current location");
  if (!facts.fundingNote.trim()) optional.push("- who pays");
  const optionalLines = optional.length
    ? ["Optional labels still not provided. They are not required intake labels:", ...optional]
    : ["Optional current location and who pays were provided."];
  return [...required, ...optionalLines].join("\n");
}

function line(label: string, value: string): string {
  return `- ${label}: ${value.trim() ? value.trim() : "[not provided]"}`;
}

export function renderWorksheet(facts: VaultFacts, record: CaseRecord, snapshots: Snapshots): string {
  return [
    "# Applicant wording worksheet",
    "",
    "This is a clerical copy of words the applicant sent. It is not an application, a declaration, a translation, or a statement that any requirement is met.",
    "The applicant reviews every line, deletes anything wrong, and uses only the official service if they decide to apply.",
    `Official pages were read on ${snapshots.accessed} (${snapshots.accessedTimezone}). Recheck them. They are not permanent rules.`,
    "",
    "## What you wrote (unchecked)",
    line("Nationality / citizenship", facts.nationality),
    line("Ordinary or legal residence", facts.residence),
    line("Current location", facts.currentLocation),
    line("Travel document type", facts.documentType),
    line("Adult", facts.adult),
    line("Purpose in your words", facts.purposeText),
    line("Arrival date", facts.arrival),
    line("Departure date", facts.departure),
    line("Dependants", facts.dependants),
    line("Who pays, in your words", facts.fundingNote),
    line("Previous refusal, overstay, or removal", facts.refusal),
    line("Criminal or safeguarding issue", facts.criminal),
    line(
      "Official checker, as you reported it",
      facts.checker ? `${facts.checker.result} on ${facts.checker.date || "[date not provided]"}` : "",
    ),
    "",
    "Passport numbers and bank details are not copied into this worksheet.",
    "",
    "## Still blank",
    stillBlank(facts, record.missing),
    "",
    "## General published evidence menu",
    "This is the same public menu for every reader. It is not a list of what you personally should file.",
    ...snapshots.documents.menu.map((item) => `- ${item}`),
    "",
    "The guide lists these as less useful, and it does not ask you to buy travel before a decision:",
    ...snapshots.documents.lessUseful.map((item) => `- ${item}`),
    "",
    snapshots.documents.bookings,
    "",
    "## Translations",
    snapshots.documents.translations,
    "",
    "## Appointment",
    ...snapshots.applicationMechanics.map((item) => `- ${item}`),
    "",
    "Case reference (local): " + record.id.slice(0, 12),
  ].join("\n");
}

export function renderReviewNote(facts: VaultFacts, flags: string[], snapshots: Snapshots): string {
  return [
    "# Review note",
    "",
    "A person needs to look at this before any personalised reply. The software has not decided eligibility, a remedy, or which evidence is enough.",
    "",
    "Flags:",
    ...flags.map((flag) => `- ${flag}`),
    "",
    "Applicant statements are stored in the local vault and are not sent to the model.",
    facts.nationality ? "- A nationality statement is on file locally." : "- No nationality statement is on file.",
    "",
    `Adviser finder: https://www.gov.uk/find-an-immigration-adviser`,
    `Checker: https://www.gov.uk/check-uk-visa`,
    `Snapshot date: ${snapshots.accessed}`,
  ].join("\n");
}

export function renderSourceLedger(snapshots: Snapshots): string {
  return [
    "# Source ledger",
    "",
    `Accessed ${snapshots.accessed} (${snapshots.accessedTimezone}). Recheck before use. Not a permanent rule set.`,
    "",
    ...snapshots.routes.map((route) => `- ${route.label}: ${route.url} — ${route.demo}`),
    "",
    `Supporting documents updated ${snapshots.documents.updated}: ${snapshots.documents.url}`,
    "",
    snapshots.identityOutcome.demoRule,
  ].join("\n");
}

export function renderUnknowns(missing: string[]): string {
  return ["# Unknowns", "", ...missing.map((item) => `- ${item}`), ""].join("\n");
}
