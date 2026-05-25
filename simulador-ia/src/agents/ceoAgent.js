function analyzeAsCEO(simulation) {

  const recommendations = [];

  if (simulation.viabilityScore >= 80) {
    recommendations.push(
      "Priorizar validación comercial rápida."
    );
  }

  if (simulation.riskScore >= 80) {
    recommendations.push(
      "Reducir riesgo antes de escalar inversión."
    );
  }

  if (simulation.scalabilityScore >= 85) {
    recommendations.push(
      "Diseñar modelo escalable desde el inicio."
    );
  }

  return {
    agent: "CEO Agent",
    focus: "visión estratégica y toma de decisiones",
    recommendations
  };
}

module.exports = analyzeAsCEO;