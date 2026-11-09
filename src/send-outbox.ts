import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type AppConfig } from "./config.ts";
import { configuredTransport, sendStoredDraft } from "./mail.ts";
import { Store } from "./store.ts";

/** Sends one stored outbox row. There is no recipient argument. */
export async function main(argv: string[]): Promise<number> {
  if (argv.length !== 1 || !/^[a-f0-9]{32}$/.test(argv[0] ?? "")) {
    console.error("usage: node --experimental-strip-types src/send-outbox.ts <outbox-id>");
    return 1;
  }
  const outboxId = argv[0] ?? "";
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "config refused");
    return 1;
  }
  const store = new Store(config);
  store.init();
  try {
    const draft = await sendStoredDraft(store, config, configuredTransport(config, fetch), outboxId);
    console.log(JSON.stringify({ id: draft.id, status: draft.status, providerMessageId: draft.providerMessageId }));
    return draft.status === "sent" ? 0 : 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "send refused");
    return 1;
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}
