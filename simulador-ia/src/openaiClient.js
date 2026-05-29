require("dotenv").config();

const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function generateCEOAnalysis(prompt, simulation) {

  try {

    const completion =
      await client.chat.completions.create({

        model: "gpt-4.1-mini",

        messages: [

          {
            role: "system",
            content:
              `
              Actúas como un CEO estratégico experto en:
              startups,
              SaaS,
              negocios IA,
              escalabilidad,
              inversión,
              automatización
              y crecimiento empresarial.

              Responde de forma ejecutiva,
              breve,
              clara
              y profesional.
              `
          },

          {
            role: "user",
            content:
              `
              Proyecto: ${simulation.project}

              Viabilidad:
              ${simulation.viabilityScore}/100

              Riesgo:
              ${simulation.riskScore}/100

              Escalabilidad:
              ${simulation.scalabilityScore}/100

              Prompt usuario:
              ${prompt}

              Dame:
              - análisis ejecutivo
              - riesgos
              - oportunidad
              - recomendación estratégica
              `
          }

        ],

        temperature: 0.7,
        max_tokens: 250

      });

    return completion
      .choices[0]
      .message
      .content;

  } catch (error) {

    console.error(
  "OPENAI ERROR:",
  error.message
);

    return "No se pudo generar análisis IA.";
  }
}

module.exports = {
  generateCEOAnalysis
};