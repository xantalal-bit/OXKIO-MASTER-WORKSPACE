function buildExecutiveAction(dashboard) {
  const confidence =
    dashboard.confidence || "Sin datos suficientes";

  const dominantPattern =
    dashboard.dominantPattern || "Sin patrón dominante";

  const strategicFocus =
    dashboard.strategicFocus || "Sin foco estratégico definido";

  let priority = "Media";
  let horizon = "30 días";
  let action = "Revisar la memoria ejecutiva y registrar nuevas prioridades.";
  let justification =
    "Aún no hay suficientes patrones consolidados para recomendar una acción estratégica fuerte.";

  if (confidence === "Alta") {
    priority = "Alta";
    horizon = "7-15 días";
    action =
      `Ejecutar una acción concreta alineada con ${dominantPattern.toLowerCase()}.`;
    justification =
      `El sistema detecta el patrón "${dominantPattern}" con confianza alta y foco estratégico en "${strategicFocus}".`;
  }

  if (confidence === "Media") {
    priority = "Media";
    horizon = "15-30 días";
    action =
      `Validar manualmente el patrón "${dominantPattern}" antes de convertirlo en plan operativo.`;
    justification =
      `El patrón "${dominantPattern}" aparece, pero todavía requiere más datos para una decisión automática fuerte.`;
  }

  if (confidence === "Baja") {
    priority = "Baja";
    horizon = "30-60 días";
    action =
      "Registrar más decisiones, objetivos y prioridades antes de actuar.";
    justification =
      "La señal estratégica todavía es débil y no conviene ejecutar acciones automáticas.";
  }

  return {
    generatedAt: new Date().toISOString(),
    advisorStatus: "Executive Advisor Autónomo v1 activo",
    recommendedAction: action,
    justification,
    priority,
    horizon,
    confidence,
    strategicFocus,
    dominantPattern,
    nextStep:
      "Convertir esta recomendación en una tarea ejecutiva supervisada."
  };
}

module.exports = buildExecutiveAction;