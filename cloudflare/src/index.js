import { handleEmail } from "./ingress.js";

/**
 * Cloudflare Email Routing adapter. It does not send mail.
 * message.reply() and the send_email binding are not used.
 * Auto-reply stays off. See docs/DEPLOY.md.
 */
export default {
  async email(message, env, _ctx) {
    await handleEmail(message, env, fetch);
  },
};

export { handleEmail };
