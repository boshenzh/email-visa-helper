import { loadConfig } from "./config.ts";
import { createServer } from "./http.ts";
import { blockedSend } from "./inbound.ts";
import { Store } from "./store.ts";

const config = loadConfig();
const store = new Store(config);
store.init();
const server = createServer({ config, store });
server.listen(config.port, config.host, () => {
  console.log(JSON.stringify({ event: "listening", host: config.host, port: config.port, mode: config.mode, autoReply: config.autoReply }));
});

// Referenced so a later edit cannot treat the send blocker as dead code without a type error.
void blockedSend;
