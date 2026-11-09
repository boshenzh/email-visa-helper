# Architecture

One Node process owns the case. A Cloudflare Worker, when you later deploy it, only normalizes an inbound message and POSTs it to that process. Nothing in this repo sends mail.

## Why this is not an eve project

eve 1.0.0-rc.6 can call an OpenAI-compatible endpoint, including a direct provider, and it can turn off its default tools. That was checked against the package docs (`defineAgent`, `@ai-sdk/openai-compatible`, `defaultTools: false`).

It is not used here, for these reasons:

- The inbound path must not send applicant facts, raw mail, citizenship, or immigration status to a model. A short local loop makes that gate obvious and testable. eve’s session transcript is a second place those facts could land.
- eve’s default harness includes shell and file tools unless they are all switched off. This demo does not need a sandbox shell. Document generation is an allowlisted writer.
- OpenAI’s Agents API architecture (harness, environment, application server) is that product’s session API. DeepSeek’s Chat Completions API is stateless: `previous_response_id`, `store`, and hosted sessions are not part of the adapter we use. The portable piece we kept is reason, act, observe, with the application owning state, tools, budgets, and the outbox.
- Mock mode has to pass the whole demo with no API key.

`runPublicTopicLoop` is the agent. It calls `POST https://api.deepseek.com/chat/completions` with `tools`, `tool_choice: "auto"`, and `thinking: { "type": "disabled" }`. The model id comes from `DEEPSEEK_MODEL` and defaults to `deepseek-flash`. The documented enum on 2026-11-08 is `deepseek-flash` and `deepseek-v4-pro`. Thinking is disabled because it is otherwise on, and thinking-plus-tools would require storing `reasoning_content`. That field is dropped if a response still contains it. Strict mode (`/beta`) is not used.

The only user message is `topic: <id>`. The only tool is `lookup_official`. Its result is the official snapshot for that id. The next request appends the assistant `tool_calls` and a `role: "tool"` message with the same `tool_call_id`. A tool name outside the allowlist gets `rejected` and is not executed. The loop stops on a step, tool, token, cost, or time budget.

The final text is kept only if it does not state a personal conclusion and any `£` amount is one of the snapshot fees. Local code then adds the disclosure, the snapshot block, questions, and a worksheet. A failed check drops the model text and the local snapshot remains.

`DEPLOYMENT_PROFILE` defaults to `dry_run`. That profile refuses `AGENT_MODE=live` and refuses sending, so a copied `.env` cannot turn the public service on. `synthetic_test` refuses to start until `TEST_SENDER_ALLOWLIST` has at least one email. In that profile, intake, model calls, and sending happen only for the DMARC-authenticated `From` address on that list. `Reply-To` and addresses typed in the body are not recipients. `PUBLIC_LAUNCH` stays `blocked`.

The loop runs for an inbound message only when all of these are true:

- `DEPLOYMENT_PROFILE=synthetic_test` and `AGENT_MODE=live` when the process itself attaches the network client
- the sender is on `TEST_SENDER_ALLOWLIST`
- the local classifier picked one public topic
- the message is not out of scope, not a review case, and not an injected or account-action message
- `modelTransport` is set and `DEEPSEEK_API_KEY` is non-empty

`AGENT_MODE=live` wires `fetch` as that transport when the key is already in the environment. This VM does not have the key, so `npm test` and `npm run sample` use a mocked transport. Those tests assert the HTTP body. They are not a live provider call. A coordinator check reported that `deepseek-flash` answers on the operator’s account. A September 2026 DeepSeek post said `deepseek-v4-pro` traffic would be routed to V4.1 Flash for a period; the English pricing page still lists both ids.

Matching a keyword and deleting it from a string is not treated as a way to make arbitrary mail safe. The request is built from the topic id and the snapshot file. If that cannot be done, the model is not called.

## Flow

```
verified inbound → dedupe → loop / auth / rate gates
  → local fact extract (vault)
  → scope category
  → bounded local tool loop
  → template reply from official snapshots
  → outbox draft
```

Categories are `GENERAL_INFORMATION`, `CLERICAL_APPLICANT_CONTROLLED`, `REGULATED_REVIEW_REQUIRED`, and `OUT_OF_SCOPE`. Uncertainty becomes review.

Tools the local policy may call: `lookup_official`, `list_gaps`, `build_worksheet`, `flag_review`. Arguments are checked. A tool cannot choose a recipient, a shell command, or a deletion. Worksheet writing is refused unless the category is the clerical one. Deletion is a separate authenticated path.

Budgets, from the environment and overridable in tests: 6 model steps, 8 tool actions, wall-clock limit, token estimate, and a cost ceiling used only by the synthetic adapter. The cost table is the published peak cache-miss price on 2026-11-08, used as a local ceiling, not an invoice. Unknown model ids are rejected rather than priced.

## Mail

Cloudflare Email Routing invokes `email(message, env, ctx)`. It can `forward`, `reply`, or `setReject`. This adapter does not call `reply`. There is no `send_email` binding, so the Worker cannot call the sending API by accident.

`message.reply()` is the constrained way to answer the same sender later: DMARC must pass, the recipient must be the inbound sender, one reply per event, and more than 100 `References` entries are rejected by Cloudflare. Arbitrary-recipient sending is a different product (Email Sending, Workers Paid, an onboarded domain) via the binding, the REST API, or authenticated SMTP on `smtp.mx.cloudflare.net:465`. Routing does not give you a general SMTP inbox. None of those send paths are implemented.

The Node outbox stores a draft. Operator approval sets `approved_not_sent` and does not send.

`src/mail.ts` is the Email Sending REST client: `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/email/sending/send` with `to`, `from`, `subject`, and `text`. It is not the inbound `email()` handler and it is not generic SMTP. It runs only when `AUTO_REPLY=general_info` and `DELIVERY_MODE=cloudflare`. The recipient is the address stored when the draft was created, which is the DMARC-authenticated sender. A `sent` row is not sent again. A `queued` row is not sent again. HTTP 429 and 5xx are retried up to three attempts; other HTTP errors fail the row. The default is `AUTO_REPLY=off` and `DELIVERY_MODE=preview`, so this process does not call that API. Tests inject a mock transport. No message was sent from this VM.

Identity for a case is the header From only when the first `Authentication-Results` value is from `mx.cloudflare.net` and `dmarc=pass` is aligned to that domain. Reply-To is ignored. HTML is not used as the body. Our own address, auto-submitted mail, bulk precedence, mailer-daemon, and our `X-Visa-Agent` header do not get a reply.

## Cases

Each verified sender has one directory named by the SHA-256 of the address. The vault holds the structured statements. With `VAULT_KEY` set (16 characters or more) the vault file is AES-256-GCM. Artifact names are a fixed pattern. Symlinks and `..` are rejected. Logs pass known secrets through a redaction step and do not store the raw body.

The 30-day TTL is a product choice for this demo store. It is not a legal retention rule and it does not delete copies a provider might hold. The IAA code’s six-year client-file practice was not re-read in full and is not implemented.

Downloads use an unguessable token, not a public case path.

## Optional container

`Dockerfile` runs the same Node process as a non-root user, with a read-only root and a data volume. `deploy/Dockerfile.sandbox` only renders a worksheet from `/in/worksheet.json` to `/out/worksheet.md`, with no network and no shell entrypoint. The app does not invoke Docker. Do not mount the host Docker socket.
