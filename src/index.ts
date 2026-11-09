import { loadConfig } from "./config.ts";
import { createServer } from "./http.ts";
import { cloudflareRestTransport } from "./mail.ts";
import { Store } from "./store.ts";

const config = loadConfig();
const store = new Store(config);
store.init();
const testLive = config.profile === "synthetic_test" && config.testSenderAllowlist.length > 0;
const modelTransport = testLive && config.mode === "live" && config.deepseekApiKey ? fetch : undefined;
const mailTransport =
  testLive && config.autoReply === "general_info" && config.deliveryMode === "cloudflare" && config.cloudflareAccountId && config.cloudflareEmailToken
    ? cloudflareRestTransport(config.cloudflareAccountId, config.cloudflareEmailToken, fetch)
    : undefined;
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
      allowlistCount: config.testSenderAllowlist.length,
      publicTopicModel: modelTransport ? "configured" : "not_configured",
      emailSending: mailTransport ? "configured" : "off",
    }),
  );
});
