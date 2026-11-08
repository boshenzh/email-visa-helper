# email-visa-helper

A small draft-only inbox assistant for **UK Standard Visitor preparation**. It reads `visa@boshen.dev` only after you choose to route that address. It does not send mail, submit applications, or give a personal eligibility decision.

This repository is a demo. It is **not** cleared for public launch and it is **not** a regulated immigration adviser.

## Status

| Piece | State |
| --- | --- |
| Local intake, official-source signposting, clerical worksheet, outbox draft | **Implemented** |
| Deterministic tests and the sample in `examples/sample-standard-visitor/` | **Implemented** (mock, no API key) |
| DeepSeek Chat Completions adapter (`deepseek-flash`, thinking disabled) | **Implemented, not used for inbound mail.** Live account check is **blocked** here: the key is not in this environment |
| Cloudflare Email Routing `email()` adapter | **Scaffold only.** Not deployed |
| Auto-reply, DNS, real sending, application payment or submission | **Blocked.** Not activated |
| Personalised eligibility, evidence strategy, or representations | **Blocked** until legal review |
| “Production safe” | **Not claimed** |

Inbound mail is handled by a local reason/act/observe loop. Applicant facts stay on disk. They are not put in a model request. `AGENT_MODE=live` does not change that.

## What a reply is

The assistant says it is an AI, not a person and not a licensed adviser. It can:

- point at official pages and the figures those pages showed on **2026-11-08**
- ask for missing intake labels
- copy the applicant’s own words into a worksheet when the request is an ordinary visitor preparation and no complication flag is set

It will not decide visa versus ETA, invent a bank balance, promise a decision time, or write a letter that says the rules are met. Complication flags (refusal, a minor, work, study, marriage, transit exemptions, inconsistent dates, a VAC/passport conflict, a request for a personal verdict) become `REGULATED_REVIEW_REQUIRED` and point to [find an immigration adviser](https://www.gov.uk/find-an-immigration-adviser).

Other topics get a short refusal and no tools.

## Run the demo

```bash
npm test
npm run sample
npm start
```

`npm start` listens on `127.0.0.1:8080` and does not call DeepSeek. Copy `.env.example` to `.env` on the server when you are ready. Leave `DEEPSEEK_API_KEY` empty until a separate live test is approved. Do not paste the key into chat or into git.

Setup that touches DNS or mail is in [docs/SETUP.md](docs/SETUP.md). Do that only when you mean to. This tree does not do it.

## Layout

- `src/` — one orchestrator, local tools, outbox, case files
- `knowledge/uk/` — official snapshots and the regulatory boundary
- `cloudflare/` — Email Routing adapter with placeholders, no account id
- `evals/fixtures.json` — single-turn checks run by `npm test`
- `examples/sample-standard-visitor/` — fictional local output, not a model reply
- `docs/` — architecture, setup, legal gate, source register

## Boundaries that stay closed

- No nationality list is used to decide a route. The applicant uses [Check if you need a UK visa](https://www.gov.uk/check-uk-visa).
- Reply-To and HTML are not trusted. The draft recipient is the DMARC-aligned header From, and even then the draft is not sent.
- Auto-reply is `off`. Approving an outbox item marks it `approved_not_sent`.
- Form filling is not treated as a blanket exemption. There is no claimed AI or overseas exemption.
- DeepSeek’s consumer privacy policy (10 February 2026) says the services are not meant for sensitive data, and it names citizenship and immigration status. API-specific retention and training terms were not verified as a zero-retention promise. See [docs/SOURCE-REGISTER.md](docs/SOURCE-REGISTER.md).
