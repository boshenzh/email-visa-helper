# Setup

Do not change DNS, deploy the Worker, or send mail while following this the first time. The checks below stay on this machine.

## 1. Local demo

Requirements: Node.js 22 or newer.

```bash
npm install
npm test
npm run sample
cp .env.example .env
# Leave DEEPSEEK_API_KEY empty.
npm start
```

In another shell:

```bash
curl -s http://127.0.0.1:8080/health
```

Expect `autoReply` `off`, `delivery` `preview`, `publicLaunch` `blocked`, and `modelCallsOnInbound` false.

A verified inbound event is `POST /v1/email/inbound` with `Authorization: Bearer $INGRESS_TOKEN`. The tests build that event. Without a Cloudflare `Authentication-Results` header from `mx.cloudflare.net` showing `dmarc=pass`, the runtime does not attach the message to a case.

Operator routes use a different token (`OPERATOR_TOKEN`): approve an outbox item, delete a case by id, or run the demo TTL sweep. The ingress token cannot do those.

## 2. Live model check, later

The key is expected to be present on the operator’s host, not in this repo and not in chat. This coding environment does not have it, so no live call was made.

When you choose to test the adapter yourself:

1. Export `DEEPSEEK_API_KEY` in the server environment only.
2. Keep `DEEPSEEK_MODEL=deepseek-flash` unless you have confirmed `deepseek-v4-pro` on that account.
3. Keep `DEEPSEEK_THINKING=disabled`.
4. Call `runSyntheticPublicAdapter` from a one-off script that uses a public topic and no applicant text. Inbound mail still will not call it.
5. Stop if the payload checker throws. Do not “fix” that by putting a nationality or a raw email into the prompt.

There is no verified API promise of zero retention, no training, or a particular region. Do not send real mail or real identity data to find out.

## 3. Docker on the existing server

The compose file is a scaffold. It does not know your host, and running it here was not part of bringing the assistant online.

```bash
docker compose config
```

`visa-agent` publishes `127.0.0.1:8080` only, drops capabilities, runs as uid 10001, and has no Docker socket. The `worksheet-sandbox` service is behind the `sandbox` profile, has `network_mode: none`, and is not started by a normal `docker compose up`.

Do not add the host Docker socket. Do not set `AUTO_REPLY` to anything but `off` (the process refuses other values).

## 4. Cloudflare, when you are ready

Facts checked against Cloudflare’s Email Service docs (pages updated October 2026):

- Email Routing can send a message to a Worker’s `email()` handler or to a verified destination address. Routing works on Workers Free and Paid. It is not a general-purpose SMTP server for you to receive arbitrary mailboxes.
- Email Sending (REST `POST /accounts/{account_id}/email/sending/send`, a `send_email` binding, or SMTP `smtp.mx.cloudflare.net:465` with an API token) is how outbound mail is submitted. Arbitrary recipients need Workers Paid and an onboarded sending domain. Until a domain is onboarded, sending is limited to verified destination addresses. This repo does not call any of those.
- `message.reply()` answers the same sender inside the inbound event. Cloudflare requires a passing DMARC result, a recipient equal to the inbound sender, a single reply, and at most 100 `References` entries. The Worker in this repo does not call it.
- Inbound messages over 25 MiB are rejected by Routing. This adapter rejects anything over 1 MiB before it reads the rest.

Preserve what already works:

1. Do not replace the zone’s MX, SPF, or DKIM records as part of copying this repo. If Email Routing is already on for `boshen.dev`, leave the existing MX in place.
2. Do not edit or disable the catch-all, and do not retarget existing destination addresses.
3. Add a **new** routing rule only for the local part `visa` on `boshen.dev`, and only when you want this Worker to see that mail. Action: Send to Worker. Leave every other rule as it is.
4. Before that rule is enabled, set `OPERATOR_FORWARD_ADDRESS` to the mailbox that receives `visa@` today, and confirm that address is a verified destination. The Worker forwards a copy there and also POSTs to the runtime. If the forward address is empty and the runtime secret is missing, the Worker **rejects** the message instead of dropping it silently. Do not enable the rule until the forward target is set, or senders will get a reject.
5. Put `INGRESS_TOKEN` in `wrangler secret put INGRESS_TOKEN`. The same value goes in the Node process. Do not put it in `wrangler.jsonc`.
6. `RUNTIME_URL` in the scaffold is `http://127.0.0.1:8080/v1/email/inbound`. Change it to the real origin you control. A Worker cannot reach your laptop’s localhost.
7. There is no `account_id`, zone id, or route id in the repo. Fill those in the dashboard or Wrangler when you deploy. Do not invent them.
8. Do not add a `send_email` binding until a reviewed design actually sends. `AUTO_REPLY` in the Worker vars is `off` and the Worker has no send call to switch on.
9. After `npm install wrangler` locally, run `wrangler types` so bindings are generated rather than hand-written. This repo does not install Wrangler.

`cloudflare/wrangler.jsonc` sets `compatibility_date` to 2026-11-08, `nodejs_compat`, and Workers observability with traces. `workers_dev` is false.

## 5. What “done” is not

A green `npm test` does not mean a person can rely on a fee, a processing time, or a document list. Those strings are snapshots. Re-read the pages in `docs/SOURCE-REGISTER.md` before quoting them again, and do not turn auto-reply on as part of that refresh.
