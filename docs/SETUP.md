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

Operator routes use a different token (`OPERATOR_TOKEN`): approve an outbox item, send one stored draft, delete a case by id, or run the demo TTL sweep. The ingress token cannot do those. The send route also refuses a public client address.

## 2. Live model, later

The key stays in the server environment. It is not in this VM, so the tests here mock `fetch` and do not claim a live completion.

When you choose to call the account that already answered as `deepseek-flash`:

1. Export `DEEPSEEK_API_KEY` only in that server environment. Keep `DEEPSEEK_MODEL=deepseek-flash` unless you have confirmed the other documented id on the account.
2. Set `AGENT_MODE=live` and keep `DEEPSEEK_THINKING=disabled`.
3. The process then uses the real Chat Completions endpoint for mail that reduces to one public topic. Personal and uncertain mail still does not call it.
4. Watch `data/logs/model-requests.jsonl`. Each line should be a topic id and an official snippet. If a line contains an applicant sentence, stop and treat that as a bug.

There is no verified API promise of zero retention, no training, or a particular region.

## 2a. Narrow auto-reply, later

Leave `AUTO_REPLY=off` and `DELIVERY_MODE=preview` until you intend to send.

Cloudflare Email Sending is not available on the Workers Free plan. The outbound path for this account is Resend. The exact host edits are in [DEPLOY.md](DEPLOY.md). Summary:

1. Set `DELIVERY_MODE=resend`, `RESEND_API_KEY`, and `RESEND_FROM` (for example `Visa Helper (AI) <visa@boshen.dev>`) in the server environment, not in git. The process exits if the mode is `resend` and either value is missing.
2. `reply_to` is `MAILBOX` (`visa@boshen.dev`). The recipient stays the allowlisted authenticated sender.
3. Keep `AUTO_REPLY=off` to prove one draft by hand: `POST /v1/outbox/<id>/send` with `OPERATOR_TOKEN`, or `node --experimental-strip-types src/send-outbox.ts <id>`. Neither call takes a recipient.
4. Set `AUTO_REPLY=general_info` only when general-information replies should go out on their own. Clerical worksheets, review cases, and out-of-scope mail stay in the outbox.

`DELIVERY_MODE=cloudflare` with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_EMAIL_API_TOKEN` remains in the code for an account that can use Email Sending. This account cannot. Do not do either send path as part of copying the repo. This run did not.

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
- Email Sending (REST `POST /accounts/{account_id}/email/sending/send`, a `send_email` binding, or SMTP `smtp.mx.cloudflare.net:465` with an API token) is how Cloudflare submits outbound mail. Arbitrary recipients need Workers Paid and an onboarded sending domain. This account is on the Free plan, so that product is not the outbound path. The Node process calls Resend when `DELIVERY_MODE=resend`. It does not call the Cloudflare send binding or SMTP.
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
