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

mkdir -p /opt/email-visa-helper
tar -xzf email-visa-helper-synthetic-test.tar.gz -C /opt/email-visa-helper --strip-components=1
cd /opt/email-visa-helper
npm ci
cp .env.example .env
```

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
cd /opt/email-visa-helper
set -a
. ./.env
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
cd /opt/email-visa-helper
set -a && . ./.env && set +a
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

## Inbound mail, still limited to the allowlist

The Cloudflare worker in `cloudflare/` only forwards a normalized event. It does not send mail. Point it at this process only after the allowlist is set. A sender who is not on `TEST_SENDER_ALLOWLIST`, or whose `From` address did not pass DMARC at `mx.cloudflare.net`, is not stored and does not call the model. `Reply-To` and the message body cannot choose a recipient.

Sending stays off until you also set `AUTO_REPLY=general_info`, `DELIVERY_MODE=cloudflare`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_EMAIL_API_TOKEN`. Even then, only a general-information draft goes out, and only to the allowlisted authenticated sender. Worksheets and review cases stay in the outbox.

Do not change existing MX, SPF, DKIM, or other routing rules as part of unpacking this archive. Public launch remains blocked. This is not a legal clearance to give personalised immigration advice.
