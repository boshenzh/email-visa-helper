import assert from "node:assert/strict";
import test from "node:test";
import { send, tempRuntime } from "./helpers.ts";

const PARTIAL = [
  "Please organise my answers for a UK tourist visit.",
  "Nationality: Fictionland",
  "Residence: Example City",
  "I am an adult.",
  "Purpose: tourism",
].join("\n");

const COMPLETE = [
  "Here are the rest of my answers.",
  "Document type: ordinary passport",
  "Arrival: 2027-06-01",
  "Departure: 2027-06-14",
  "Dependants: none",
  "Previous refusal: no",
  "Criminal record: no",
  "Checker result: visa",
  "Checker date: 2026-11-01",
].join("\n");

test("same-case follow-up keeps earlier facts and writes the later labeled answers", async () => {
  const runtime = tempRuntime();
  const first = await send(runtime, {
    messageId: "partial",
    headerFrom: "Fiction Traveller <fiction@example.com>",
    envelopeFrom: "fiction@example.com",
    text: PARTIAL,
  });
  assert.equal(first.category, "CLERICAL_APPLICANT_CONTROLLED");
  assert.ok(first.caseId);
  const opened = runtime.store.readArtifact(first.caseId, "worksheet.md");
  assert.match(opened, /Fictionland/);
  assert.match(opened, /Example City/);
  assert.match(opened, /Arrival date: \[not provided\]/);

  const second = await send(runtime, {
    messageId: "complete",
    headerFrom: "Fiction Traveller <fiction@example.com>",
    envelopeFrom: "fiction@example.com",
    inReplyTo: "<partial@example.com>",
    text: COMPLETE,
  });
  assert.equal(second.caseId, first.caseId);
  assert.equal(second.category, "CLERICAL_APPLICANT_CONTROLLED");
  assert.equal(second.modelRequests, 0);
  const worksheet = runtime.store.readArtifact(second.caseId, "worksheet.md");
  assert.match(worksheet, /Fictionland/);
  assert.match(worksheet, /Example City/);
  assert.match(worksheet, /tourism/);
  assert.match(worksheet, /Adult: yes/);
  assert.match(worksheet, /ordinary passport/);
  assert.match(worksheet, /2027-06-01/);
  assert.match(worksheet, /2027-06-14/);
  assert.match(worksheet, /Dependants: none/);
  assert.match(worksheet, /Previous refusal, overstay, or removal: no/);
  assert.match(worksheet, /Criminal or safeguarding issue: no/);
  assert.match(worksheet, /visa on 2026-11-01/);
  assert.doesNotMatch(worksheet, /Arrival date: \[not provided\]/);
  assert.match(worksheet, /Required intake labels are filled/);
  assert.match(worksheet, /Optional labels still not provided/);
  assert.match(worksheet, /- current location/);
  assert.match(worksheet, /- who pays/);
  assert.doesNotMatch(worksheet, /None of the intake labels are blank/);
  assert.match(second.reply, /worksheet/);
  assert.ok(second.reply.length < 2200, `worksheet reply too long: ${second.reply.length}`);

  const follow = await send(runtime, {
    messageId: "docs",
    headerFrom: "Fiction Traveller <fiction@example.com>",
    envelopeFrom: "fiction@example.com",
    inReplyTo: "<complete@example.com>",
    text: "Thanks. What documents do I still need?",
  });
  assert.equal(follow.caseId, first.caseId);
  assert.notEqual(follow.category, "OUT_OF_SCOPE");
  assert.match(follow.reply, /supporting-documents|passport or travel document/i);
  assert.doesNotMatch(follow.reply, /£506/);
  assert.ok(follow.reply.length < 2200, `documents reply too long: ${follow.reply.length}`);
  const kept = runtime.store.readArtifact(follow.caseId, "worksheet.md");
  assert.match(kept, /Fictionland/);
  assert.match(kept, /2027-06-01/);
});

test("natural ages under 18 escalate, and adult ages do not", async () => {
  const runtime = tempRuntime();
  const minor = await send(runtime, {
    messageId: "age-16",
    headerFrom: "Age Sixteen <sixteen@example.com>",
    envelopeFrom: "sixteen@example.com",
    text: "This is fictional: I am 16 and want to visit UK alone. Can you fill the visa form for me?",
  });
  assert.equal(minor.category, "REGULATED_REVIEW_REQUIRED");
  assert.ok(minor.reviewFlags.includes("minor"));
  assert.match(minor.reply, /qualified immigration adviser/);
  assert.match(minor.reply, /will not fill in the form/i);
  assert.doesNotMatch(minor.reply, /you qualify|you are eligible|you need a visa|you need an ETA/i);

  const explicit = await send(runtime, {
    messageId: "age-explicit",
    headerFrom: "Age Explicit <explicit@example.com>",
    envelopeFrom: "explicit@example.com",
    text: "I am a minor, age 16, and need help with a UK visitor visa.",
  });
  assert.ok(explicit.reviewFlags.includes("minor"));

  const hyphen = await send(runtime, {
    messageId: "age-hyphen",
    headerFrom: "Age Hyphen <hyphen@example.com>",
    envelopeFrom: "hyphen@example.com",
    text: "My daughter is a 16-year-old and we want a UK visitor visa.",
  });
  assert.ok(hyphen.reviewFlags.includes("minor"));

  for (const [id, text] of [
    ["age-18", "I am 18 and want to visit the UK as a tourist. What is the fee?"],
    ["age-26", "I am 26. What is the Standard Visitor fee?"],
    ["age-adult", "I am an adult. What is the Standard Visitor fee for a holiday?"],
  ] as const) {
    const result = await send(runtime, {
      messageId: id,
      headerFrom: `${id} <${id}@example.com>`,
      envelopeFrom: `${id}@example.com`,
      text,
    });
    assert.equal(result.reviewFlags.includes("minor"), false, id);
    assert.notEqual(result.category, "REGULATED_REVIEW_REQUIRED", id);
  }
});

test("a later age under 18 overrides an earlier adult answer on the same case", async () => {
  const runtime = tempRuntime();
  const from = { headerFrom: "Override <override@example.com>", envelopeFrom: "override@example.com" };
  const first = await send(runtime, {
    messageId: "was-adult",
    ...from,
    text: PARTIAL,
  });
  assert.match(runtime.store.readArtifact(first.caseId ?? "", "worksheet.md"), /Adult: yes/);
  const second = await send(runtime, {
    messageId: "now-16",
    ...from,
    inReplyTo: "<was-adult@example.com>",
    text: "I am 16. Please update the worksheet.",
  });
  assert.equal(second.caseId, first.caseId);
  assert.ok(second.reviewFlags.includes("minor"));
  assert.match(runtime.store.readArtifact(second.caseId ?? "", "worksheet.md"), /Adult: no/);
  assert.match(runtime.store.readArtifact(second.caseId ?? "", "worksheet.md"), /Fictionland/);
});

test("paid work versus visitor or ETA is a review, not an eligibility verdict", async () => {
  const runtime = tempRuntime();
  const result = await send(runtime, {
    messageId: "paid-work",
    headerFrom: "Paid Work <paid@example.com>",
    envelopeFrom: "paid@example.com",
    text: "I want to visit UK and do paid work for a local client. Can I use an ETA or visitor visa?",
  });
  assert.equal(result.category, "REGULATED_REVIEW_REQUIRED");
  assert.ok(result.reviewFlags.some((flag) => flag === "route_work" || flag === "work_disguised"));
  assert.match(result.reply, /qualified immigration adviser/);
  assert.match(result.reply, /will not choose an ETA or a visitor visa/);
  assert.match(result.reply, /skilled-worker-visa/);
  assert.doesNotMatch(result.reply, /you qualify|you are eligible|you need a visa|you need an ETA|you can work/i);
  assert.equal(result.modelRequests, 0);
});

test("an unrelated latest body is refused under a visa subject and inside a visa thread", async () => {
  const runtime = tempRuntime();
  const from = { headerFrom: "Thread <thread@example.com>", envelopeFrom: "thread@example.com" };
  const opened = await send(runtime, { messageId: "thread-open", ...from, text: PARTIAL });
  const coffee = await send(runtime, {
    messageId: "thread-coffee",
    ...from,
    subject: "Synthetic UK visitor workflow",
    inReplyTo: "<thread-open@example.com>",
    text: "Please write a marketing plan for my coffee shop.",
  });
  assert.equal(coffee.category, "OUT_OF_SCOPE");
  assert.equal(coffee.caseId, opened.caseId);
  assert.match(coffee.reply, /unable to help/);
  assert.doesNotMatch(coffee.reply, /£135/);
  assert.equal(coffee.modelRequests, 0);
  const worksheet = runtime.store.readArtifact(coffee.caseId ?? "", "worksheet.md");
  assert.match(worksheet, /Fictionland/);
  assert.match(worksheet, /Example City/);
  const record = runtime.store.readCase(coffee.caseId ?? "");
  assert.equal(record?.category, "CLERICAL_APPLICANT_CONTROLLED");

  const neutral = await send(runtime, {
    messageId: "neutral-coffee",
    headerFrom: "Neutral <neutral@example.com>",
    envelopeFrom: "neutral@example.com",
    subject: "Coffee marketing help",
    text: "Please write a marketing plan for my coffee shop.",
  });
  assert.equal(neutral.category, "OUT_OF_SCOPE");

  const stillVisa = await send(runtime, {
    messageId: "subject-fee",
    headerFrom: "Fee Subject <subjectfee@example.com>",
    envelopeFrom: "subjectfee@example.com",
    subject: "Synthetic UK visitor workflow",
    text: "What is the visitor fee?",
  });
  assert.equal(stillVisa.category, "GENERAL_INFORMATION");
  assert.match(stillVisa.reply, /£135/);
  assert.match(stillVisa.reply, /2026-11-08/);
  assert.ok(stillVisa.reply.length < 1200, `fee reply too long: ${stillVisa.reply.length}`);
  assert.doesNotMatch(stillVisa.reply, /£506/);
});

test("a vague preparation request asks for the missing facts instead of the omnibus", async () => {
  const runtime = tempRuntime();
  const result = await send(runtime, {
    messageId: "prepare",
    headerFrom: "Prepare <prepare@example.com>",
    envelopeFrom: "prepare@example.com",
    text: "I want to visit UK, help me prepare.",
  });
  assert.equal(result.category, "CLERICAL_APPLICANT_CONTROLLED");
  assert.match(result.reply, /nationality/i);
  assert.match(result.reply, /arrival and departure dates/i);
  assert.match(result.reply, /AI preparation assistant/);
  assert.doesNotMatch(result.reply, /£506/);
  assert.ok(result.reply.length < 2200, `prepare reply too long: ${result.reply.length}`);
});

test("a mocked provider failure still returns the local fee snapshot", async () => {
  const runtime = tempRuntime({ deepseekApiKey: "test-key-not-real", mode: "live", profile: "synthetic_test", testSenderAllowlist: ["failure@example.com"] });
  runtime.modelTransport = (async () => {
    throw new Error("mocked transport down");
  }) as typeof fetch;
  const result = await send(runtime, {
    messageId: "provider-down",
    headerFrom: "Failure <failure@example.com>",
    envelopeFrom: "failure@example.com",
    authenticationResults: "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=example.com",
    text: "What is the UK Standard Visitor fee?",
  });
  assert.match(result.reply, /did not answer/);
  assert.match(result.reply, /£135/);
  assert.match(result.reply, /local published snapshot/);
});
