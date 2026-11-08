# Architecture

One Node process owns the case. A Cloudflare Worker, when you later deploy it, only normalizes an inbound message and POSTs it to that process. Nothing in this repo sends mail.

## Why this is not an eve project

eve 1.0.0-rc.6 can call an OpenAI-compatible endpoint, including a direct provider, and it can turn off its default tools. That was checked against the package docs (`defineAgent`, `@ai-sdk/openai-compatible`, `defaultTools: false`).

It is not used here, for these reasons:

- The inbound path must not send applicant facts, raw mail, citizenship, or immigration status to a model. A short local loop makes that gate obvious and testable. eve’s session transcript is a second place those facts could land.
- eve’s default harness includes shell and file tools unless they are all switched off. This demo does not need a sandbox shell. Document generation is an allowlisted writer.
- OpenAI’s Agents API architecture (harness, environment, application server) is that product’s session API. DeepSeek’s Chat Completions API is stateless: `previous_response_id`, `store`, and hosted sessions are not part of the adapter we use. The portable piece we kept is reason, act, observe, with the application owning state, tools, budgets, and the outbox.
- Mock mode has to pass the whole demo with no API key.

The DeepSeek adapter is a separate function, `runSyntheticPublicAdapter`. It speaks Chat Completions only, at `https://api.deepseek.com/chat/completions`, model id from `DEEPSEEK_MODEL`, default `deepseek-flash`. The documented enum on 2026-11-08 is `deepseek-flash` and `deepseek-v4-pro`. Thinking is sent as `{ "type": "disabled" }` because thinking is otherwise on, and thinking-plus-tools would require storing `reasoning_content`. Strict mode (`/beta`) is not used. Any `reasoning_content` that still arrives is discarded and not logged. Inbound mail never calls this function, including when `AGENT_MODE=live`.

Account availability was not checked. The key is not in this environment. A Chinese news post from September 2026 said `deepseek-v4-pro` traffic would be routed to V4.1 Flash until a later Pro model; the English pricing page still lists both ids. Do not assume either id works on the account until a live call that you run yourself.

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

The Node outbox stores a draft. Approval sets `approved_not_sent` and does not call a provider. `blockedSend()` throws if something tries to treat a provider as live.

Identity for a case is the header From only when the first `Authentication-Results` value is from `mx.cloudflare.net` and `dmarc=pass` is aligned to that domain. Reply-To is ignored. HTML is not used as the body. Our own address, auto-submitted mail, bulk precedence, mailer-daemon, and our `X-Visa-Agent` header do not get a reply.

## Cases

Each verified sender has one directory named by the SHA-256 of the address. The vault holds the structured statements. With `VAULT_KEY` set (16 characters or more) the vault file is AES-256-GCM. Artifact names are a fixed pattern. Symlinks and `..` are rejected. Logs pass known secrets through a redaction step and do not store the raw body.

The 30-day TTL is a product choice for this demo store. It is not a legal retention rule and it does not delete copies a provider might hold. The IAA code’s six-year client-file practice was not re-read in full and is not implemented.

Downloads use an unguessable token, not a public case path.

## Optional container

`Dockerfile` runs the same Node process as a non-root user, with a read-only root and a data volume. `deploy/Dockerfile.sandbox` only renders a worksheet from `/in/worksheet.json` to `/out/worksheet.md`, with no network and no shell entrypoint. The app does not invoke Docker. Do not mount the host Docker socket.
