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

`dry_run` refuses `AGENT_MODE=live`, `AUTO_REPLY=general_info`, and `DELIVERY_MODE=cloudflare`. The process exits instead of silently going live.

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

Expect `"profile":"dry_run"`, `"publicLaunch":"blocked"`, `"autoReply":"off"`, and `"modelCallsOnInbound":false`.

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

Sending from the Node process stays off until you also set `AUTO_REPLY=general_info`, `DELIVERY_MODE=cloudflare`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_EMAIL_API_TOKEN`. Even then, only a general-information draft goes out, and only to the allowlisted authenticated sender. Worksheets and review cases stay in the outbox.

Do not change existing MX, SPF, DKIM, or other routing rules as part of unpacking this archive. Public launch remains blocked. This is not a legal clearance to give personalised immigration advice.
