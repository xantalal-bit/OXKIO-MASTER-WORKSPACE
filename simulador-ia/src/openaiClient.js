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
            content: `
Actúas como un CEO estratégico experto en startups, SaaS, negocios IA,
escalabilidad, inversión, automatización y crecimiento empresarial.

Responde de forma ejecutiva, breve, clara y profesional.

Debes devolver SIEMPRE exactamente este formato:

OPORTUNIDAD:
(texto breve)

RIESGO:
(texto breve)

RECOMENDACION:
(texto breve)

No añadas títulos adicionales.
No añadas introducciones.
No añadas conclusiones.
`
          },

          {
            role: "user",
            content: `
Proyecto: ${simulation.project}

Viabilidad: ${simulation.viabilityScore}/100
Riesgo: ${simulation.riskScore}/100
Escalabilidad: ${simulation.scalabilityScore}/100

Prompt usuario:
${prompt}
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

async function generateExecutiveDecision(projectA, projectB, globalWinner) {
  try {
    const completion =
      await client.chat.completions.create({
        model: "gpt-4.1-mini",

        messages: [
          {
            role: "system",
            content: `
Actúas como un comité ejecutivo experto en estrategia empresarial.

Debes explicar decisiones de forma clara, breve y profesional.

Formato obligatorio:

DECISION:
(texto)

MOTIVOS:
- motivo 1
- motivo 2
- motivo 3

CONDICION:
(texto)

SIGUIENTE PASO:
(texto)
`
          },

          {
            role: "user",
            content: `
Proyecto A:
Tipo: ${projectA.project}
Viabilidad: ${projectA.viabilityScore}
Riesgo: ${projectA.riskScore}
Escalabilidad: ${projectA.scalabilityScore}

Proyecto B:
Tipo: ${projectB.project}
Viabilidad: ${projectB.viabilityScore}
Riesgo: ${projectB.riskScore}
Escalabilidad: ${projectB.scalabilityScore}

Ganador calculado:
${globalWinner}

Explica la decisión ejecutiva.
`
          }
        ],

        temperature: 0.6,
        max_tokens: 280
      });

    return completion
      .choices[0]
      .message
      .content;

  } catch (error) {
    console.error(
      "OPENAI DECISION ERROR:",
      error.message
    );

    return "No se pudo generar decisión ejecutiva IA.";
  }
}

module.exports = {
  generateCEOAnalysis,
  generateExecutiveDecision
};