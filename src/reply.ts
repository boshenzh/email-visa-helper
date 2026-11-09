import type { Intake } from "./intake.ts";
import { renderStageReply } from "./journey.ts";
import type { Snapshots } from "./knowledge.ts";
import type { PrepStage, ReplyLanguage } from "./types.ts";

const IDENTITY =
  "I’m the AI preparation assistant for visa@boshen.dev. I’m an AI, not a human, and I’m not a regulated immigration adviser. I can’t guarantee a visa.";
const NO_SCANS = "Please don’t email passport scans, bank statements, passwords, or payment details.";
const CHECKER = "I will not decide visa, ETA, or neither. Checker: https://www.gov.uk/check-uk-visa.";
const SUBMITTED = "Nothing has been submitted or paid.";

function questions(missing: string[]): string {
  const labels: Record<string, string> = {
    nationality: "your nationality or citizenships",
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
  const lines = [...new Set(missing.map((item) => labels[item] ?? item))];
  return lines.map((item) => `- ${item}`).join("\n");
}

function letter(paragraphs: string[], lang: ReplyLanguage = "en"): string {
  const hello = lang === "zh" ? "你好，" : "Hello,";
  const sign = lang === "zh" ? "签证准备助手" : "Visa Helper";
  const body = paragraphs.map((part) => part.trim()).filter(Boolean);
  return `${hello}\n\n${body.join("\n\n")}\n\n${sign}\n`;
}

export function composeReply(input: {
  snapshots: Snapshots;
  intake: Intake;
  stopped: string;
  downloadPath: string | null;
  deleted: boolean;
  killed: boolean;
  modelExplanation?: string | null;
  note?: string;
  stage?: PrepStage;
  worksheetUpdated?: boolean;
}): string {
  const lang = input.intake.language ?? "en";
  if (input.killed) {
    return letter([IDENTITY, lang === "zh" ? "这个邮箱暂停了。没有向官方提交。" : "This inbox is paused. Nothing has been submitted."], lang);
  }
  if (input.deleted) {
    return letter([
      IDENTITY,
      lang === "zh"
        ? "我删除了绑定这个已验证邮箱的本地案件。签证机关或模型服务商保存的副本没有删除。"
        : "I deleted the local case bound to this verified email address. I did not delete anything held by a visa authority or by a model provider.",
    ], lang);
  }
  if (input.intake.category === "OUT_OF_SCOPE") {
    return letter([
      lang === "zh"
        ? "谢谢来信。我是 visa@boshen.dev 的人工智能准备助手，不是人类顾问。这个邮箱只帮助准备英国签证材料，所以我无法处理这个请求。"
        : "Thanks for writing. I’m the AI preparation assistant for visa@boshen.dev, and this inbox only helps with UK visa preparation, so I’m unable to help with that request.",
    ], lang);
  }
  if (input.stage === "ESCALATED" && input.intake.category !== "REGULATED_REVIEW_REQUIRED") {
    return letter([
      IDENTITY,
      "Escalated to a qualified adviser",
      "This case already needs a qualified immigration adviser, so I will not continue the visitor preparation pack.",
      NO_SCANS,
      SUBMITTED,
    ], lang);
  }
  if (input.intake.category === "REGULATED_REVIEW_REQUIRED" || input.stage === "ESCALATED") {
    return letter([IDENTITY, "Escalated to a qualified adviser", focusedBody(input), NO_SCANS, SUBMITTED], lang);
  }
  return renderStageReply({
    facts: input.intake.facts,
    stage: input.stage ?? "INTAKE",
    language: lang,
    snapshots: input.snapshots,
    publicTopic: input.intake.publicTopic,
    modelExplanation: lang === "zh" ? null : input.modelExplanation,
    mentionsFunds: input.intake.mentionsFunds,
    note: input.note,
    worksheetUpdated: Boolean(input.worksheetUpdated),
    downloadPath: input.downloadPath,
    injectionIgnored: input.intake.injectionIgnored,
    stopped: input.stopped,
  });
}

function focusedBody(input: { snapshots: Snapshots; intake: Intake }): string {
  const { snapshots, intake } = input;
  const when = `${snapshots.accessed} (${snapshots.accessedTimezone})`;
  const fee = snapshots.feesGbp.standardVisitorUpTo6Months;
  if (intake.category === "REGULATED_REVIEW_REQUIRED") {
    const lines = [
      "This needs a qualified immigration adviser before anyone gives you a personal view. I can’t give a personal view on eligibility, and I have not assessed the statements on file.",
      "Form filling is not a blanket permission to choose a route or an evidence strategy.",
      "For a personal case, start at https://www.gov.uk/find-an-immigration-adviser.",
      CHECKER,
    ];
    if (intake.reviewFlags.includes("possible_british_or_irish")) {
      lines.push("A British or Irish passport is one published example of a document that does not need an ETA. That list is not exhaustive, and I am not deciding that it applies to this message.");
    }
    if (intake.facts.purposeBand === "work" || intake.reviewFlags.includes("work_disguised") || intake.reviewFlags.includes("route_work")) {
      lines.push("Paid work is not permission to work as a Standard Visitor, and I will not choose an ETA or a visitor visa for it. Skilled Worker overview: https://www.gov.uk/skilled-worker-visa. I can’t check a job, a sponsor, or a salary.");
    }
    if (intake.facts.purposeBand === "transit" || intake.reviewFlags.includes("transit_circumstances")) {
      lines.push("Transit depends on whether you go through UK border control. Airside and landside visas differ, and a stay over 48 hours is generally not a Visitor in Transit. Your airline can say whether you pass border control. I will not choose one. https://www.gov.uk/transit-visa.");
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
      CHECKER,
    ];
    if (intake.facts.purposeBand === "ordinary_visitor" && intake.missing.includes("nationality")) {
      lines.push("I will not infer a nationality from a name or the language of an email. For a worksheet, send nationality, travel dates, and who is travelling.");
    }
    if (intake.mentionsFunds) lines.push(fundsLine());
    return lines.join("\n");
  }
  if (intake.publicTopic === "translations") {
    return `${snapshots.documents.translations}\n${CHECKER}`;
  }
  if (intake.publicTopic === "documents") {
    return [
      `General published evidence menu, not a list of what you personally must file (${snapshots.documents.url}):`,
      ...snapshots.documents.menu.slice(0, 4).map((item) => `- ${item}`),
      missingLine(intake),
      CHECKER,
    ].filter(Boolean).join("\n");
  }
  if (intake.publicTopic === "eta") {
    return `Published ETA snapshot ${when}: £${snapshots.feesGbp.eta} per person, including children. ${snapshots.times.etaUsual}. It lasts 2 years or until the passport expires, whichever is sooner. It is not a visa and does not guarantee entry. https://www.gov.uk/eta\n${CHECKER}`;
  }
  if (intake.publicTopic === "processing") {
    return `Published snapshot ${when}: a Standard Visitor decision is usually ${snapshots.times.standardVisitor} after identity and the required documents, not after this email. That is not a promise. https://www.gov.uk/visa-processing-times\n${CHECKER}`;
  }
  if (intake.category === "CLERICAL_APPLICANT_CONTROLLED") {
    return ["I updated a local worksheet from the words you sent. It repeats those words and leaves blanks. It is not an application, and I am not saying the facts meet the visitor rules.", missingLine(intake), CHECKER]
      .filter(Boolean)
      .join("\n");
  }
  return ["I can explain published visitor pages and organise an ordinary-visit worksheet from your own words. I am not deciding that a visitor application is the right route.", CHECKER, missingLine(intake)]
    .filter(Boolean)
    .join("\n");
}

function missingLine(intake: Intake): string {
  if (intake.missing.length === 0) return "";
  return `To continue, I still need a few things in your own words, without scans or identity numbers:\n${questions(intake.missing)}`;
}

function fundsLine(): string {
  return "The visitor rules require sufficient funds for reasonable costs. The supporting-documents guide I read did not state a universal minimum bank balance or a universal six-month statement. I will not invent one.";
}
