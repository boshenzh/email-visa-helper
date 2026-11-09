import assert from "node:assert/strict";
import test from "node:test";
import { authorizedForwardAddress, handleEmail, sameMailbox } from "../cloudflare/src/ingress.js";

const mailbox = "visa@boshen.dev";

function messageFor(to: string, extra: Record<string, unknown> = {}) {
  const calls = { reject: [] as string[], forward: [] as string[] };
  const message = {
    to,
    from: "synthetic@example.com",
    rawSize: 80,
    raw: "From: Synthetic <synthetic@example.com>\r\nMessage-ID: <m@example.com>\r\n\r\nWhat is the Standard Visitor fee?\r\n",
    headers: {
      get(name: string) {
        const values: Record<string, string> = {
          from: "Synthetic <synthetic@example.com>",
          "message-id": "<m@example.com>",
          subject: "fee",
        };
        return values[name] ?? null;
      },
    },
    canBeForwarded: true,
    setReject(reason: string) {
      calls.reject.push(reason);
    },
    async forward(dest: string) {
      calls.forward.push(dest);
    },
    ...extra,
  };
  return { message, calls };
}

const baseEnv = {
  MAILBOX: mailbox,
  RUNTIME_URL: "https://runtime.test/v1/email/inbound",
  INGRESS_TOKEN: "ingress-token-for-tests-0123456789",
  RUNTIME_TIMEOUT_MS: "1000",
};

test("recipient match is the canonical mailbox, not a substring", () => {
  assert.equal(sameMailbox("visa@boshen.dev", mailbox), true);
  assert.equal(sameMailbox("Visa <visa@boshen.dev>", mailbox), true);
  assert.equal(sameMailbox("visa+note@boshen.dev", mailbox), true);
  assert.equal(sameMailbox("notvisa@boshen.dev", mailbox), false);
  assert.equal(sameMailbox("visa@boshen.dev.attacker.test", mailbox), false);
  assert.equal(sameMailbox("prevvisa@boshen.dev", mailbox), false);
  assert.equal(sameMailbox("visa@notboshen.dev", mailbox), false);
  assert.equal(sameMailbox("someone@example.com", mailbox), false);
});

test("a mismatched recipient is rejected and never forwarded", async () => {
  const { message, calls } = messageFor("notvisa@boshen.dev");
  let fetched = 0;
  const result = await handleEmail(
    message,
    { ...baseEnv, OPERATOR_FORWARD_ADDRESS: "ops@example.com", OPERATOR_FORWARD_VERIFIED: "true" },
    async () => {
      fetched += 1;
      return new Response("ok", { status: 200 });
    },
  );
  assert.equal(result.outcome, "reject");
  assert.equal(result.reason, "recipient_mismatch");
  assert.equal(calls.reject.length, 1);
  assert.deepEqual(calls.forward, []);
  assert.equal(fetched, 0);
});

test("runtime 2xx is accepted only after the response, and an unverified forward is not used", async () => {
  const { message, calls } = messageFor("visa@boshen.dev");
  let settled = false;
  const result = await handleEmail(
    message,
    { ...baseEnv, OPERATOR_FORWARD_ADDRESS: "ops@example.com", OPERATOR_FORWARD_VERIFIED: "false" },
    async () => {
      settled = true;
      return new Response("ok", { status: 200 });
    },
  );
  assert.equal(settled, true);
  assert.equal(result.outcome, "accepted");
  assert.deepEqual(calls.forward, []);
  assert.deepEqual(calls.reject, []);
  assert.equal(authorizedForwardAddress({ OPERATOR_FORWARD_ADDRESS: "ops@example.com", OPERATOR_FORWARD_VERIFIED: "false", MAILBOX: mailbox }), null);
});

test("non-2xx and timeouts reject when no verified forward is authorized", async () => {
  const bad = messageFor("Visa <visa@boshen.dev>");
  const status = await handleEmail(bad.message, baseEnv, async () => new Response("no", { status: 503 }));
  assert.equal(status.outcome, "reject");
  assert.equal(status.reason, "runtime_status_503");
  assert.equal(bad.calls.forward.length, 0);
  assert.match(bad.calls.reject[0] ?? "", /runtime unavailable/);

  const hung = messageFor("visa@boshen.dev");
  const timed = await handleEmail({ ...hung.message }, { ...baseEnv, RUNTIME_TIMEOUT_MS: "30" }, (_url: string | URL | Request, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  });
  assert.equal(timed.outcome, "reject");
  assert.equal(timed.reason, "runtime_unreachable");
  assert.equal(hung.calls.forward.length, 0);
  assert.equal(hung.calls.reject.length, 1);
});

test("a verified forward preserves the original mail when the runtime fails, and nowhere else", async () => {
  const { message, calls } = messageFor("visa+note@boshen.dev");
  const result = await handleEmail(
    message,
    { ...baseEnv, OPERATOR_FORWARD_ADDRESS: "Ops <ops@example.com>", OPERATOR_FORWARD_VERIFIED: "true" },
    async () => new Response("down", { status: 502 }),
  );
  assert.equal(result.outcome, "preserved");
  assert.deepEqual(calls.forward, ["ops@example.com"]);
  assert.deepEqual(calls.reject, []);

  const unverified = messageFor("visa@boshen.dev");
  const rejected = await handleEmail(
    unverified.message,
    { ...baseEnv, OPERATOR_FORWARD_ADDRESS: "ops@example.com" },
    async () => {
      throw new Error("connect timeout");
    },
  );
  assert.equal(rejected.outcome, "reject");
  assert.deepEqual(unverified.calls.forward, []);
  assert.equal(unverified.calls.reject.length, 1);
});
