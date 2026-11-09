import type { OfficialTopic, Snapshots } from "./knowledge.ts";
import { sha256 } from "./security.ts";
import type { DocStatus, PrepStage, ReplyLanguage, VaultFacts } from "./types.ts";

const GUIDE = "https://www.gov.uk/government/publications/visitor-visa-guide-to-supporting-documents/guide-to-supporting-documents-visiting-the-uk";
const APPLY = "https://www.gov.uk/standard-visitor/apply-standard-visitor-visa";
const CHECKER_URL = "https://www.gov.uk/check-uk-visa";

const STEP_ORDER = ["INTAKE", "ROUTE_CHECK", "PURPOSE_AND_TRIP", "DOCUMENT_CHECKLIST", "DOCUMENT_TRACKING", "SUPPORTING_LETTERS"] as const;

export interface StagePrior {
  checklistDelivered: boolean;
  lettersDelivered: boolean;
  packHash: string;
}

export function intakeReady(facts: VaultFacts): boolean {
  return Boolean(facts.nationality && facts.documentType && facts.adult !== "unknown");
}

export function tripReady(facts: VaultFacts): boolean {
  const purpose = Boolean(facts.purposeText) || (facts.purposeBand !== "none" && facts.purposeBand !== "unknown");
  return Boolean(purpose && facts.arrival && facts.departure && (facts.dependants || facts.travellerCount > 0));
}

export function resolveStage(prior: StagePrior, facts: VaultFacts, escalated: boolean, fingerprint: string): PrepStage {
  if (escalated) return "ESCALATED";
  if (!intakeReady(facts)) return "INTAKE";
  if (!facts.checker) return "ROUTE_CHECK";
  if (!tripReady(facts)) return "PURPOSE_AND_TRIP";
  if (!prior.checklistDelivered) return "DOCUMENT_CHECKLIST";
  if (!facts.docsAnswered) return "DOCUMENT_TRACKING";
  if (!prior.lettersDelivered) return "SUPPORTING_LETTERS";
  if (prior.packHash && fingerprint === prior.packHash) return "DONE";
  return "FINAL_PACK";
}

export function packFingerprint(facts: VaultFacts, fee: number): string {
  return sha256(JSON.stringify({ pack: publicPack(facts), fee }));
}

export function renderStageReply(input: {
  facts: VaultFacts;
  stage: PrepStage;
  language: ReplyLanguage;
  snapshots: Snapshots;
  publicTopic: OfficialTopic | null;
  modelExplanation?: string | null;
  mentionsFunds: boolean;
  note?: string;
  worksheetUpdated: boolean;
  downloadPath: string | null;
  injectionIgnored: boolean;
  stopped: string;
}): string {
  const lang = input.language;
  const t = copy(lang);
  const parts = [t.identity, banner(input.stage, lang), progress(input.facts, lang)];
  if (input.injectionIgnored) parts.push(t.injection);
  if (input.stopped === "provider_failure") parts.push(t.provider);
  if (input.modelExplanation && lang === "en") {
    parts.push(`AI-generated general explanation of the published pages, not about you:\n${input.modelExplanation}`);
  }
  const brief = briefPublic(input.publicTopic, input.snapshots, lang, input.mentionsFunds, input.facts);
  if (brief) parts.push(brief);
  parts.push(stageBody(input.stage, input.facts, input.snapshots, lang));
  if (input.stage !== "FINAL_PACK" && input.stage !== "ROUTE_CHECK") parts.push(t.noVerdict);
  if (input.worksheetUpdated) parts.push(t.worksheet);
  if (input.downloadPath) parts.push(`${t.export} ${input.downloadPath}`);
  parts.push(t.noScans, input.note ?? "", t.submitted);
  return letter(parts, lang);
}

export function renderPackMarkdown(facts: VaultFacts, snapshots: Snapshots, lang: ReplyLanguage): string {
  const t = copy(lang);
  return [`# ${t.packTitle}`, "", t.identity, "", t.noVerdict, "", stageBody("FINAL_PACK", facts, snapshots, lang), "", t.noScans, ""].join("\n");
}

function stageBody(stage: PrepStage, facts: VaultFacts, snapshots: Snapshots, lang: ReplyLanguage): string {
  const t = copy(lang);
  if (stage === "INTAKE") return `${t.next}\n${bullets(intakeQuestions(facts, lang))}`;
  if (stage === "ROUTE_CHECK") return `${t.checkerNext}\n${CHECKER_URL}\n${t.noVerdict}\n${bullets([t.askChecker, t.askCheckerDate])}`;
  if (stage === "PURPOSE_AND_TRIP") return `${t.tripNext}\n${bullets(tripQuestions(facts, lang))}`;
  if (stage === "DOCUMENT_CHECKLIST") return `${t.docIntro}\n${GUIDE}\n${checklist(facts, lang)}\n${t.docAck}`;
  if (stage === "DOCUMENT_TRACKING") return `${t.trackIntro}\n${checklist(facts, lang)}\n${t.trackNext}`;
  if (stage === "SUPPORTING_LETTERS") {
    const drafts = draftTexts(facts, lang);
    return `${t.letterIntro}\n\n${drafts.itinerary}\n\n${drafts.cover}\n\n${t.letterNext}`;
  }
  if (stage === "DONE") return t.done;
  if (stage === "ESCALATED") return t.escalated;
  return packBody(facts, snapshots, lang);
}

function intakeQuestions(facts: VaultFacts, lang: ReplyLanguage): string[] {
  const zh = lang === "zh";
  const items: string[] = [];
  if (!facts.nationality) items.push(zh ? "你的国籍或公民身份" : "your nationality or citizenships");
  if (facts.adult === "unknown") items.push(zh ? "申请人是否已满 18 岁" : "whether the applicant is 18 or over");
  if (!facts.documentType) items.push(zh ? "旅行证件是普通护照，还是别的种类" : "whether the passport you would travel on is an ordinary passport or another kind");
  if (!facts.residence) items.push(zh ? "你平时住在哪里" : "where you ordinarily live");
  return items.slice(0, 4);
}

function tripQuestions(facts: VaultFacts, lang: ReplyLanguage): string[] {
  const zh = lang === "zh";
  const items: string[] = [];
  if (!facts.purposeText && (facts.purposeBand === "none" || facts.purposeBand === "unknown")) {
    items.push(zh ? "这次去英国要做什么（旅游、探亲或商务访问）" : "the purpose of the trip: tourism, visiting family, or a business visit");
  }
  if (!facts.arrival || !facts.departure) items.push(zh ? "计划到达和离开的日期" : "the arrival and departure dates");
  if (!facts.dependants && facts.travellerCount === 0) items.push(zh ? "谁一起去；如果只有你，就说只有你" : "who is travelling with you, or say it is just you");
  if (facts.refusal === "unknown") items.push(zh ? "是否有过拒签或逾期停留（是、否、不确定）。不要发决定书" : "whether any refusal or overstay happened (yes, no, or not sure). Do not send the letter");
  return items.slice(0, 4);
}

function bullets(items: string[]): string {
  return items.filter(Boolean).map((item) => `- ${item}`).join("\n");
}

function progress(facts: VaultFacts, lang: ReplyLanguage): string {
  const zh = lang === "zh";
  const lines: string[] = [];
  if (facts.purposeText) lines.push(zh ? `目的：${facts.purposeText}` : `Purpose: ${facts.purposeText}`);
  if (facts.nationality) lines.push(zh ? `国籍：${facts.nationality}` : `Nationality: ${facts.nationality}`);
  if (facts.residence) lines.push(zh ? `居住地：${facts.residence}` : `Where you live: ${facts.residence}`);
  if (facts.documentType) lines.push(zh ? `证件：${facts.documentType}` : `Travel document: ${facts.documentType}`);
  if (facts.adult !== "unknown") lines.push(zh ? `是否满 18 岁：${facts.adult === "yes" ? "是" : "否"}` : `18 or over: ${facts.adult}`);
  if (facts.arrival && facts.departure) lines.push(zh ? `日期：${facts.arrival} 到 ${facts.departure}` : `Dates: ${facts.arrival} to ${facts.departure}`);
  if (facts.travellerCount > 1) lines.push(zh ? `同行：${facts.travellerCount} 人（${facts.travellerNote}）` : `Travellers: ${facts.travellerCount} (${facts.travellerNote})`);
  else if (facts.dependants) lines.push(zh ? `同行：${facts.dependants}` : `Travelling: ${facts.dependants}`);
  if (facts.checker) lines.push(zh ? `你报告的官方查询：${facts.checker.result}，${facts.checker.date || "未写日期"}` : `Checker, as you reported it: ${facts.checker.result} on ${facts.checker.date || "date not given"}`);
  const title = zh ? "目前记下的是：" : "Here's what we have so far:";
  if (lines.length === 0) return zh ? "目前记下的是：还没有具体事实。" : "Here's what we have so far: nothing yet.";
  return `${title}\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

function purposeKind(facts: VaultFacts): "tourism" | "family" | "business" {
  const text = `${facts.purposeText} ${facts.purposeBand}`.toLowerCase();
  if (/family|探亲|看望|friend/.test(text)) return "family";
  if (/business|conference|meeting|商务|会议/.test(text)) return "business";
  return "tourism";
}

function docIds(facts: VaultFacts): string[] {
  const ids = ["passport", "home", "funds", "activity"];
  const kind = purposeKind(facts);
  if (kind === "family" || kind === "business") ids.push("invitation");
  return ids;
}

function checklist(facts: VaultFacts, lang: ReplyLanguage): string {
  return docIds(facts).map((id) => `- ${docLabel(id, lang)} — ${statusWord(facts.documents[id] ?? "missing", lang)}`).join("\n");
}

function docLabel(id: string, lang: ReplyLanguage): string {
  const zh = lang === "zh";
  const labels: Record<string, string> = {
    passport: zh ? "有效护照或旅行证件" : "Valid passport or travel document",
    home: zh ? "国内工作、学习或自雇情况（用你自己的话）" : "Home circumstances, such as work or study, in your own words",
    funds: zh ? "如何支付行程、资金从哪里来（不要发数字或扫描件）" : "How you will pay and where the money comes from, in your own words, with no account numbers",
    activity: zh ? "这次访问打算做的事（用你自己的话）" : "What you plan to do on the visit, in your own words",
    invitation: zh ? "谁邀请你或你去看望谁，以及关系（用你自己的话）" : "Who invited you or who you will visit, and the relationship, in your own words",
  };
  return labels[id] ?? id;
}

function statusWord(status: DocStatus, lang: ReplyLanguage): string {
  if (lang === "zh") return status === "ready" ? "已有" : status === "pending" ? "还在准备" : "还没有";
  return status;
}

function draftTexts(facts: VaultFacts, lang: ReplyLanguage): { itinerary: string; cover: string } {
  const zh = lang === "zh";
  const purpose = facts.purposeText || (zh ? "一次访问" : "a visit");
  const who = facts.travellerCount > 1 ? (zh ? `我们 ${facts.travellerCount} 人` : facts.travellerNote || `${facts.travellerCount} travellers`) : zh ? "我" : "I";
  const itinerary = zh
    ? `行程草稿（请你改。这不是要递交的文件）：\n${facts.arrival || "[到达日期]"}：${who}按计划抵达。\n停留期间：${purpose}。\n${facts.departure || "[离开日期]"}：按计划离开。`
    : `Itinerary draft for you to edit. This is not a document to file:\n${facts.arrival || "[arrival]"}: ${who} arrive as planned.\nDuring the stay: ${purpose}.\n${facts.departure || "[departure]"}: leave as planned.`;
  const cover = zh
    ? `说明信草稿（请你改。它不表示你符合规定）：\n我是${facts.nationality || "[国籍]"}公民，平时住在${facts.residence || "[居住地]"}。我计划于 ${facts.arrival || "[到达]"} 至 ${facts.departure || "[离开]"} 访问英国，目的是${purpose}。访问结束后我会离开。${facts.refusal === "no" ? "我没有被拒签过。" : ""}${facts.travellerCount > 1 ? "每位同行者都要单独申请。" : ""}`
    : `Cover letter draft for you to edit. It does not say the rules are met:\nI am a ${facts.nationality || "[nationality]"} citizen and I live in ${facts.residence || "[where you live]"}. I plan to visit the UK from ${facts.arrival || "[arrival]"} to ${facts.departure || "[departure]"} for ${purpose}. I will leave at the end of that visit. ${facts.refusal === "no" ? "I have not been refused a visa. " : ""}${facts.travellerCount > 1 ? "Each person will apply separately." : ""}`;
  return { itinerary, cover };
}

function packBody(facts: VaultFacts, snapshots: Snapshots, lang: ReplyLanguage): string {
  const zh = lang === "zh";
  const fee = snapshots.feesGbp.standardVisitorUpTo6Months;
  const drafts = draftTexts(facts, lang);
  const t = copy(lang);
  const form = [
    field(zh ? "旅行证件" : "Travel document", facts.documentType, lang),
    field(zh ? "国籍" : "Nationality", facts.nationality, lang),
    field(zh ? "访问目的" : "Purpose of visit", facts.purposeText, lang),
    field(zh ? "到达日期" : "Arrival date", facts.arrival, lang),
    field(zh ? "离开日期" : "Departure date", facts.departure, lang),
    field(zh ? "同行人" : "People travelling", facts.travellerNote || facts.dependants, lang),
    field(zh ? "居住地" : "Where you live", facts.residence, lang),
    field(zh ? "费用由谁支付（你的原话）" : "Who pays, in your words", facts.fundingNote, lang),
    field(zh ? "你报告的官方查询" : "Official checker, as you reported it", facts.checker ? `${facts.checker.result} (${facts.checker.date || ""})` : "", lang),
    field(zh ? "拒签或逾期" : "Refusal or overstay", facts.refusal, lang),
    field(zh ? "犯罪或保护问题" : "Criminal or safeguarding", facts.criminal, lang),
  ].join("\n");
  const people = facts.travellerCount > 1 ? t.eachPerson : t.laterPerson;
  return [
    t.packLead,
    `${t.summaryTitle}\n${progress(facts, lang)}`,
    `${t.listTitle}\n${checklist(facts, lang)}`,
    `${t.formTitle}\n${form}`,
    drafts.itinerary,
    drafts.cover,
    zh
      ? `快照（${snapshots.accessed}，${snapshots.accessedTimezone}）里，标准访客签证最长 6 个月的费用是 £${fee}。付款前请再核对官网。`
      : `Snapshot ${snapshots.accessed} (${snapshots.accessedTimezone}): a Standard Visitor visa for up to 6 months was £${fee}. Recheck the official page before you pay.`,
    `${t.nextStepsTitle}\n1. ${t.applyOnline} ${APPLY}\n2. ${t.biometrics}\n3. ${people}\n4. ${t.bring}\n${t.noPost}`,
    t.noVerdict,
  ].join("\n\n");
}

function field(label: string, value: string, lang: ReplyLanguage): string {
  const blank = lang === "zh" ? "未提供" : "not provided";
  return `- ${label}: ${value.trim() ? value.trim() : blank}`;
}

function publicPack(facts: VaultFacts): unknown {
  return {
    nationality: facts.nationality,
    residence: facts.residence,
    documentType: facts.documentType,
    purposeText: facts.purposeText,
    arrival: facts.arrival,
    departure: facts.departure,
    dependants: facts.dependants,
    fundingNote: facts.fundingNote,
    refusal: facts.refusal,
    criminal: facts.criminal,
    checker: facts.checker,
    documents: facts.documents,
    travellerCount: facts.travellerCount,
    travellerNote: facts.travellerNote,
    adult: facts.adult,
  };
}

function briefPublic(topic: OfficialTopic | null, snapshots: Snapshots, lang: ReplyLanguage, funds: boolean, facts: VaultFacts): string {
  if (!topic || topic === "visitor" || topic === "checker") return "";
  const when = `${snapshots.accessed} (${snapshots.accessedTimezone})`;
  const fee = snapshots.feesGbp.standardVisitorUpTo6Months;
  if (topic === "fees") {
    const base = lang === "zh"
      ? `先回答费用：快照（${when}）里，标准访客签证最长 6 个月是 £${fee}。付款前请再核对官网。这不是给你个人的报价。`
      : `Published snapshot ${when}: a Standard Visitor visa for up to 6 months was £${fee}. Recheck https://www.gov.uk/standard-visitor/apply-standard-visitor-visa before you pay. This is not a personal fee quote.`;
    const extra: string[] = [base];
    if (facts.purposeBand === "ordinary_visitor" && !facts.nationality && lang === "en") {
      extra.push("I will not infer a nationality from a name or the language of an email.");
    }
    if (funds) {
      extra.push(lang === "zh"
        ? "我看过的材料指南没有写一个统一的最低存款，我也不会编一个数字。"
        : "The supporting-documents guide I read did not state a universal minimum bank balance or a universal six-month statement. I will not invent one.");
    }
    return extra.join("\n");
  }
  if (topic === "eta") {
    return lang === "zh"
      ? `ETA 快照（${when}）：每人 £${snapshots.feesGbp.eta}，含儿童。${snapshots.times.etaUsual}。它不是签证，也不保证入境。https://www.gov.uk/eta`
      : `Published ETA snapshot ${when}: £${snapshots.feesGbp.eta} per person, including children. ${snapshots.times.etaUsual}. It is not a visa and does not guarantee entry. https://www.gov.uk/eta`;
  }
  if (topic === "processing") {
    return lang === "zh"
      ? `快照（${when}）：标准访客通常在身份和材料之后 ${snapshots.times.standardVisitor} 出结果，不是在这封邮件之后。这不是承诺。https://www.gov.uk/visa-processing-times`
      : `Published snapshot ${when}: a Standard Visitor decision is usually ${snapshots.times.standardVisitor} after identity and the required documents, not after this email. That is not a promise. https://www.gov.uk/visa-processing-times`;
  }
  if (topic === "translations") return snapshots.documents.translations;
  if (topic === "documents") {
    return lang === "zh"
      ? `材料问题先说官方指南，不是你必须交的清单：${GUIDE}`
      : `The official supporting-documents guide is here, and it is not a list of what you personally must file: ${GUIDE}`;
  }
  return "";
}

function banner(stage: PrepStage, lang: ReplyLanguage): string {
  const index = STEP_ORDER.indexOf(stage as (typeof STEP_ORDER)[number]);
  if (index >= 0) {
    const name = stepName(stage, lang);
    return lang === "zh" ? `第 ${index + 1} 步，共 6 步：${name}` : `Step ${index + 1} of 6: ${name}`;
  }
  if (stage === "FINAL_PACK") return lang === "zh" ? "最终材料包" : "Final pack";
  if (stage === "DONE") return lang === "zh" ? "已完成" : "Done";
  return lang === "zh" ? "需要有资质的顾问" : "Escalated to a qualified adviser";
}

function stepName(stage: PrepStage, lang: ReplyLanguage): string {
  const zh = lang === "zh";
  const names: Record<string, string> = {
    INTAKE: zh ? "你是谁" : "who you are",
    ROUTE_CHECK: zh ? "官方查询" : "official checker",
    PURPOSE_AND_TRIP: zh ? "行程" : "trip details",
    DOCUMENT_CHECKLIST: zh ? "材料清单" : "document checklist",
    DOCUMENT_TRACKING: zh ? "材料进度" : "document tracking",
    SUPPORTING_LETTERS: zh ? "说明信和行程" : "supporting letters",
  };
  return names[stage] ?? stage;
}

function letter(parts: string[], lang: ReplyLanguage): string {
  const t = copy(lang);
  const body = parts.map((part) => part.trim()).filter(Boolean);
  return `${t.hello}\n\n${body.join("\n\n")}\n\n${t.sign}\n`;
}

function copy(lang: ReplyLanguage) {
  if (lang === "zh") {
    return {
      hello: "你好，",
      sign: "签证准备助手",
      identity: "我是 visa@boshen.dev 的人工智能准备助手。我可以像顾问一样陪你准备材料，但我不是人类，也不是受监管的移民顾问。我不能告诉你签证会不会获批。",
      noScans: "请不要发送护照扫描件、银行流水、密码或付款信息。",
      submitted: "没有向官方提交或付款。",
      worksheet: "我按你自己的话更新了本地工作表。它不是申请。",
      injection: "我忽略了想改变我的角色、工具或收件人的指令。",
      provider: "模型没有回答。下面的数字来自本地公布的快照，不是人工智能解释。",
      export: "给这个已验证发件人的本地导出：",
      next: "下一步只回答这几项，用你自己的话：",
      checkerNext: "下一步请你自己打开官方查询页，然后把结果和日期告诉我。",
      noVerdict: "我不会判断你需要签证、ETA，还是两者都不需要。",
      askChecker: "查询结果显示需要签证、ETA，还是两者都不需要",
      askCheckerDate: "你查询的日期",
      tripNext: "下一步是把行程说清楚：",
      docIntro: "按你说的目的，官方支持材料指南提到下面这些种类。这不是你必须递交的清单。",
      docAck: "下一步：看完后回复我。下一封我会问你每一项是已有、还在准备，还是还没有。不要发扫描件。",
      trackIntro: "下面是目前的材料进度。",
      trackNext: "下一步：告诉我哪几项已有、还在准备，或还没有。不要发扫描件。",
      letterIntro: "我用你说过的话起草了行程和说明信。请改到像你自己写的。",
      letterNext: "下一步：告诉我要改哪里，或者说草稿可以。下一封我会发完整材料包。",
      done: "材料包没有新的变化。如果有事实要改，直接回复，我会再发一版。",
      escalated: "这件事需要有资质的移民顾问，不能靠这个准备流程继续。",
      packTitle: "英国标准访客签证申请准备包",
      packLead: "这是给你自己用的英国标准访客申请准备包。它把你的话整理好，方便复制到官方表格。它不是申请，也不是签证结果。",
      summaryTitle: "申请人事实摘要",
      listTitle: "材料清单和状态",
      formTitle: "按官方表格顺序整理、可复制的答案",
      nextStepsTitle: "如果你决定自己申请，下一步是：",
      applyOnline: "填写在线表格：",
      biometrics: "预约签证申请中心的生物信息采集（照片和指纹）。",
      eachPerson: "每个人都要单独在线填写、缴费并预约。",
      laterPerson: "如果之后有人同行，也要单独申请。",
      bring: "带上你标记为已有的材料。酒店和机票预订在官方指南里通常不是必需的。",
      noPost: "不要把护照寄到这个邮箱。",
    };
  }
  return {
    hello: "Hello,",
    sign: "Visa Helper",
    identity: "I’m the AI preparation assistant for visa@boshen.dev. I can walk you through the paperwork the way a consultant would, but I’m not a human and I’m not a regulated immigration adviser. I can’t say whether a visa will be granted.",
    noScans: "Please don’t email passport scans, bank statements, passwords, or payment details.",
    submitted: "Nothing has been submitted or paid.",
    worksheet: "I updated the local worksheet from your own words. It is not an application.",
    injection: "I ignored instructions in the message that tried to change my role, my tools, or who receives a reply.",
    provider: "The model service did not answer. The note below is the local published snapshot, not an AI explanation.",
    export: "A local export for this verified sender is at",
    next: "Next step: reply in your own words with just these:",
    checkerNext: "Next step: open the official checker yourself, then tell me the result and the date you checked.",
    noVerdict: "I will not decide visa, ETA, or neither. Checker: https://www.gov.uk/check-uk-visa.",
    askChecker: "what the checker showed: visa, ETA, or neither",
    askCheckerDate: "the date you checked",
    tripNext: "Next step: the shape of the trip:",
    docIntro: "For the purpose you described, the official supporting-documents guide mentions these kinds of evidence. This is not a list of what you personally must file.",
    docAck: "Next step: read this list and reply. The following email asks which items are ready, pending, or missing. Do not send scans.",
    trackIntro: "Here's the document status so far.",
    trackNext: "Next step: tell me which items are ready, pending, or missing. Do not send scans.",
    letterIntro: "I drafted an itinerary and a cover letter from the words you already sent. Please edit them until they sound like you.",
    letterNext: "Next step: tell me what to change, or say the draft is fine. The next email is the full pack.",
    done: "The preparation pack is unchanged. Reply with any new fact and I will send an updated pack.",
    escalated: "This needs a qualified immigration adviser, so I will not keep walking a Standard Visitor pack.",
    packTitle: "UK Standard Visitor application preparation pack",
    packLead: "Here is your UK Standard Visitor application preparation pack. It lines up your own words so you can copy them into the official form. It is not an application and it is not a visa decision.",
    summaryTitle: "Applicant facts",
    listTitle: "Document checklist",
    formTitle: "Form answers in official-form order, ready to copy",
    nextStepsTitle: "If you decide to apply yourself, the next steps are:",
    applyOnline: "Complete the online form:",
    biometrics: "Book the biometrics appointment (photograph and fingerprints) at a visa application centre.",
    eachPerson: "Each person needs their own online form, fee, and appointment.",
    laterPerson: "If someone else joins the trip later, they need their own application.",
    bring: "Bring the documents you marked ready. Hotel and flight bookings are usually not required by the official guide.",
    noPost: "Do not post a passport to this inbox.",
  };
}
