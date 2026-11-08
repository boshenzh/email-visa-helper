import type { OfficialTopic } from "./knowledge.ts";
import type { Category, InboundEvent, PurposeBand, VaultFacts } from "./types.ts";
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
};

function field(text: string, labels: string[]): string {
  for (const label of labels) {
    const match = new RegExp(`(?:^|\\n)\\s*${label}\\s*[:=-]\\s*(.+)`, "i").exec(text);
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
  if (/skilled worker|work visa|sponsor(?:ed)? job|take (?:a |the )?job|employ(?:ed|ment) in the uk|work for a uk|unpaid work|i will work/.test(lower)) return "work";
  if (/family visa|settle|indefinite leave|spouse visa|partner visa|live with my|join my spouse/.test(lower)) return "family_residence";
  if (/tourist|tourism|holiday|vacation|sightsee|visit (?:my )?(?:family|friend|parents|mother|father)|business meeting|conference|permitted business/.test(lower)) {
    return "ordinary_visitor";
  }
  if (/standard visitor|visitor visa|visit the uk|visiting the uk/.test(lower)) return "ordinary_visitor";
  if (/visa|eta\b|immigration/.test(lower)) return "unknown";
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
  const base: VaultFacts = previous ? { ...previous } : { ...EMPTY };
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
  if (band !== "none") base.purposeBand = band;
  if (arrival) base.arrival = arrival;
  if (departure && departure !== base.arrival) base.departure = departure;
  if (dependants) base.dependants = dependants;
  else if (/no dependants|no dependents|travelling alone|traveling alone/.test(source.toLowerCase())) base.dependants = "none";
  else if (/with my (?:wife|husband|partner|son|daughter|child|children)/.test(source.toLowerCase())) {
    base.dependants = base.dependants || "accompanying family mentioned";
  }
  if (fundingNote) base.fundingNote = fundingNote;
  if (/\badult\b|\bi am over 18\b|\bover 18\b/i.test(source) && !/\bunder 18\b|\bminor\b|\bchild aged\b/i.test(source)) base.adult = "yes";
  if (/\b(?:under 18|minor|aged\s*(?:1[0-7]|[0-9]))\b/i.test(source)) base.adult = "no";
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
  return { facts: base, changedNationality };
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

export function classify(text: string, facts: VaultFacts, changedNationality: boolean, continuing: boolean): Intake {
  const lower = text.toLowerCase();
  const injectionIgnored = /ignore (?:all |any )?(?:previous|prior) instructions|system prompt|you are now|developer message|tool call|send (?:the )?(?:file|vault|secrets) to/i.test(text);
  const deleteRequested = /delete my (?:case|data|information)|erase my data|forget me/i.test(text);
  const exportRequested = /export my (?:case|data)|copy of my (?:file|case)/i.test(text);
  const asksPersonalVerdict = /am i eligible|will i (?:get|be granted)|chance of approval|will my (?:bank|documents|evidence) be enough|what evidence will convince|do i qualify|should i apply/i.test(text);
  const inScopeKeywords = /visa|eta\b|visitor|immigration|ukvi|standard visitor|check-uk-visa|transit|passport/.test(lower);
  const inScope = continuing || inScopeKeywords || facts.purposeBand !== "none" || deleteRequested || exportRequested;
  const reviewFlags: string[] = [];
  if (facts.adult === "no" || /my (?:son|daughter|child).{0,40}(?:under 18|minor|aged\s*(?:1[0-7]|[0-9]))/i.test(text)) reviewFlags.push("minor");
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
  if (!inScope) category = "OUT_OF_SCOPE";
  else if (uniqueFlags.length > 0) category = "REGULATED_REVIEW_REQUIRED";
  else if (/organise my answers|organize my answers|worksheet|draft my answers|help me prepare/i.test(text) && facts.purposeBand === "ordinary_visitor") {
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
  };
}

/** Local intent → a public topic id. Returns null when the message is personal, uncertain, or not a general question. */
export function selectPublicTopic(text: string, category: Category, flags: readonly string[], blocked: boolean): OfficialTopic | null {
  if (blocked || flags.length > 0 || category === "OUT_OF_SCOPE" || category === "REGULATED_REVIEW_REQUIRED") return null;
  const lower = text.toLowerCase();
  if (/\b(fee|fees|how much|what does it cost)\b/.test(lower)) return "fees";
  if (/\beta\b/.test(lower)) return "eta";
  if (/translat/.test(lower)) return "translations";
  if (/\b(how long|processing time|decision time)\b/.test(lower)) return "processing";
  if (/\b(supporting document|documents|bank statement|evidence)\b/.test(lower)) return "documents";
  if (/\b(evisa|vignette|biometric)\b/.test(lower)) return "identity";
  if (/\b(check-uk-visa|visa or an eta|visa, an eta)\b/.test(lower)) return "checker";
  if (/\b(tourist|tourism|holiday|standard visitor|visitor visa|visit the uk|permitted activit)/.test(lower)) return "visitor";
  return null;
}

export function emptyFacts(): VaultFacts {
  return { ...EMPTY };
}

export function publicText(event: InboundEvent): string {
  return `${event.subject}\n${event.text}`.slice(0, 20_000);
}
