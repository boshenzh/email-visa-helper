import type { OfficialTopic } from "./knowledge.ts";
import type { Category, InboundEvent, PurposeBand, ReplyLanguage, VaultFacts } from "./types.ts";
import { sensitiveMarkers } from "./security.ts";

export interface Intake {
  facts: VaultFacts;
  category: Category;
  reviewFlags: string[];
  missing: string[];
  inScope: boolean;
  injectionIgnored: boolean;
  deleteRequested: boolean;
  exportRequested: boolean;
  asksPersonalVerdict: boolean;
  /** Enum only. The raw email is not forwarded with this value. */
  publicTopic: OfficialTopic | null;
  mentionsFunds: boolean;
  /** A hello with no question. The reply stays short and does not list intake gaps. */
  bareGreeting: boolean;
  language: ReplyLanguage;
}

const EMPTY: VaultFacts = {
  nationality: "",
  residence: "",
  currentLocation: "",
  documentType: "",
  adult: "unknown",
  purposeText: "",
  purposeBand: "none",
  arrival: "",
  departure: "",
  dependants: "",
  fundingNote: "",
  checker: null,
  refusal: "unknown",
  criminal: "unknown",
  passportNumberPresent: false,
  bankDetailPresent: false,
  documents: {},
  docsAnswered: false,
  draftAccepted: false,
  travellerCount: 0,
  travellerNote: "",
};

function field(text: string, labels: string[]): string {
  for (const label of labels) {
    const match = new RegExp(`(?:^|\\n)\\s*${label}(?:\\s*\\([^)\\n]{0,40}\\))?\\s*[:=-]\\s*(.+)`, "i").exec(text);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function isoDate(value: string): string {
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(value);
  if (iso) return iso[1];
  const named = /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i.exec(value);
  if (!named) return "";
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const month = months.indexOf(named[2].toLowerCase()) + 1;
  return `${named[3]}-${String(month).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
}

function fromLine(line: string, prose: "yes" | "no" | "unsure" | "unknown"): "yes" | "no" | "unsure" | "unknown" {
  if (!line) return prose;
  if (/^(no|none|never|n\/a)\b/i.test(line)) return "no";
  if (/unsure|not sure/i.test(line)) return "unsure";
  if (/^yes\b/i.test(line)) return "yes";
  return prose;
}

function tri(text: string, yes: RegExp, no: RegExp, unsure: RegExp): "yes" | "no" | "unsure" | "unknown" {
  if (unsure.test(text)) return "unsure";
  if (no.test(text)) return "no";
  if (yes.test(text)) return "yes";
  return "unknown";
}

function purposeBand(text: string): PurposeBand {
  const lower = text.toLowerCase();
  if (/asylum|human rights claim|humanitarian protection/.test(lower)) return "asylum";
  if (/switch (?:my )?visa|already in the uk and|extension of stay|leave to remain/.test(lower)) return "in_uk";
  if (/marriage visitor|give notice|civil partnership|to marry|to get married/.test(lower)) return "marriage";
  if (/medical treatment|private hospital|see a doctor in the uk/.test(lower)) return "medical";
  if (/permitted paid engagement|paid to (?:speak|perform)|fee for (?:the )?(?:lecture|performance)/.test(lower)) return "paid_engagement";
  if (/transit|airside|landside|changing flights|layover/.test(lower)) return "transit";
  if (/student visa|university|degree|cas\b|formal study|course of study/.test(lower)) return "study";
  if (/short (?:recreational )?course|study for \d+ days/.test(lower)) return "study";
  if (/paid work|paid employment|work for a (?:local |uk )?client|do(?:ing)? paid work|skilled worker|work visa|sponsor(?:ed)? job|take (?:a |the )?job|employ(?:ed|ment) in the uk|work for a uk|unpaid work|i will work/.test(lower)) return "work";
  if (/family visa|settle|indefinite leave|spouse visa|partner visa|live with my|join my spouse/.test(lower)) return "family_residence";
  if (/tourist|tourism|holiday|vacation|sightsee|visit (?:my )?(?:family|friend|parents|mother|father)|business meeting|conference|permitted business|旅游|观光|度假|探亲|看望家人|拜访朋友|商务会议|商务访问/.test(lower)) {
    return "ordinary_visitor";
  }
  if (/standard visitor|visitor visa|visit(?:ing)?(?: the)? uk|标准访客/.test(lower)) return "ordinary_visitor";
  if (/留学|学生签|学生签证/.test(lower)) return "study";
  if (/打工|工资|就业|工作签/.test(lower)) return "work";
  if (/结婚|登记结婚/.test(lower)) return "marriage";
  if (/定居|永居|配偶签/.test(lower)) return "family_residence";
  if (/visa|eta\b|immigration|签证/.test(lower)) return "unknown";
  return "none";
}

function mergeTri(previous: VaultFacts["refusal"], incoming: VaultFacts["refusal"]): VaultFacts["refusal"] {
  if (incoming === "unknown") return previous;
  if (previous !== "unknown" && previous !== incoming) return "unsure";
  return incoming;
}

export function extractFacts(text: string, previous: VaultFacts | null): { facts: VaultFacts; changedNationality: boolean } {
  const markers = sensitiveMarkers(text);
  const source = markers.stripped;
  const base: VaultFacts = previous ? { ...previous, documents: { ...previous.documents } } : emptyFacts();
  const nationality = field(source, ["nationality", "citizenship"]);
  const residence = field(source, ["residence", "ordinary residence", "legal residence"]);
  const currentLocation = field(source, ["current location", "i am in", "applying from"]);
  const documentType = field(source, ["document type", "passport type"]);
  const purposeText = field(source, ["purpose", "reason for visit"]);
  const range = /from\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/i.exec(source);
  const namedRange = /(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+(?:to|until)\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(source);
  const arrival = isoDate(field(source, ["arrival", "arrive"])) || range?.[1] || (namedRange ? isoDate(namedRange[1]) : "");
  const departure = isoDate(field(source, ["departure", "depart"])) || range?.[2] || (namedRange ? isoDate(namedRange[2]) : "");
  const dependants = field(source, ["dependants", "dependents", "accompanying"]);
  const fundingNote = field(source, ["funding", "who pays"]);
  const checkerResult = field(source, ["checker result", "official checker", "check-uk-visa result"]).toLowerCase();
  const checkerDate = isoDate(field(source, ["checker date"]) || "");
  let changedNationality = false;
  if (nationality) {
    changedNationality = Boolean(base.nationality) && base.nationality.toLowerCase() !== nationality.toLowerCase();
    base.nationality = nationality;
  }
  if (residence) base.residence = residence;
  if (currentLocation) base.currentLocation = currentLocation;
  if (documentType) base.documentType = documentType;
  if (/diplomatic passport|service passport/.test(source.toLowerCase()) && !documentType) {
    base.documentType = /diplomatic/.test(source.toLowerCase()) ? "diplomatic" : "service";
  }
  if (/ordinary passport/.test(source.toLowerCase()) && !base.documentType) base.documentType = "ordinary passport";
  if (purposeText) base.purposeText = purposeText;
  const band = purposeBand(`${purposeText}\n${source}`);
  if (band !== "none" && band !== "unknown") base.purposeBand = band;
  else if ((base.purposeBand === "none" || base.purposeBand === "unknown") && band === "unknown") base.purposeBand = "unknown";
  if (arrival) base.arrival = arrival;
  if (departure && departure !== base.arrival) base.departure = departure;
  if (dependants) base.dependants = dependants;
  else if (/no dependants|no dependents|travelling alone|traveling alone/.test(source.toLowerCase())) base.dependants = "none";
  else if (/with my (?:wife|husband|partner|son|daughter|child|children)/.test(source.toLowerCase())) {
    base.dependants = base.dependants || "accompanying family mentioned";
  }
  if (fundingNote) base.fundingNote = fundingNote;
  const age = statedAge(source);
  if (age !== null && age < 18) base.adult = "no";
  else if (age !== null && age >= 18) base.adult = "yes";
  else if (/\badult\b|\bi am over 18\b|\bover 18\b/i.test(source) && !/\bunder 18\b|\bminor\b|\bchild aged\b/i.test(source)) base.adult = "yes";
  if (/\b(?:under 18|minor|aged\s*(?:1[0-7]|[0-9])\b)/i.test(source)) base.adult = "no";
  if (checkerResult) {
    const result = /neither|no visa|do not need/.test(checkerResult) ? "neither" : /\beta\b/.test(checkerResult) ? "eta" : /\bvisa\b/.test(checkerResult) ? "visa" : "unknown";
    base.checker = { result, date: checkerDate };
  }
  base.refusal = mergeTri(
    base.refusal,
    fromLine(
      field(source, ["previous refusal", "refusal"]),
      tri(source, /visa was refused|refused a visa|overstay|removed|deported/i, /no previous refusal|never been refused|no refusal/i, /not sure if .*refus|unsure about .*refus/i),
    ),
  );
  base.criminal = mergeTri(
    base.criminal,
    fromLine(
      field(source, ["criminal record", "criminal or safeguarding", "criminal"]),
      tri(source, /been convicted|criminal conviction|caution for/i, /no criminal/i, /not sure about (?:a )?criminal/i),
    ),
  );
  base.passportNumberPresent = base.passportNumberPresent || markers.passportNumberPresent;
  base.bankDetailPresent = base.bankDetailPresent || markers.bankDetailPresent;
  applyProse(source, base);
  return { facts: base, changedNationality };
}

function applyProse(source: string, base: VaultFacts): void {
  const lower = source.toLowerCase();
  if (!base.nationality) {
    const english = /(?:i am from|i'm from|my nationality is)\s+([A-Za-z][A-Za-z' -]{1,40})/i.exec(source);
    const chinese = /国籍(?:是|为)?\s*([^\s，。,]{1,12})/.exec(source) ?? /我是([^\s，。]{1,8})人/.exec(source);
    const value = english?.[1]?.replace(/\s+(?:and|who|living)\b[\s\S]*$/i, "").trim() || chinese?.[1];
    if (value) base.nationality = value;
  }
  if (!base.residence) {
    const english = /i live in\s+([A-Za-z][A-Za-z' -]{1,40})/i.exec(source);
    const chinese = /我住在([^\s，。]{1,20})/.exec(source);
    const value = english?.[1]?.replace(/\s+(?:and|with|on)\b[\s\S]*$/i, "").trim() || chinese?.[1];
    if (value) base.residence = value;
  }
  if (!base.purposeText) {
    if (/for tourism|as a tourist|去旅游|来旅游|旅游/.test(lower)) base.purposeText = "tourism";
    else if (/visit(?:ing)? (?:my )?(?:family|parents|mother|father)|探亲|看望家人/.test(lower)) base.purposeText = "visiting family";
    else if (/business meeting|conference|商务会议|商务访问|开会/.test(lower)) base.purposeText = "business visit";
  }
  if (!base.arrival || !base.departure) {
    const span = /从\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*到\s*(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(source);
    if (span) {
      base.arrival = isoParts(span[1], span[2], span[3]);
      base.departure = isoParts(span[4], span[5], span[6]);
    }
    const arriveZh = /(\d{4})年(\d{1,2})月(\d{1,2})日(?:到达|入境)/.exec(source);
    const leaveZh = /(\d{4})年(\d{1,2})月(\d{1,2})日(?:离开|回国)/.exec(source);
    if (arriveZh) base.arrival = isoParts(arriveZh[1], arriveZh[2], arriveZh[3]);
    if (leaveZh) base.departure = isoParts(leaveZh[1], leaveZh[2], leaveZh[3]);
    const arriveEn = /arriv(?:e|es|ing) on\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(source);
    const leaveEn = /leav(?:e|es|ing) on\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(source);
    if (arriveEn) base.arrival = isoDate(arriveEn[1]);
    if (leaveEn) base.departure = isoDate(leaveEn[1]);
  }
  if (!base.documentType && /普通护照/.test(source)) base.documentType = "ordinary passport";
  if (!base.dependants && /just me|only me|只有我|就我一个人/.test(lower)) base.dependants = "none";
  if (/\badult\b|我是成年人|已成年/.test(lower) && !/未成年/.test(source)) base.adult = base.adult === "no" ? "no" : "yes";
  const travellers = travellerMention(source);
  if (travellers) {
    base.travellerCount = travellers.count;
    base.travellerNote = travellers.note;
    if (!base.dependants && travellers.count > 1) base.dependants = travellers.note;
  }
  if (!base.checker) {
    const english = /checker (?:said|shows|showed|result is)\s+(?:that\s+)?(?:i need\s+)?(a visa|an eta|visa|eta|neither)/i.exec(source);
    const chineseVisa = /(?:查询结果|官网)[^。\n]{0,16}需要签证/.test(source);
    const chineseNeither = /(?:查询结果|官网)[^。\n]{0,16}不需要签证/.test(source);
    const chineseEta = /(?:查询结果|官网)[^。\n]{0,16}(?:ETA|电子旅行)/.test(source);
    const result = english
      ? /neither/.test(english[1].toLowerCase())
        ? "neither"
        : /eta/i.test(english[1])
          ? "eta"
          : "visa"
      : chineseNeither
        ? "neither"
        : chineseEta
          ? "eta"
          : chineseVisa
            ? "visa"
            : null;
    if (result) {
      const named = /checked on\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(source);
      const zh = /(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(source);
      base.checker = { result, date: named ? isoDate(named[1]) : zh ? isoParts(zh[1], zh[2], zh[3]) : "" };
    }
  }
  if (base.refusal === "unknown") {
    if (/没有被拒签|从未被拒|never been refused|no refusal/.test(source)) base.refusal = "no";
    else if (/被拒签过|visa was refused/.test(source)) base.refusal = "yes";
  }
  if (base.criminal === "unknown") {
    if (/没有犯罪|no criminal/.test(source)) base.criminal = "no";
    else if (/有犯罪记录|been convicted/.test(source)) base.criminal = "yes";
  }
  applyDocuments(source, base);
  if (/draft (?:looks|is) fine|send the pack|草稿可以|发给我材料包|材料包/.test(lower)) base.draftAccepted = true;
}

function isoParts(year: string, month: string, day: string): string {
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function travellerMention(source: string): { count: number; note: string } | null {
  if (/my wife and i|my husband and i|我和我(?:太太|妻子|老公|先生)|我太太也|my wife is travelling with me/i.test(source)) {
    return { count: 2, note: "you and your spouse" };
  }
  if (/我们三个人|three of us|we are three/.test(source)) return { count: 3, note: "three travellers" };
  const count = /(?:there are|we are)\s+([2-9])\s+(?:of us|people|travellers)/i.exec(source);
  if (count) return { count: Number(count[1]), note: `${count[1]} travellers` };
  return null;
}

function applyDocuments(source: string, base: VaultFacts): void {
  const set = (id: string, status: VaultFacts["documents"][string]) => {
    base.documents[id] = status;
    base.docsAnswered = true;
  };
  if (/i have (?:my |the )?passport|护照已经|我有护照|护照准备好了/i.test(source)) set("passport", "ready");
  else if (/passport[^.\n]{0,40}(?:pending|later|not yet)|还没有护照/i.test(source)) set("passport", "pending");
  if (/funds evidence is still pending|资金证明还没有|资金还在准备/i.test(source)) set("funds", "pending");
  else if (/funds (?:evidence )?(?:is|are) ready|资金证明准备好了/i.test(source)) set("funds", "ready");
  if (/describe my job|home circumstances are ready|国内工作证明准备好了/i.test(source)) set("home", "ready");
  else if (/job letter later|工作证明还没有/i.test(source)) set("home", "pending");
}

function missingFields(facts: VaultFacts): string[] {
  const missing: string[] = [];
  if (!facts.nationality) missing.push("nationality");
  if (!facts.residence) missing.push("residence");
  if (!facts.documentType) missing.push("document_type");
  if (facts.adult === "unknown") missing.push("adult_or_minor");
  if (!facts.purposeText && facts.purposeBand === "none") missing.push("purpose");
  if (!facts.arrival || !facts.departure) missing.push("travel_dates");
  if (!facts.dependants) missing.push("dependants");
  if (!facts.checker) missing.push("official_checker_result");
  if (facts.refusal === "unknown") missing.push("previous_refusal");
  if (facts.criminal === "unknown") missing.push("criminal_or_safeguarding");
  return missing;
}

/** Hello, thanks, or an empty note, with no visa question in the words. */
export function messageLanguage(text: string, previous?: ReplyLanguage): ReplyLanguage {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (cjk >= 2) return "zh";
  if (text.trim().length < 12 && previous) return previous;
  return "en";
}

export function isBareGreeting(text: string): boolean {
  if (/[\u4e00-\u9fff]/.test(text)) {
    const compact = text.replace(/\s+/g, "").replace(/[！。？!?.,，]/g, "");
    return /^(?:你好|您好|嗨|在吗|谢谢|谢谢你)$/.test(compact);
  }
  const normalized = text
    .replace(/[\u2018\u2019]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text.trim() || !normalized) return !text.trim() || /^[?\s!.]+$/.test(text);
  return /^(?:hi|hello|hey|hiya|good morning|good afternoon|good evening|thanks|thank you)(?: there)?(?: how are you| i have a question| quick question)?$/.test(normalized);
}

export function classify(text: string, facts: VaultFacts, changedNationality: boolean, continuing: boolean): Intake {
  if (isBareGreeting(text)) {
    return {
      facts,
      category: "GENERAL_INFORMATION",
      reviewFlags: [],
      missing: missingFields(facts),
      inScope: true,
      injectionIgnored: false,
      deleteRequested: false,
      exportRequested: false,
      asksPersonalVerdict: false,
      publicTopic: null,
      mentionsFunds: false,
      bareGreeting: true,
      language: messageLanguage(text),
    };
  }
  const lower = text.toLowerCase();
  const injectionIgnored = /ignore (?:all |any )?(?:previous|prior) instructions|system prompt|you are now|developer message|tool call|send (?:the )?(?:file|vault|secrets) to/i.test(text);
  const deleteRequested = /delete my (?:case|data|information)|erase my data|forget me/i.test(text);
  const exportRequested = /export my (?:case|data)|copy of my (?:file|case)/i.test(text);
  const asksPersonalVerdict = /am i eligible|will i (?:get|be granted)|chance of approval|will my (?:bank|documents|evidence) be enough|what evidence will convince|do i qualify|should i apply/i.test(text);
  const unrelated = isUnrelatedRequest(text);
  const labeledFollowUp = /(?:^|\n)\s*(?:nationality|citizenship|residence|document type|passport type|purpose|arrival|departure|dependants|dependents|checker result|previous refusal|criminal record)\s*[:=-]/i.test(text);
  const inScopeKeywords = /visa|eta\b|visitor|immigration|ukvi|standard visitor|check-uk-visa|transit|passport|documents?\b|签证|旅游|材料|费用|探亲/.test(lower);
  const inScope = !unrelated && (inScopeKeywords || labeledFollowUp || continuing || facts.purposeBand !== "none" || deleteRequested || exportRequested);
  const reviewFlags: string[] = [];
  if (facts.adult === "no" || /my (?:son|daughter|child).{0,40}(?:under 18|minor|aged\s*(?:1[0-7]|[0-9])\b)/i.test(text)) reviewFlags.push("minor");
  if (facts.refusal === "yes" || facts.refusal === "unsure") reviewFlags.push("refusal_or_uncertainty");
  if (facts.criminal === "yes" || facts.criminal === "unsure") reviewFlags.push("criminal_or_safeguarding");
  if (["study", "work", "family_residence", "marriage", "medical", "paid_engagement", "in_uk", "asylum"].includes(facts.purposeBand)) {
    reviewFlags.push(`route_${facts.purposeBand}`);
  }
  if (facts.purposeBand === "transit") reviewFlags.push("transit_circumstances");
  if (/tourist.{0,80}work|visit.{0,40}(?:job|employ)|pretend.{0,20}tourist/i.test(text)) reviewFlags.push("work_disguised");
  if (/dual nation|also a citizen|second nationality|two passports/i.test(text)) reviewFlags.push("dual_nationality");
  if (/diplomatic|service passport/.test(lower)) reviewFlags.push("non_ordinary_passport");
  if (/right of abode|settled status|indefinite leave|already have (?:a )?visa|existing (?:uk )?permission/i.test(text)) reviewFlags.push("existing_permission");
  if (/british passport|irish passport|i am british|i am irish/i.test(text)) reviewFlags.push("possible_british_or_irish");
  if (changedNationality) reviewFlags.push("inconsistent_facts");
  if (facts.arrival && facts.departure && facts.departure < facts.arrival) reviewFlags.push("inconsistent_facts");
  if (facts.arrival && facts.departure) {
    const days = (Date.parse(facts.departure) - Date.parse(facts.arrival)) / 86_400_000;
    if (days > 183) reviewFlags.push("longer_than_ordinary_visit");
  }
  if (/keep (?:my )?passport|vignette|passport (?:will be|is) retained|collect (?:my )?passport later/i.test(text)) reviewFlags.push("vac_instruction_conflict");
  if (asksPersonalVerdict) reviewFlags.push("personal_verdict_requested");
  if (facts.passportNumberPresent) reviewFlags.push("passport_number_not_stored");
  if (facts.bankDetailPresent) reviewFlags.push("bank_detail_not_stored");
  const uniqueFlags = [...new Set(reviewFlags)];
  let category: Category;
  const organise = /organise my answers|organize my answers|worksheet|draft my answers|help me prepare|here are the rest of my answers|帮我准备|准备材料/i.test(text);
  const mentionsFunds = /bank|six-month statement|how much money/i.test(text);
  if (unrelated || !inScope) category = "OUT_OF_SCOPE";
  else if (uniqueFlags.length > 0) category = "REGULATED_REVIEW_REQUIRED";
  else if (facts.purposeBand === "ordinary_visitor" && (organise || (continuing && labeledFollowUp))) {
    category = "CLERICAL_APPLICANT_CONTROLLED";
  } else category = "GENERAL_INFORMATION";
  return {
    facts,
    category,
    reviewFlags: uniqueFlags,
    missing: category === "OUT_OF_SCOPE" ? [] : missingFields(facts),
    inScope,
    injectionIgnored,
    deleteRequested,
    exportRequested,
    asksPersonalVerdict,
    publicTopic: selectPublicTopic(text, category, uniqueFlags, injectionIgnored || deleteRequested || exportRequested),
    mentionsFunds,
    bareGreeting: false,
    language: messageLanguage(text),
  };
}

/** Local intent → a public topic id. Returns null when the message is personal, uncertain, or not a general question. */
export function selectPublicTopic(text: string, category: Category, flags: readonly string[], blocked: boolean): OfficialTopic | null {
  if (blocked || flags.length > 0 || category === "OUT_OF_SCOPE" || category === "REGULATED_REVIEW_REQUIRED") return null;
  const lower = text.toLowerCase();
  if (/费用|签证费|多少钱|收费/.test(text)) return "fees";
  if (/材料|文件|准备什么|需要哪些/.test(text)) return "documents";
  if (/多久|审理时间|处理时间/.test(text)) return "processing";
  if (/\b(fee|fees|how much|what does it cost)\b/.test(lower)) return "fees";
  if (/\beta\b/.test(lower)) return "eta";
  if (/translat/.test(lower)) return "translations";
  if (/\b(how long|processing time|decision time)\b/.test(lower)) return "processing";
  if (/\b(supporting document|documents|bank statement|evidence)\b/.test(lower)) return "documents";
  if (/\b(evisa|vignette|biometric)\b/.test(lower)) return "identity";
  if (/\b(check-uk-visa|visa or an eta|visa, an eta)\b/.test(lower)) return "checker";
  if (/\b(tourist|tourism|holiday|standard visitor|visitor visa|visit(?:ing)?(?: the)? uk|permitted activit)/.test(lower)) return "visitor";
  return null;
}

function statedAge(text: string): number | null {
  const meant = /\bmeant\b[\s\S]{0,80}?\b(?:i am|i'm|im)\s+(?:also\s+)?(\d{1,2})\b/i.exec(text);
  const rejected = /\bnot\s+(\d{1,2})\b/i.exec(text);
  if (meant) {
    const age = Number(meant[1]);
    if (Number.isInteger(age) && age <= 120 && (!rejected || rejected[1] !== meant[1])) return age;
  }
  const zh = /我(?:今年)?\s*(\d{1,2})\s*岁/.exec(text);
  if (zh) {
    const age = Number(zh[1]);
    if (Number.isInteger(age) && age <= 120) return age;
  }
  const match = text.match(/\b(?:i am|i'm|im|age[d]?)\s+(?:also\s+)?(\d{1,2})\b/i) ?? text.match(/\b(\d{1,2})\s*(?:years?\s*old|-year-old)\b/i);
  if (!match) return null;
  const age = Number(match[1]);
  if (!Number.isInteger(age) || age > 120) return null;
  return age;
}

function isUnrelatedRequest(text: string): boolean {
  const lower = text.toLowerCase();
  const offTopic = /marketing plan|coffee shop|write (?:me )?a poem|book (?:me )?a restaurant|stock (?:tip|price)|recipe for|do my homework/.test(lower);
  if (!offTopic) return false;
  return !/(?:^|\n)\s*(?:document type|nationality|arrival|checker result)\s*[:=-]|\b(?:visitor fee|standard visitor|visa fee|what documents|uk visitor)\b|\beta\b|\bpassport\b/.test(lower);
}

export function emptyFacts(): VaultFacts {
  return { ...EMPTY, documents: {} };
}

export function publicText(event: InboundEvent): string {
  return event.text.slice(0, 20_000);
}
