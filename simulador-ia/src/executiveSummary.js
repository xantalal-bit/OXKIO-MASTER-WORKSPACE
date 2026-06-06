const generateExecutiveInsights = require("./executiveInsights");

function normalizeText(item) {
  if (typeof item === "string") {
    return item;
  }

  if (item && item.text) {
    return item.text;
  }

  return "";
}

function countRepeatedItems(items) {
  const counter = {};

  items
    .map(normalizeText)
    .filter(Boolean)
    .forEach(text => {
      counter[text] = (counter[text] || 0) + 1;
    });

  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
}

function generateExecutiveSummary(memory) {

  const decisions = memory.decisions || [];
  const priorities = memory.priorities || [];
  const goals = memory.goals || [];
  const projects = memory.projects || [];

  const topDecisions = countRepeatedItems(decisions);
  const topPriorities = countRepeatedItems(priorities);
  const insights = generateExecutiveInsights(memory);

  const latestGoal = goals[0] || null;
  const latestProject = projects[0] || null;

  return {
    generatedAt: new Date().toISOString(),

    executiveStatus: "Memoria Ejecutiva Inteligente v2 activa",

    totals: {
      goals: goals.length,
      decisions: decisions.length,
      priorities: priorities.length,
      projects: projects.length
    },

    strategicSummary:
      priorities.length > 0
        ? `El foco ejecutivo actual se concentra en: ${normalizeText(priorities[0])}.`
        : "Todavía no hay prioridades suficientes para generar un resumen estratégico.",

    executiveInsights: insights,

    topDecisions,
    topPriorities,

    latestGoal,
    latestProject,

    recommendation:
      insights.dominantPattern
        ? `Recomendación ejecutiva: mantener la línea de ${insights.dominantPattern.name.toLowerCase()} con confianza ${insights.dominantPattern.confidence}.`
        : topPriorities.length > 0
          ? `Mantener el foco en la prioridad recurrente: ${topPriorities[0][0]}.`
          : "Registrar más prioridades para mejorar la recomendación ejecutiva."
  };
}

module.exports = generateExecutiveSummary;