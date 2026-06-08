function buildStrategicSuggestions(data) {
  const suggestions = [];

  if (!data) {
    return [
      "No hay datos estratégicos suficientes para generar sugerencias."
    ];
  }

  const riskScore = Number(data.riskScore ?? 0);
  const viabilityScore = Number(data.viabilityScore ?? 0);
  const scalabilityScore = Number(data.scalabilityScore ?? 0);

  if (riskScore >= 75) {
    suggestions.push("Priorizar reducción de riesgo antes de escalar inversión.");
  }

  if (viabilityScore >= 70) {
    suggestions.push("Validar comercialmente la oportunidad con clientes reales.");
  }

  if (scalabilityScore >= 80) {
    suggestions.push("Diseñar procesos escalables desde el inicio.");
  }

  if (suggestions.length === 0) {
    suggestions.push("Revisar indicadores antes de tomar una decisión ejecutiva.");
  }

  return suggestions;
}

window.OxkioStrategicSuggestions = {
  buildStrategicSuggestions
};
