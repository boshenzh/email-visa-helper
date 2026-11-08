import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import { handleInbound } from "../src/inbound.ts";
import { Store } from "../src/store.ts";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "visa-sample-"));
const config = loadConfig({}, { dataDir, vaultKey: "sample-only-vault-key" });
const store = new Store(config);
store.init();
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
const result = await handleInbound(event, { config, store });
if (!result.caseId || !result.outboxId) throw new Error("sample did not produce a draft");
const outDir = path.resolve("examples/sample-standard-visitor");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "inbound.json"), JSON.stringify(event, null, 2));
fs.writeFileSync(path.join(outDir, "reply.txt"), result.reply);
fs.writeFileSync(path.join(outDir, "worksheet.md"), store.readArtifact(result.caseId, "worksheet.md"));
fs.writeFileSync(path.join(outDir, "source-ledger.md"), store.readArtifact(result.caseId, "source-ledger.md"));
const outbox = store.readOutbox(result.outboxId);
fs.writeFileSync(path.join(outDir, "outbox.json"), JSON.stringify(outbox, null, 2));
fs.writeFileSync(path.join(outDir, "model-requests.json"), "[]\n");
if (result.modelRequests !== 0) throw new Error("sample called a model");
console.log(JSON.stringify({ wrote: outDir, category: result.category, modelRequests: result.modelRequests }));
