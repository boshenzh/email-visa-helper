import { loadConfig, type AppConfig } from "./config.ts";
import { createServer } from "./http.ts";
import { configuredTransport, resendDeliveryState } from "./mail.ts";
import { Store } from "./store.ts";

let config: AppConfig;
try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : "config refused");
  process.exit(1);
}
const store = new Store(config);
store.init();
const testLive = config.profile === "synthetic_test" && config.testSenderAllowlist.length > 0;
const modelTransport = testLive && config.mode === "live" && config.deepseekApiKey ? fetch : undefined;
const mailTransport = configuredTransport(config, fetch) ?? undefined;
const server = createServer({ config, store, modelTransport, mailTransport });
server.listen(config.port, config.host, () => {
  console.log(
    JSON.stringify({
      event: "listening",
      host: config.host,
      port: config.port,
      profile: config.profile,
      mode: config.mode,
      autoReply: config.autoReply,
      delivery: config.deliveryMode,
      allowlistCount: config.testSenderAllowlist.length,
      publicTopicModel: modelTransport ? "configured" : "not_configured",
      emailSending: config.autoReply === "general_info" && mailTransport ? "configured" : "off",
      resend: resendDeliveryState(config, Boolean(mailTransport)),
    }),
  );
});
