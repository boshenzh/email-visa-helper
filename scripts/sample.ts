import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import { handleInbound } from "../src/inbound.ts";
import { Store } from "../src/store.ts";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "visa-sample-"));
const config = loadConfig({}, { dataDir, vaultKey: "sample-only-vault-key", deepseekApiKey: "sample-not-a-live-key" });
const store = new Store(config);
store.init();
const requests: unknown[] = [];
let round = 0;
const modelTransport: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  requests.push(body);
  round += 1;
  if (round === 1) {
    return Response.json({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: "sample-tool-1", type: "function", function: { name: "lookup_official", arguments: "{\"topic\":\"fees\"}" } }],
          },
        },
      ],
      usage: { prompt_tokens: 30, completion_tokens: 12 },
    });
  }
  return Response.json({
    choices: [
      {
        message: {
          content: "The published snapshot lists a Standard Visitor fee of £135 for up to 6 months. This is general information from the official pages, not a decision about any person.",
          tool_calls: [],
        },
      },
    ],
    usage: { prompt_tokens: 80, completion_tokens: 28 },
  });
};
const event = {
  envelopeFrom: "synthetic@example.com",
  envelopeTo: "visa@boshen.dev",
  headerFrom: "Synthetic Person <synthetic@example.com>",
  replyTo: "do-not-use@example.com",
  subject: "Fictional Standard Visitor worksheet",
  messageId: "<sample-1@example.com>",
  inReplyTo: "",
  references: [],
  authenticationResults: "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=example.com",
  autoSubmitted: "no",
  precedence: "",
  extraHeaders: {},
  text: [
    "What is the published Standard Visitor fee?",
    "This is a fictional synthetic case. Please organise my answers.",
    "Nationality: Exampleland",
    "Residence: Example City",
    "Document type: ordinary passport",
    "I am an adult.",
    "Purpose: tourism",
    "Arrival: 2027-06-01",
    "Departure: 2027-06-14",
    "Dependants: none",
    "Previous refusal: no",
    "Criminal record: no",
    "Checker result: visa",
    "Checker date: 2026-11-01",
  ].join("\n"),
  htmlIgnored: true,
  attachments: [],
};
const result = await handleInbound(event, { config, store, modelTransport });
if (!result.caseId || !result.outboxId) throw new Error("sample did not produce a draft");
if (result.modelRequests !== 2) throw new Error(`expected 2 model requests, got ${result.modelRequests}`);
const serialised = JSON.stringify(requests);
if (serialised.includes("Exampleland") || serialised.includes("synthetic@example.com") || serialised.includes("organise my answers")) {
  throw new Error("sample model request included applicant text");
}
const outDir = path.resolve("examples/sample-standard-visitor");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "inbound.json"), JSON.stringify(event, null, 2));
fs.writeFileSync(path.join(outDir, "reply.txt"), result.reply);
fs.writeFileSync(path.join(outDir, "worksheet.md"), store.readArtifact(result.caseId, "worksheet.md"));
fs.writeFileSync(path.join(outDir, "source-ledger.md"), store.readArtifact(result.caseId, "source-ledger.md"));
fs.writeFileSync(path.join(outDir, "outbox.json"), JSON.stringify(store.readOutbox(result.outboxId), null, 2));
fs.writeFileSync(path.join(outDir, "model-requests.json"), JSON.stringify(requests, null, 2) + "\n");
console.log(JSON.stringify({ wrote: outDir, category: result.category, modelRequests: result.modelRequests, delivery: store.readOutbox(result.outboxId)?.status }));
