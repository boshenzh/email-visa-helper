import type { Intake } from "./intake.ts";
import type { Snapshots } from "./knowledge.ts";

const GREETING =
  "Hello — I’m the AI preparation assistant for visa@boshen.dev. I can explain official UK visitor guidance and help organise your own answers. I’m not a regulated immigration adviser and can’t guarantee a visa. Please don’t email passport scans, bank statements, passwords or payment details.";

const OUT_OF_SCOPE = "Thanks for getting in touch. This inbox only supports visa preparation, so I’m unable to help with that request.";

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
  modelExplanation?: string | null;
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
  if (input.intake.injectionIgnored) {
    parts.push("I ignored instructions in the message that tried to change my role, my tools, or who receives a reply.", "");
  }
  if (input.stopped === "provider_failure") {
    parts.push("The model service did not answer. The note below is the local published snapshot, not an AI explanation.", "");
  }
  if (input.modelExplanation) {
    parts.push("AI-generated general explanation of the published pages, not about you:", input.modelExplanation, "");
  }
  parts.push(focusedBody(input), "");
  if (input.downloadPath) parts.push(`A local export for this verified sender is at ${input.downloadPath}. It is not a public link.`, "");
  parts.push("Nothing has been submitted or paid. This message is a draft and is not sent automatically.", "");
  return parts.filter((part, index, all) => part !== "" || all[index - 1] !== "").join("\n").trim() + "\n";
}

function focusedBody(input: { snapshots: Snapshots; intake: Intake }): string {
  const { snapshots, intake } = input;
  const when = `${snapshots.accessed} (${snapshots.accessedTimezone})`;
  const fee = snapshots.feesGbp.standardVisitorUpTo6Months;
  const checker = "I will not decide visa, ETA, or neither. Checker: https://www.gov.uk/check-uk-visa.";
  if (intake.category === "REGULATED_REVIEW_REQUIRED") {
    const lines = [
      "This needs a qualified immigration adviser before anyone gives you a personal view. I can’t give a personal view on eligibility, and I have not assessed the statements on file.",
      "Form filling is not a blanket permission to choose a route or an evidence strategy.",
      "For a personal case, start at https://www.gov.uk/find-an-immigration-adviser.",
      checker,
    ];
    if (intake.reviewFlags.includes("possible_british_or_irish")) {
      lines.push("A British or Irish passport is one published example of a document that does not need an ETA. That list is not exhaustive, and I am not deciding that it applies to this message.");
    }
    if (intake.facts.purposeBand === "work" || intake.reviewFlags.includes("work_disguised") || intake.reviewFlags.includes("route_work")) {
      lines.push("Paid work is not permission to work as a Standard Visitor, and I will not choose an ETA or a visitor visa for it. Skilled Worker overview: https://www.gov.uk/skilled-worker-visa. I can’t check a job, a sponsor, or a salary.");
    }
    if (intake.facts.purposeBand === "transit" || intake.reviewFlags.includes("transit_circumstances")) {
      lines.push(`Transit depends on whether you go through UK border control. Airside and landside visas differ, and a stay over 48 hours is generally not a Visitor in Transit. Your airline can say whether you pass border control. I will not choose one. https://www.gov.uk/transit-visa.`);
    }
    if (intake.facts.purposeBand === "study") lines.push("Longer or formal study is outside this demo. Student visa overview: https://www.gov.uk/student-visa. I will not decide whether a short course is a visitor activity.");
    if (intake.facts.purposeBand === "family_residence") lines.push("Living with family is different from visiting family. https://www.gov.uk/uk-family-visa. I can’t say which application fits.");
    if (intake.facts.purposeBand === "marriage") lines.push("Marriage or giving notice is not an ordinary Standard Visitor activity. https://www.gov.uk/marriage-visa.");
    if (intake.reviewFlags.includes("vac_instruction_conflict")) {
      lines.push(snapshots.identityOutcome.visitorApplyPage, snapshots.identityOutcome.processingPage, snapshots.identityOutcome.demoRule);
    }
    if (intake.reviewFlags.includes("minor")) lines.push("A child or a 16- or 17-year-old needs their own checks, including consent if they are not travelling with a parent. I will not fill in the form.");
    return lines.join("\n");
  }
  if (intake.publicTopic === "fees") {
    const lines = [
      `Published snapshot ${when}: a Standard Visitor visa for up to 6 months was £${fee}. Recheck https://www.gov.uk/standard-visitor/apply-standard-visitor-visa before you pay. This is not a personal fee quote.`,
      checker,
    ];
    if (intake.facts.purposeBand === "ordinary_visitor" && intake.missing.includes("nationality")) {
      lines.push("I will not infer a nationality from a name or the language of an email. For a worksheet, send nationality, travel dates, and who is travelling.");
    }
    if (intake.mentionsFunds) lines.push(fundsLine());
    return lines.join("\n");
  }
  if (intake.publicTopic === "translations") {
    return `${snapshots.documents.translations}\n${checker}`;
  }
  if (intake.publicTopic === "documents") {
    return [
      `General published evidence menu, not a list of what you personally must file (${snapshots.documents.url}):`,
      ...snapshots.documents.menu.slice(0, 4).map((item) => `- ${item}`),
      missingLine(intake),
      checker,
    ].filter(Boolean).join("\n");
  }
  if (intake.publicTopic === "eta") {
    return `Published ETA snapshot ${when}: £${snapshots.feesGbp.eta} per person, including children. ${snapshots.times.etaUsual}. It lasts 2 years or until the passport expires, whichever is sooner. It is not a visa and does not guarantee entry. https://www.gov.uk/eta\n${checker}`;
  }
  if (intake.publicTopic === "processing") {
    return `Published snapshot ${when}: a Standard Visitor decision is usually ${snapshots.times.standardVisitor} after identity and the required documents, not after this email. That is not a promise. https://www.gov.uk/visa-processing-times\n${checker}`;
  }
  if (intake.category === "CLERICAL_APPLICANT_CONTROLLED") {
    return [
      "I updated a local worksheet from the words you sent. It repeats those words and leaves blanks. It is not an application, and I am not saying the facts meet the visitor rules.",
      missingLine(intake),
      checker,
    ].filter(Boolean).join("\n");
  }
  const lines = [
    "I can explain published visitor pages and organise an ordinary-visit worksheet from your own words. I am not deciding that a visitor application is the right route.",
    checker,
    missingLine(intake),
  ];
  return lines.filter(Boolean).join("\n");
}

function missingLine(intake: Intake): string {
  if (intake.missing.length === 0) return "";
  return `I still need, in your own words and without scans or identity numbers:\n${questions(intake.missing)}`;
}

function fundsLine(): string {
  return "The visitor rules require sufficient funds for reasonable costs. The supporting-documents guide I read did not state a universal minimum bank balance or a universal six-month statement. I will not invent one.";
}
