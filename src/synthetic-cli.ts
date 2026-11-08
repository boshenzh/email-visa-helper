import { loadConfig } from "./config.ts";
import { runPublicTopicLoop } from "./deepseek.ts";
import { loadSnapshots, OFFICIAL_TOPICS, type OfficialTopic } from "./knowledge.ts";

const topic = process.argv[2] ?? "";
let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : "config refused");
  process.exit(1);
}
if (config.profile !== "synthetic_test") {
  console.error("synthetic_test profile required");
  process.exit(1);
}
if (!OFFICIAL_TOPICS.includes(topic as OfficialTopic)) {
  console.error(`topic must be one of: ${OFFICIAL_TOPICS.join(", ")}`);
  process.exit(1);
}
if (!config.deepseekApiKey) {
  console.error("DEEPSEEK_API_KEY is not in this process. Do not paste it into chat or source.");
  process.exit(2);
}
const loop = await runPublicTopicLoop({
  topic: topic as OfficialTopic,
  config,
  apiKey: config.deepseekApiKey,
  transport: fetch,
  snapshots: loadSnapshots(config),
});
if (!loop.explanation) {
  console.error(JSON.stringify({ stopped: loop.stopped, reason: loop.reason, modelRequests: loop.requests.length }));
  process.exit(3);
}
console.log(loop.explanation);
