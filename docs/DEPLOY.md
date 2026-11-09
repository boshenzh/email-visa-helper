# Restricted synthetic test install

This package is the dry-run default. It does not become a public service by starting it. Live model calls and email sending start only when the profile is `synthetic_test` and `TEST_SENDER_ALLOWLIST` lists the operator mailboxes that may be processed.

No secrets are in the archive. `npm ci` on the host installs the lockfile. Node.js 22 or newer is required.

## Install without cloning

Copy `email-visa-helper-synthetic-test.tar.gz` and its `.sha256` file to the machine. Check the checksum, then unpack:

```bash
# Linux or the VPS
sha256sum -c email-visa-helper-synthetic-test.tar.gz.sha256
# Mac
shasum -a 256 -c email-visa-helper-synthetic-test.tar.gz.sha256

# Unpack beside the current release. Do not delete /opt/email-visa-helper.
# That directory holds shared/runtime.env, shared/data, and prior releases.
COMMIT=replace-with-the-commit-in-RELEASE.json
mkdir -p /opt/email-visa-helper/releases/"$COMMIT"
tar -xzf email-visa-helper-synthetic-test.tar.gz -C /opt/email-visa-helper/releases/"$COMMIT" --strip-components=1
cd /opt/email-visa-helper/releases/"$COMMIT"
npm ci
```

Do not run `rm -rf /opt/email-visa-helper`. Do not remove `shared/`, prior release directories, or the external Docker network `visa-test-ingress`. The archive does not contain `runtime.env`. The running test profile stays in `/opt/email-visa-helper/shared/runtime.env`.

Edit `.env` on that machine. Do not commit it.

Minimum for a process that stays shut for the public:

```bash
DEPLOYMENT_PROFILE=dry_run
AGENT_MODE=mock
AUTO_REPLY=off
DELIVERY_MODE=preview
PUBLIC_LAUNCH=blocked
INGRESS_TOKEN=replace-with-a-long-random-string
OPERATOR_TOKEN=replace-with-a-different-long-random-string
```

`dry_run` refuses `AGENT_MODE=live`, any `AUTO_REPLY` other than `off`, and `DELIVERY_MODE=cloudflare` or `resend`. `DELIVERY_MODE=resend` also exits at startup when `RESEND_API_KEY` or `RESEND_FROM` is missing. The process exits instead of silently going live.

## Start

```bash
cd /opt/email-visa-helper/releases/"$COMMIT"
set -a
. /opt/email-visa-helper/shared/runtime.env
set +a
node --experimental-strip-types src/index.ts
```

Check:

```bash
curl -s http://127.0.0.1:8080/health
```

Expect `"profile":"dry_run"`, `"publicLaunch":"blocked"`, `"autoReply":"off"`, `"modelCallsOnInbound":false`, and `"resend":{"state":"off","from":"","replyTo":""}`.

## Synthetic model check without email

Use this when Cloudflare email is not onboarded yet. It calls DeepSeek with a public topic id only. It does not accept applicant text.

Set, in `.env` only:

```bash
DEPLOYMENT_PROFILE=synthetic_test
TEST_SENDER_ALLOWLIST=you@example.com
AGENT_MODE=live
DEEPSEEK_API_KEY=already-on-this-host
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_THINKING=disabled
AUTO_REPLY=off
DELIVERY_MODE=preview
```

`TEST_SENDER_ALLOWLIST` must contain at least one real mailbox. The synthetic HTTP route still does not take email from the request.

```bash
cd /opt/email-visa-helper/releases/"$COMMIT"
set -a && . /opt/email-visa-helper/shared/runtime.env && set +a
node --experimental-strip-types src/synthetic-cli.ts fees
```

Or, with the server already running:

```bash
curl -s http://127.0.0.1:8080/v1/synthetic/explain \
  -H "authorization: Bearer $OPERATOR_TOKEN" \
  -H "content-type: application/json" \
  -d '{"topic":"fees"}'
```

Allowed topic ids: `fees`, `eta`, `documents`, `processing`, `visitor`, `routes`, `translations`, `identity`, `checker`. A body that also contains `text`, `email`, `messages`, or `prompt` is rejected. On `dry_run` the route is closed. If the key is missing the route returns `no_api_key` and does not invent an answer.

## Inbound worker

The worker accepts only the canonical mailbox in `MAILBOX` (default `visa@boshen.dev`), including a display name and a subaddress such as `visa+note@boshen.dev`. `notvisa@boshen.dev` and `visa@boshen.dev.example` do not match. A mismatch calls `message.setReject` and does not call `forward`.

Cloudflare’s email handler documentation, updated 30 October 2026, describes `message.setReject(reason)` as a permanent SMTP error. It does not document a transient SMTP response or an automatic retry of `email()`. Do not expect a thrown exception to defer the message; this worker does not use throw as a retry mechanism.

The handler waits for the runtime response. A non-2xx status, a timeout, or a network error is a delivery failure. If `OPERATOR_FORWARD_VERIFIED` is exactly `true` and `OPERATOR_FORWARD_ADDRESS` is a different canonical address, the worker first forwards the original message there. That address must already be a verified destination in the Cloudflare account; the flag is the operator’s confirmation, and the worker will not forward without it. If that forward is not authorized, or it throws, the worker calls `setReject` so the message is not accepted and dropped.

Leave the Email Routing rule disabled until Zone Settings permission allows a review. Do not change MX, SPF, DKIM, or other rules while unpacking this archive.

## Redeploy the existing VPS container

Keep `/opt/email-visa-helper/shared`, every prior release directory, and the Docker network `visa-test-ingress`. Do not remove them. Do not run `rm -rf /opt/email-visa-helper`.

The current restricted test stays as it is: `DEPLOYMENT_PROFILE=synthetic_test`, `AGENT_MODE=live`, `AUTO_REPLY=off`, `DELIVERY_MODE=preview`, `PUBLIC_LAUNCH=blocked`. This archive does not change that file.

```bash
docker network inspect visa-test-ingress
cd /opt/email-visa-helper/releases/"$COMMIT"
docker compose -f deploy/docker-compose.vps.yml up -d --build
docker inspect visa-test-ingress --format '{{.Name}}'
```

`deploy/docker-compose.vps.yml` joins the existing external network. It does not create a replacement network and it does not contain credentials. It reads `/opt/email-visa-helper/shared/runtime.env` and stores cases in `/opt/email-visa-helper/shared/data`. Recreating the container must leave it on `visa-test-ingress`. Do not run `docker network rm visa-test-ingress` and do not prune volumes. Public launch stays blocked. Sending stays off unless that env file also sets the general-info switches, which the current test file does not.

Automatic sending stays off until you set `AUTO_REPLY` and a delivery mode. `general_info` sends only a general-information reply. `all` sends every customer reply the runtime writes for an allowlisted DMARC-authenticated sender: intake, a worksheet, an escalation, a refusal, and out-of-scope mail. Cloudflare Email Sending (`DELIVERY_MODE=cloudflare`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN`) is not available on the Workers Free plan. On this account use Resend. `Reply-To` and addresses in the body are never the recipient. `PUBLIC_LAUNCH` stays `blocked`. A `sent` or `queued` row is not sent again. HTTP 429 and 5xx are retried up to three times.

Two rows stay unsent even when `AUTO_REPLY=all`. `held_unverified` has no DMARC pass, so there is no allowlisted recipient. `suppressed` covers mail-loop stops and the kill switch; a reply there would loop or ignore the pause, and the kill-switch row has no authenticated recipient.

## One Resend proof, by hand

In `/opt/email-visa-helper/shared/runtime.env`, set Resend and turn automatic sending on for every customer reply:

```bash
DELIVERY_MODE=resend
RESEND_API_KEY=set-on-this-host-only
RESEND_FROM=Visa Helper (AI) <visa@boshen.dev>
AUTO_REPLY=all
```

Keep the rest of the current test file:

```bash
DEPLOYMENT_PROFILE=synthetic_test
AGENT_MODE=live
PUBLIC_LAUNCH=blocked
MAILBOX=visa@boshen.dev
TEST_SENDER_ALLOWLIST=the-mailbox-that-may-receive-the-proof
```

`RESEND_FROM` is the From header. `reply_to` is `MAILBOX`, which is `visa@boshen.dev`. The recipient is the address already stored on the outbox row, which is the DMARC-authenticated sender, and it must be on `TEST_SENDER_ALLOWLIST`. The send route and the CLI do not accept a recipient argument.

Recreate the container with the command above. Do not publish port 8080 on a public interface. `deploy/docker-compose.vps.yml` keeps `127.0.0.1:8080:8080`.

Check:

```bash
curl -s http://127.0.0.1:8080/health
```

Expect `"delivery":"resend"`, `"autoReply":"all"`, `"emailSending":true`, `"publicLaunch":"blocked"`, and `"resend":{"state":"auto","from":"Visa Helper (AI) <visa@boshen.dev>","replyTo":"visa@boshen.dev"}`. `autoReply` is the mode: `off`, `general_info`, or `all`. `resend.state` is `manual` while `AUTO_REPLY=off`, and `off` when Resend is not selected.

A preparation case moves through `INTAKE`, `ROUTE_CHECK`, `PURPOSE_AND_TRIP`, `DOCUMENT_CHECKLIST`, `DOCUMENT_TRACKING`, `SUPPORTING_LETTERS`, `FINAL_PACK`, and `DONE`. The pack email includes the facts, checklist, form answers, drafts, the snapshot fee, and the official next steps. Resend attaches `uk-visitor-preparation-pack.md` and sends a new file when a fact changes. Minors, refusals, criminal issues, work, study, and marriage stop at `ESCALATED`.

Send one existing draft. `OUTBOX_ID` is the 32-character id already in the outbox. The body must be empty. A public client address is refused. The ingress token is refused.

```bash
curl -s -X POST "http://127.0.0.1:8080/v1/outbox/${OUTBOX_ID}/send" \
  -H "authorization: Bearer $OPERATOR_TOKEN"
```

The same action from inside the container, with no extra argument:

```bash
docker compose -f deploy/docker-compose.vps.yml exec -T visa-agent \
  node --experimental-strip-types src/send-outbox.ts "$OUTBOX_ID"
```

A successful row has `"status":"sent"`. Calling either command again does not send a second time. Do not set `PUBLIC_LAUNCH` to anything but `blocked`. Do not put `RESEND_API_KEY` in git or in this archive.

Do not change existing MX, SPF, DKIM, or other routing rules as part of unpacking this archive. Public launch remains blocked. This is not a legal clearance to give personalised immigration advice.
