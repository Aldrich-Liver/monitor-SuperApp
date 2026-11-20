import { slackChannel } from "@grok/agent-sdk/channels/slack";
import { onReviewerMention } from "../../../../src/mentions.js";
import { mentionHandler } from "../../../lib/mention.js";

export default slackChannel({
  envPrefix: "REVISOR",
  policy: { blockExternals: false },
  engagement: { mentions: true, directMessages: false },
  onAppMention: mentionHandler("REVISOR", onReviewerMention),
});
