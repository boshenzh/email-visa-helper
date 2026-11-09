import assert from "node:assert/strict";
import test from "node:test";
import { dispatchOutbox, resendRestTransport } from "../src/mail.ts";
import { send, tempRuntime } from "./helpers.ts";

const from = { headerFrom: "Fiction Traveller <fiction@example.com>", envelopeFrom: "fiction@example.com" };

test("english preparation advances one stage at a time and attaches the pack", async () => {
  const runtime = tempRuntime({ senderHourlyLimit: 30, globalHourlyLimit: 100 });
  const hi = await send(runtime, { messageId: "s1", ...from, subject: "hi", text: "hi" });
  assert.equal(runtime.store.readCase(hi.caseId ?? "")?.stage, "INTAKE");
  assert.match(hi.reply, /Step 1 of 6: who you are/);
  assert.match(hi.reply, /not a human/i);
  assert.doesNotMatch(hi.reply, /reply with your question/i);
  assert.equal(hi.modelRequests, 0);

  const who = await send(runtime, {
    messageId: "s2",
    ...from,
    inReplyTo: "<s1@example.com>",
    text: "I'm from Fictionland and I live in Example City. I am an adult and I will travel on an ordinary passport. I have never been refused a visa and I have no criminal record.",
  });
  assert.equal(runtime.store.readCase(who.caseId ?? "")?.stage, "ROUTE_CHECK");
  assert.match(who.reply, /Step 2 of 6: official checker/);
  assert.match(who.reply, /Fictionland/);
  assert.match(who.reply, /check-uk-visa/);
  assert.match(who.reply, /will not decide/i);

  const checker = await send(runtime, {
    messageId: "s3",
    ...from,
    inReplyTo: "<s2@example.com>",
    text: "The official checker said I need a visa. I checked on 1 November 2026.",
  });
  assert.equal(runtime.store.readCase(checker.caseId ?? "")?.stage, "PURPOSE_AND_TRIP");
  assert.match(checker.reply, /Step 3 of 6: trip details/);
  assert.match(checker.reply, /arrival and departure dates/i);

  const trip = await send(runtime, {
    messageId: "s4",
    ...from,
    inReplyTo: "<s3@example.com>",
    text: "I arrive on 1 June 2027 and leave on 14 June 2027 for tourism. It is just me.",
  });
  assert.equal(runtime.store.readCase(trip.caseId ?? "")?.stage, "DOCUMENT_CHECKLIST");
  assert.match(trip.reply, /Step 4 of 6: document checklist/);
  assert.match(trip.reply, /passport or travel document/i);
  assert.match(trip.reply, /do not send scans/i);

  const readList = await send(runtime, {
    messageId: "s5",
    ...from,
    inReplyTo: "<s4@example.com>",
    text: "Thanks, I have read the checklist.",
  });
  assert.equal(runtime.store.readCase(readList.caseId ?? "")?.stage, "DOCUMENT_TRACKING");
  assert.match(readList.reply, /Step 5 of 6: document tracking/);
  assert.match(readList.reply, /missing/);

  const docs = await send(runtime, {
    messageId: "s6",
    ...from,
    inReplyTo: "<s5@example.com>",
    text: "I have my passport. The funds evidence is still pending. I can describe my job at home.",
  });
  assert.equal(runtime.store.readCase(docs.caseId ?? "")?.stage, "SUPPORTING_LETTERS");
  assert.match(docs.reply, /Step 6 of 6: supporting letters/);
  assert.match(docs.reply, /Fictionland/);
  assert.match(docs.reply, /2027-06-01/);
  assert.match(docs.reply, /does not say the rules are met/i);

  const pack = await send(runtime, {
    messageId: "s7",
    ...from,
    inReplyTo: "<s6@example.com>",
    text: "The draft looks fine. Please send the pack.",
  });
  assert.equal(runtime.store.readCase(pack.caseId ?? "")?.stage, "FINAL_PACK");
  assert.match(pack.reply, /Final pack/);
  assert.match(pack.reply, /UK Standard Visitor application preparation pack/);
  assert.match(pack.reply, /Fictionland/);
  assert.match(pack.reply, /passport or travel document — ready/i);
  assert.match(pack.reply, /— pending/i);
  assert.match(pack.reply, /£135/);
  assert.match(pack.reply, /apply-standard-visitor-visa/);
  assert.match(pack.reply, /biometrics/i);
  assert.match(pack.reply, /not a human/i);
  assert.match(pack.reply, /will not decide/i);
  assert.doesNotMatch(pack.reply, /you qualify|you are eligible|you need a visa/i);
  const stored = runtime.store.readOutbox(pack.outboxId ?? "");
  assert.match(stored?.packFile?.text ?? "", /Fictionland/);
  assert.match(stored?.packFile?.filename ?? "", /uk-visitor-preparation-pack\.md/);

  let attached = "";
  const transport = resendRestTransport("re_test_not_real", async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { attachments?: { filename: string; content: string }[] };
    attached = Buffer.from(body.attachments?.[0]?.content ?? "", "base64").toString("utf8");
    assert.equal(body.attachments?.[0]?.filename, "uk-visitor-preparation-pack.md");
    assert.equal(JSON.stringify(body).includes("re_test_not_real"), false);
    return Response.json({ id: "re_pack_1" });
  });
  const sent = await dispatchOutbox(runtime.store, stored!, transport, "Visa Helper (AI) <visa@boshen.dev>", ["fiction@example.com"], "visa@boshen.dev");
  assert.equal(sent.status, "sent");
  assert.match(attached, /£135/);
  assert.match(attached, /not a human/i);

  const wife = await send(runtime, {
    messageId: "s8",
    ...from,
    inReplyTo: "<s7@example.com>",
    text: "My wife is travelling with me too.",
  });
  assert.equal(runtime.store.readCase(wife.caseId ?? "")?.stage, "FINAL_PACK");
  assert.match(wife.reply, /Each person needs their own online form/);
  assert.notEqual(runtime.store.readOutbox(wife.outboxId ?? "")?.packFile?.text, stored?.packFile?.text);

  const same = await send(runtime, { messageId: "s9", ...from, inReplyTo: "<s8@example.com>", text: "No other changes." });
  assert.equal(runtime.store.readCase(same.caseId ?? "")?.stage, "DONE");
  assert.equal(runtime.store.readOutbox(same.outboxId ?? "")?.packFile, null);
  assert.match(same.reply, /unchanged/i);
});

test("chinese mail stays in chinese and a fee question does not call the model", async () => {
  let calls = 0;
  const runtime = tempRuntime({ deepseekApiKey: "sk-test-not-a-real-key", senderHourlyLimit: 30 });
  runtime.modelTransport = (async (_url, init) => {
    calls += 1;
    const raw = String(init?.body);
    assert.equal(raw.includes("测试国"), false);
    assert.equal(raw.includes("示例市"), false);
    throw new Error("chinese personal text must not reach the model");
  }) as typeof fetch;
  const person = { headerFrom: "Li <li@example.com>", envelopeFrom: "li@example.com" };
  const hello = await send(runtime, { messageId: "z1", ...person, subject: "你好", text: "你好" });
  assert.match(hello.reply, /第 1 步，共 6 步/);
  assert.match(hello.reply, /不是人类/);
  assert.match(hello.reply, /国籍/);
  assert.equal(calls, 0);

  const fee = await send(runtime, { messageId: "z-fee", ...person, text: "标准访客签证的费用是多少？我的国籍是测试国。" });
  assert.match(fee.reply, /135/);
  assert.match(fee.reply, /费用/);
  assert.match(fee.reply, /第 1 步，共 6 步/);
  assert.equal(calls, 0);
  assert.equal(fee.modelRequests, 0);

  const who = await send(runtime, {
    messageId: "z2",
    ...person,
    inReplyTo: "<z1@example.com>",
    text: "我是测试国人。我住在示例市。我是成年人，用普通护照。没有被拒签过，没有犯罪记录。",
  });
  assert.match(who.reply, /第 2 步，共 6 步/);
  assert.match(who.reply, /测试国/);
  assert.equal(calls, 0);

  const checker = await send(runtime, {
    messageId: "z3",
    ...person,
    inReplyTo: "<z2@example.com>",
    text: "官网查询结果是需要签证。日期是2026年11月1日。",
  });
  assert.match(checker.reply, /第 3 步，共 6 步/);

  const trip = await send(runtime, {
    messageId: "z4",
    ...person,
    inReplyTo: "<z3@example.com>",
    text: "我2027年6月1日到达，2027年6月14日离开，去旅游，只有我。",
  });
  assert.match(trip.reply, /第 4 步，共 6 步/);
  assert.match(trip.reply, /不要发扫描件/);

  const seen = await send(runtime, { messageId: "z5", ...person, inReplyTo: "<z4@example.com>", text: "清单我看过了。" });
  assert.match(seen.reply, /第 5 步，共 6 步/);

  const docs = await send(runtime, {
    messageId: "z6",
    ...person,
    inReplyTo: "<z5@example.com>",
    text: "护照准备好了，资金证明还没有。",
  });
  assert.match(docs.reply, /第 6 步，共 6 步/);
  assert.match(docs.reply, /测试国/);

  const pack = await send(runtime, {
    messageId: "z7",
    ...person,
    inReplyTo: "<z6@example.com>",
    text: "草稿可以，请发给我材料包。",
  });
  assert.equal(runtime.store.readCase(pack.caseId ?? "")?.stage, "FINAL_PACK");
  assert.match(pack.reply, /最终材料包/);
  assert.match(pack.reply, /135/);
  assert.match(pack.reply, /生物信息/);
  assert.match(pack.reply, /测试国/);
  assert.match(pack.reply, /不是人类/);
  assert.match(pack.reply, /不会判断/);
  assert.match(runtime.store.readOutbox(pack.outboxId ?? "")?.packFile?.text ?? "", /测试国/);
  assert.equal(calls, 0);
});

test("an age correction to 16 overrides an earlier 26", async () => {
  const runtime = tempRuntime();
  const who = { headerFrom: "Age Fix <agefix@example.com>", envelopeFrom: "agefix@example.com" };
  const first = await send(runtime, { messageId: "age-26", ...who, text: "I am 26. What is the Standard Visitor fee?" });
  assert.equal(first.reviewFlags.includes("minor"), false);
  const second = await send(runtime, {
    messageId: "age-meant-16",
    ...who,
    inReplyTo: "<age-26@example.com>",
    text: "I meant I am also 16, not 26.",
  });
  assert.equal(second.caseId, first.caseId);
  assert.ok(second.reviewFlags.includes("minor"));
  assert.equal(runtime.store.readCase(second.caseId ?? "")?.stage, "ESCALATED");
  assert.match(second.reply, /qualified immigration adviser/);
});
