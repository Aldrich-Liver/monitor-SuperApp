import { defineAgent } from "@grok/agent-sdk";

export default defineAgent({
  name: "Corrector de fallas",
  description: "Recibe al instante las menciones a @Corrector de fallas en #team-mobile y activa a el Corrector por webhook.",
  tools: [],
  hosting: {
    egressDomains: ["api2.cursor.sh"],
    secretNames: ["FIXER_WEBHOOK_URL", "FIXER_WEBHOOK_KEY"],
  },
});
