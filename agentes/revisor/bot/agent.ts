import { defineAgent } from "@grok/agent-sdk";

export default defineAgent({
  name: "Revisor de PRs",
  description: "Recibe al instante las menciones a @Revisor de PRs en #team-mobile y activa a el Revisor de PRs por webhook.",
  tools: [],
  hosting: {
    egressDomains: ["api2.cursor.sh"],
    secretNames: ["REVIEWER_WEBHOOK_URL", "REVIEWER_WEBHOOK_KEY"],
  },
});
