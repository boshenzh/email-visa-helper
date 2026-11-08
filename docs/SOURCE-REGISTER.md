# Source register

Access date for the rows marked “fetched this session”: **2026-11-08, Asia/Shanghai**. Figures are snapshots. Re-fetch before quoting them to an applicant or taking a payment.

## Fetched and used by the program

| Topic | What was checked | URL |
| --- | --- | --- |
| Standard Visitor overview | Usual stay up to 6 months. Permitted activities are limited. Work, public funds, and marriage notice are outside the ordinary permission described there. Fee line on the apply page is the authority for £135 together with the fee table. | https://www.gov.uk/standard-visitor |
| Apply | £135 up to 6 months. Long-term £506 / £903 / £1,128. Medical and academic £234. Earliest application 3 months before travel. Each person applies and pays separately. Decision usually within 3 weeks after identity and documents. Passport returned the same day. Successful applicants get an eVisa. | https://www.gov.uk/standard-visitor/apply-standard-visitor-visa |
| Fee table | Updated 10 September 2026. Fee from 8 April 2026: visit short £135, 2/5/10 year £506/£903/£1,128, ETA £20, landside transit £74.50, airside transit £41.50. The 2-year row has a footnote about a £135 fee for a Chinese national applying in mainland China under the Chinese visa scheme. The demo does not apply that footnote to a person. | https://www.gov.uk/government/publications/visa-regulations-revised-table/home-office-immigration-and-nationality-fees-8-april-2026 |
| Supporting documents | Updated 8 October 2026. No universal minimum balance and no universal six-month statement in the text read. Access to funds and origin of funds are discussed. Hotel bookings and non-transit flights are on the less-useful list. Translation requirements are a full independent translation with confirmation, date, name, signature, and contact details. | https://www.gov.uk/government/publications/visitor-visa-guide-to-supporting-documents/guide-to-supporting-documents-visiting-the-uk |
| Processing times | Updated 9 September 2026. Standard Visitor, Marriage Visitor, and Transit: 3 weeks. Partner, parent, child, and adult relative outside the UK: 12 weeks. Processing starts at identity or the VAC appointment. If a passport was left at a VAC, the page says not to return until contacted. Do not book travel until there is a decision. | https://www.gov.uk/visa-processing-times |
| ETA | £20, including children. Usually within a day, allow 3 working days. Two years or until the passport expires. Not a visa and not guaranteed entry. British or Irish passports are examples of documents that do not need one, not a complete list. | https://www.gov.uk/eta and https://www.gov.uk/eta/apply |
| Transit | Airside Direct Airside Transit versus landside Visitor in Transit, normally leaving within 48 hours. A longer stay is generally a Standard Visitor question. Exemptions depend on circumstances. The airline can say whether border control is involved. | https://www.gov.uk/transit-visa |
| Appendix V | V 4.2 genuine-visitor requirements and V 4.3 third-party support, as published. The program does not apply them to a person. | https://www.gov.uk/guidance/immigration-rules/immigration-rules-appendix-v-visitor |
| Visa national list | The appendix exists and has exceptions, including Hong Kong and Macao SAR passports and a limited Taiwan passport case. It is **not** copied into prompts and is **not** used to decide visa versus ETA. | https://www.gov.uk/guidance/immigration-rules/immigration-rules-appendix-visitor-visa-national-list |
| Checker | Landing page only. No individual result was produced. | https://www.gov.uk/check-uk-visa |
| Adviser finder | Signpost only. | https://www.gov.uk/find-an-immigration-adviser |
| Caseworker guidance | Qualified person required for advice or services in the course of a UK business. IAA, approved regulators, or supervision. Unqualified provision is described as an offence. | https://www.gov.uk/government/publications/working-with-immigration-advisers-caseworker-guidance/working-with-immigration-advisers-caseworker-guidance-accessible |

The apply page and the processing page do not say the same thing about whether a VAC keeps a passport. The code tells the applicant to follow their own UKVI or VAC message and refuses to ask for a passport to be posted here.

## DeepSeek, fetched this session

| Topic | What was checked |
| --- | --- |
| Tool calls | https://api-docs.deepseek.com/guides/tool_calls — the application executes tools. Non-thinking sample sends `thinking: { type: "disabled" }`. Strict mode is beta, on `https://api.deepseek.com/beta`, and is not used. |
| Chat Completions | Model enum documented as `deepseek-flash` and `deepseek-v4-pro`. If `thinking` is omitted, thinking is enabled. `reasoning_content` is a thinking-mode field. |
| Pricing page | Same two model ids. `deepseek-flash` is served by DeepSeek-V4.1-Flash-1017. Legacy names are still accepted by DeepSeek and are rejected by this demo. Peak cache-miss prices are stored only as a local cost ceiling. |
| Privacy policy | Last update 10 February 2026. The services are not intended for sensitive personal data. The examples include citizenship, immigration status, biometrics, health, and children’s data. The policy says it does not cover end users of a developer’s downstream app. https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html |
| Open Platform terms | Effective 29 April 2026. Section 8.1 requires disclosure that output is AI-generated and says professional output is not professional advice or a basis for action. Sections 3.3 and 5.5 put end-user notice and a lawful basis on the developer. No API zero-retention or no-training promise was found in the text read. https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html |

A September 2026 DeepSeek news post said `deepseek-v4-pro` requests would be routed to V4.1 Flash until a later Pro release. The English pricing page still lists both models. Availability on this account was **not** tested.

## Not re-read as a full primary text this session

- IAA Immigration Assistance practice note, August 2025 (PDF). The regulatory note in `knowledge/uk/` follows the project research brief and the caseworker guidance page that was fetched.
- IAA Code of Standards 2024 (full PDF). Six-year client-file retention is not implemented and is not promised.
- ICO minimisation, special-category, and transfer pages. The research brief records fetch failures. They are not cited as if they were re-read.
- Student, Skilled Worker, family, and marriage route pages beyond the signpost URLs. Those routes are not implemented.
- Administrative review and appeal guidance, beyond the decision to send refusal wording to an adviser and not to invent a deadline.

## OpenAI architecture

https://developers.openai.com/api/docs/guides/agents-api/architecture describes OpenAI’s hosted harness and optional environments. Those session APIs are not DeepSeek APIs. The demo keeps the portable loop only: the application executes tools, stores state, and does not expose chain-of-thought.
