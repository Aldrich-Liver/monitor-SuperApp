import { defineAgent } from "@grok/agent-sdk";

export default defineAgent({
  name: "agentes-team-mobile",
  description: "Recibe al instante las menciones a los bots de #team-mobile y activa la automatización que corresponde.",
  tools: [],
  hosting: {
    egressDomains: ["api.cursor.com"],
    secretNames: [
      "REVISOR_SLACK_BOT_TOKEN",
      "REVISOR_SLACK_APP_TOKEN",
      "CORRECTOR_SLACK_BOT_TOKEN",
      "CORRECTOR_SLACK_APP_TOKEN",
      "PRUEBAS_SLACK_BOT_TOKEN",
      "PRUEBAS_SLACK_APP_TOKEN",
      "REVIEWER_WEBHOOK_URL",
      "REVIEWER_WEBHOOK_KEY",
      "FIXER_WEBHOOK_URL",
      "FIXER_WEBHOOK_KEY",
      "TESTER_WEBHOOK_URL",
      "TESTER_WEBHOOK_KEY",
    ],
  },
});
