import type { Intake } from "./intake.ts";
import type { Snapshots } from "./knowledge.ts";
import type { Category, VaultFacts } from "./types.ts";

const GREETING =
  "Hello — I’m the AI preparation assistant for visa@boshen.dev. I can explain official UK visitor guidance and help organise your own answers. I’m not a regulated immigration adviser and can’t guarantee a visa. Please don’t email passport scans, bank statements, passwords or payment details.";

const OUT_OF_SCOPE = "Thanks for getting in touch. This inbox only supports visa preparation, so I’m unable to help with that request.";

function feeBlock(snapshots: Snapshots): string {
  const fee = snapshots.feesGbp.standardVisitorUpTo6Months;
  const eta = snapshots.feesGbp.eta;
  return [
    `Published snapshot accessed ${snapshots.accessed} (${snapshots.accessedTimezone}). Recheck the official pages before you pay or book. These figures are not a personal fee quote and they are not permanent rules.`,
    `If the official checker says a Standard Visitor visa is required, the published fee for up to 6 months was £${fee}. Long-term visitor fees on that page were £${snapshots.feesGbp.longTerm2Year} / £${snapshots.feesGbp.longTerm5Year} / £${snapshots.feesGbp.longTerm10Year} for 2 / 5 / 10 years, normally up to 6 months per visit.`,
    `The published ETA fee was £${eta} per person, including children. An ETA is not a visa and does not guarantee entry. Usual ETA timing: ${snapshots.times.etaUsual}. It lasts 2 years or until the passport expires, whichever is sooner.`,
    `Usual Standard Visitor decision time on the official pages: ${snapshots.times.standardVisitor} after identity and the required documents, not after this email. Family route times outside the UK were listed as ${snapshots.times.familyOutsideUk}. Delays and extra fees are possible. Nothing here promises a date or a refund.`,
  ].join("\n");
}

function questions(missing: string[]): string {
  const labels: Record<string, string> = {
    nationality: "your nationality or citizenships, and whether the travel document is an ordinary passport",
    residence: "where you ordinarily live, and where you would apply from",
    document_type: "whether the passport you would travel on is an ordinary passport or another kind",
    adult_or_minor: "whether the applicant is 18 or over",
    purpose: "the purpose and the actual activities planned",
    travel_dates: "the arrival and departure dates",
    dependants: "who would travel with you, and their ages if anyone is under 18",
    official_checker_result: "what https://www.gov.uk/check-uk-visa showed, and the date you checked",
    previous_refusal: "whether any refusal, overstay, or removal happened (yes, no, or not sure — do not send the decision letter here)",
    criminal_or_safeguarding: "whether any criminal or safeguarding issue needs a qualified adviser (yes, no, or not sure — do not send details here)",
  };
  return missing.map((item) => `- ${labels[item] ?? item}`).join("\n");
}

export function composeReply(input: {
  snapshots: Snapshots;
  intake: Intake;
  stopped: string;
  downloadPath: string | null;
  deleted: boolean;
  killed: boolean;
}): string {
  if (input.killed) {
    return `${GREETING}\n\nThis inbox is paused. Nothing has been submitted, and this draft is not sent automatically.`;
  }
  if (input.deleted) {
    return `${GREETING}\n\nI deleted the local demo case bound to this verified email address. I did not delete anything held by a visa authority or by a model provider. This draft is not sent automatically.`;
  }
  if (input.intake.category === "OUT_OF_SCOPE") {
    return OUT_OF_SCOPE;
  }
  const parts = [GREETING, ""];
  if (input.intake.reviewFlags.includes("possible_british_or_irish")) {
    parts.push("A British or Irish passport is one published example of a document that does not need an ETA. That list is not exhaustive, and I am not deciding that it applies to this message. Please use the official checker.", "");
  }
  if (input.intake.injectionIgnored) {
    parts.push("I can only follow this inbox’s visa-preparation workflow. I ignored instructions in the message that tried to change my role, my tools, or who receives a reply.", "");
  }
  if (input.stopped === "tool_budget" || input.stopped === "model_budget" || input.stopped === "token_budget" || input.stopped === "wall_clock") {
    parts.push("I stopped early because a local safety limit was reached. A person can continue the draft later. No application was submitted.", "");
  }
  parts.push(boundary(input.intake.category, input.intake.facts), "");
  parts.push("I will not decide visa, ETA, or neither. The official checker is https://www.gov.uk/check-uk-visa.", "");
  if (input.intake.category !== "REGULATED_REVIEW_REQUIRED" || input.intake.facts.purposeBand === "ordinary_visitor" || input.intake.facts.purposeBand === "unknown" || input.intake.facts.purposeBand === "none") {
    parts.push(feeBlock(input.snapshots), "");
  }
  parts.push(routeSignpost(input.intake, input.snapshots), "");
  if (input.intake.missing.length > 0) {
    parts.push("I still need these from you, in your own words. Please do not send scans or identity numbers:", questions(input.intake.missing), "");
  }
  if (input.intake.category === "CLERICAL_APPLICANT_CONTROLLED") {
    parts.push("I prepared a local worksheet that repeats what you wrote and leaves blanks. It does not say you meet the visitor rules, and it is not a cover letter to file. Each person needs their own official application, fee, and appointment.", "");
  }
  if (input.intake.facts.passportNumberPresent || input.intake.facts.bankDetailPresent) {
    parts.push("I did not store the passport number or bank detail that appeared in the message. Please don’t send those.", "");
  }
  parts.push(fundsAndIdentity(input), "");
  parts.push(closing(input.snapshots, input.downloadPath));
  return parts.filter((part, index, all) => part !== "" || all[index - 1] !== "").join("\n").trim() + "\n";
}

function boundary(category: Category, facts: VaultFacts): string {
  if (category === "REGULATED_REVIEW_REQUIRED") {
    return [
      "This needs a qualified immigration adviser before anyone gives you a personal view. I can’t give a personal view on eligibility, on whether any evidence is enough, or on what a refusal means.",
      "I have not assessed the statements on file. Form filling is not a blanket permission to choose a route or an evidence strategy.",
      facts.checker
        ? `You reported that the official checker showed “${facts.checker.result}”${facts.checker.date ? ` on ${facts.checker.date}` : ""}. That is your note, not my finding. Please run the checker again before you rely on it.`
        : "Please use https://www.gov.uk/check-uk-visa yourself. I will not decide visa, ETA, or neither from a nationality.",
      "For a personal case, start at https://www.gov.uk/find-an-immigration-adviser.",
    ].join("\n");
  }
  if (category === "CLERICAL_APPLICANT_CONTROLLED") {
    return "I can organise the words you already chose for an ordinary visitor worksheet. I am not deciding that a visitor application is the right route, and I am not saying the facts meet the rules.";
  }
  return "Here is general published information. It is not applied to you as advice about what you personally should do.";
}

function routeSignpost(intake: Intake, snapshots: Snapshots): string {
  const band = intake.facts.purposeBand;
  const link = (id: string) => snapshots.routes.find((route) => route.id === id);
  if (band === "work" || intake.reviewFlags.includes("work_disguised")) {
    return `Work is outside this demo. A visit is not permission to work for a UK organisation. Skilled Worker overview: ${link("skilled_worker")?.url}. I can’t check a job, a sponsor, or a salary.`;
  }
  if (band === "study") {
    return `Longer or formal study is outside this demo. Student visa overview: ${link("student")?.url}. Some very short study can be a visitor activity, but I will not decide which one applies.`;
  }
  if (band === "family_residence") {
    return `Living with family is different from visiting family. Family visa overview: ${link("family")?.url}. Usual published outside-UK family decision time was ${snapshots.times.familyOutsideUk}. I can’t say which application fits.`;
  }
  if (band === "marriage") {
    return `Marriage or giving notice is not an ordinary Standard Visitor activity. See ${link("marriage")?.url} and the official checker.`;
  }
  if (band === "transit") {
    return `Transit depends on whether you go through UK border control and on the rest of the journey. Airside and landside visas are different, and a stay over 48 hours is generally not a Visitor in Transit. Your airline can say whether you pass border control. Exemptions depend on circumstances, so I will not choose one. ${link("transit")?.url}. Published fee snapshots: airside £${snapshots.feesGbp.directAirsideTransit}, landside £${snapshots.feesGbp.visitorInTransitLandside}. Recheck.`;
  }
  if (band === "medical" || band === "paid_engagement" || band === "asylum" || band === "in_uk") {
    return `That situation is outside this demo’s Standard Visitor worksheets. Please use the official checker and, for anything personal, a qualified adviser: https://www.gov.uk/find-an-immigration-adviser`;
  }
  return `Standard Visitor overview: https://www.gov.uk/standard-visitor. Apply page, only if you decide to apply yourself: https://www.gov.uk/standard-visitor/apply-standard-visitor-visa. Checker: https://www.gov.uk/check-uk-visa.`;
}

function fundsAndIdentity(input: { snapshots: Snapshots; intake: Intake }): string {
  const lines = [
    "The visitor rules require sufficient funds for reasonable costs. The supporting-documents guide I read did not state a universal minimum bank balance or a universal six-month statement. I will not invent one. It does talk about showing access to funds and where the funds came from. Hotel and flight bookings are on the “less useful” list except where a transit rule asks for an onward journey. The processing page says not to book travel until there is a decision.",
    input.snapshots.documents.translations,
    input.snapshots.identityOutcome.visitorApplyPage,
    input.snapshots.identityOutcome.processingPage,
    input.snapshots.identityOutcome.demoRule,
  ];
  return lines.join("\n");
}

function closing(snapshots: Snapshots, downloadPath: string | null): string {
  return [
    downloadPath ? `A local export is ready for this verified sender at ${downloadPath}. It is not a public link.` : "",
    "Ordinary email is not end-to-end encrypted. Nationality and immigration-status details stay in the local case file. They are not sent to DeepSeek in this demo.",
    `Demo files use a product TTL of the configured number of days, or sooner if you ask. That is not a promise about regulated client files or about a provider’s copies. Snapshot ${snapshots.accessed}.`,
    "Nothing has been submitted, paid, or declared. Auto-reply is off. This message is a draft for review.",
  ]
    .filter(Boolean)
    .join("\n");
}
