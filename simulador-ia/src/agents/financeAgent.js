function financeAgent(data) {

  const recommendations = [];

  if (data.investment > 50000) {
    recommendations.push(
      "La inversión inicial es elevada. Revisar flujo de caja y retorno esperado."
    );
  }

  if (data.viabilityScore >= 80) {
    recommendations.push(
      "El proyecto presenta buena viabilidad financiera potencial."
    );
  }

  if (data.riskScore > 70) {
    recommendations.push(
      "Se recomienda mantener reservas financieras por alto riesgo."
    );
  }

  if (data.scalabilityScore >= 85) {
    recommendations.push(
      "El modelo puede beneficiarse de crecimiento escalable y economías de escala."
    );
  }

  return {
    agent: "Finance Agent",
    focus: "análisis financiero y sostenibilidad económica",
    recommendations
  };

}

module.exports = financeAgent;