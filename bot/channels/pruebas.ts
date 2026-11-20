import { slackChannel } from "@grok/agent-sdk/channels/slack";
import { onTesterMention } from "../../src/mentions.js";
import { mentionHandler } from "../lib/mention.js";

export default slackChannel({
  envPrefix: "PRUEBAS",
  policy: { blockExternals: false },
  engagement: { mentions: true, directMessages: false },
  onAppMention: mentionHandler("PRUEBAS", onTesterMention),
});
