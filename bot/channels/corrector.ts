import { slackChannel } from "@grok/agent-sdk/channels/slack";
import { onFixerMention } from "../../src/mentions.js";
import { mentionHandler } from "../lib/mention.js";

export default slackChannel({
  envPrefix: "CORRECTOR",
  policy: { blockExternals: false },
  engagement: { mentions: true, directMessages: false },
  onAppMention: mentionHandler("CORRECTOR", onFixerMention),
});
