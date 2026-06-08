function analyzeStrategicData(data) {
  if (!data) {
    return {
      status: "no-data",
      level: "Sin datos",
      summary: "No hay datos estratégicos disponibles.",
      priority: "Esperar datos del simulador."
    };
  }

  const riskScore = Number(data.riskScore ?? 0);
  const viabilityScore = Number(data.viabilityScore ?? 0);
  const scalabilityScore = Number(data.scalabilityScore ?? 0);

  let level = "Equilibrado";
  let priority = "Revisar indicadores y validar próximos pasos.";

  if (riskScore >= 75) {
    level = "Riesgo alto";
    priority = "Reducir riesgo antes de escalar.";
  } else if (viabilityScore >= 75 && scalabilityScore >= 80) {
    level = "Oportunidad fuerte";
    priority = "Preparar acción comercial supervisada.";
  } else if (viabilityScore < 50) {
    level = "Viabilidad baja";
    priority = "Revisar propuesta antes de invertir más recursos.";
  }

  return {
    status: "ok",
    level,
    summary: data.strategicFocus || "Análisis estratégico disponible.",
    priority
  };
}

window.OxkioStrategicAnalyzer = {
  analyzeStrategicData
};
