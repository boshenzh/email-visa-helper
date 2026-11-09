import fs from "node:fs";
import { renderWorksheet } from "./artifacts.ts";
import { loadSnapshots } from "./knowledge.ts";
import { loadConfig } from "./config.ts";
import type { CaseRecord, VaultFacts } from "./types.ts";

const input = process.env.SANDBOX_IN ?? "/in/worksheet.json";
const output = process.env.SANDBOX_OUT ?? "/out/worksheet.md";
if (input !== "/in/worksheet.json" || output !== "/out/worksheet.md") {
  console.error("sandbox paths are fixed");
  process.exit(1);
}
const parsed = JSON.parse(fs.readFileSync(input, "utf8")) as { facts: VaultFacts; record: CaseRecord };
const snapshots = loadSnapshots(loadConfig({}));
fs.writeFileSync(output, renderWorksheet(parsed.facts, parsed.record, snapshots), { mode: 0o600 });
