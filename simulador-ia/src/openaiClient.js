require("dotenv").config();

const OpenAI = require("openai");

const {
  getExecutiveMemorySummary
} = require("./executiveMemory");

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
Actúas como CEO Advisor experto en estrategia empresarial.

Responde de forma ejecutiva, breve, clara y profesional.

Formato recomendado:

OPORTUNIDAD:
(texto)

RIESGO:
(texto)

RECOMENDACION:
(texto)
`
          },

          {
            role: "user",
            content: `
Petición del usuario:
${prompt}

Datos de simulación:
Proyecto: ${simulation.project}
Viabilidad: ${simulation.viabilityScore}
Riesgo: ${simulation.riskScore}
Escalabilidad: ${simulation.scalabilityScore}
Dificultad: ${simulation.difficulty}

Genera análisis ejecutivo.
`
          }
        ],

        temperature: 0.5,
        max_tokens: 260
      });

    return completion
      .choices[0]
      .message
      .content;

  } catch (error) {
    console.error(
      "OPENAI CEO ERROR:",
      error.message
    );

    return "No se pudo generar análisis IA.";
  }
}

async function generateExecutiveDecision(projectA, projectB, globalWinner) {
  try {
    const memorySummary =
      getExecutiveMemorySummary();

    const memoryContext = `
MEMORIA EJECUTIVA ACTUAL:
Objetivo principal: ${memorySummary.latestGoal ? memorySummary.latestGoal.text : "No definido"}
Última decisión: ${memorySummary.latestDecision ? memorySummary.latestDecision.text : "No definida"}
Prioridad principal: ${memorySummary.latestPriority ? memorySummary.latestPriority.text : "No definida"}
Proyecto relevante: ${memorySummary.latestProject ? memorySummary.latestProject.text : "No definido"}
`;

    const completion =
      await client.chat.completions.create({
        model: "gpt-4.1-mini",

        messages: [
          {
            role: "system",
            content: `
Actúas como un comité ejecutivo experto en estrategia empresarial.

Debes explicar decisiones de forma clara, breve y profesional.

Debes tener en cuenta la memoria ejecutiva disponible cuando exista.

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

${memoryContext}

Explica la decisión ejecutiva teniendo en cuenta la memoria ejecutiva si aporta contexto relevante.
`
          }
        ],

        temperature: 0.6,
        max_tokens: 340
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
