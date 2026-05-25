function analyzeRisk(simulation) {

  const alerts = [];

  if (simulation.riskScore >= 80) {
    alerts.push(
      "Riesgo estratégico elevado."
    );
  }

  if (simulation.viabilityScore <= 60) {
    alerts.push(
      "Viabilidad inicial reducida."
    );
  }

  if (simulation.scalabilityScore <= 60) {
    alerts.push(
      "Escalabilidad limitada."
    );
  }

  return {
    agent: "Risk Agent",
    focus: "riesgos y sostenibilidad",
    alerts
  };
}

module.exports = analyzeRisk;