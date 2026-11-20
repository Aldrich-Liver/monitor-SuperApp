import { defineAgent } from "@grok/agent-sdk";

export default defineAgent({
  name: "Pruebas de PRs",
  description: "Recibe al instante las menciones a @Pruebas de PRs en #team-mobile y activa a Pruebas de PRs por webhook.",
  tools: [],
  hosting: {
    egressDomains: ["api2.cursor.sh"],
    secretNames: ["TESTER_WEBHOOK_URL", "TESTER_WEBHOOK_KEY"],
  },
});
