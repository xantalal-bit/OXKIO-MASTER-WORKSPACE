function buildExecutiveAction(dashboard) {
  const confidence =
    dashboard.confidence || "Sin datos suficientes";

  const dominantPattern =
    dashboard.dominantPattern || "Sin patrón dominante";

  const strategicFocus =
    dashboard.strategicFocus || "Sin foco estratégico definido";

  const frequency =
    dashboard.frequency || 0;

  let priority = "Media";
  let horizon = "30 días";
  let recommendedAction =
    "Revisar la memoria ejecutiva y registrar nuevas prioridades.";
  let justification =
    "Aún no hay suficientes patrones consolidados para recomendar una acción estratégica fuerte.";
  let riskOfNotActing =
    "Pérdida de claridad estratégica y decisiones poco consistentes.";
  let successIndicator =
    "Mayor número de objetivos, decisiones y prioridades registradas.";

  if (confidence === "Alta") {
    priority = "Alta";
    horizon = "15 días";
    recommendedAction =
      `Consolidar el foco estratégico "${strategicFocus}" antes de iniciar nuevas expansiones.`;
    justification =
      `El patrón dominante "${dominantPattern}" aparece con confianza alta y frecuencia ${frequency}.`;
    riskOfNotActing =
      "Dispersión del desarrollo, pérdida de foco y retraso en la consolidación del núcleo principal.";
    successIndicator =
      "Núcleo estratégico validado, decisiones alineadas y prioridades estables.";
  }

  if (confidence === "Media") {
    priority = "Media";
    horizon = "15-30 días";
    recommendedAction =
      `Validar manualmente el patrón "${dominantPattern}" antes de convertirlo en plan operativo.`;
    justification =
      `El patrón aparece con confianza media y necesita más datos antes de ejecutar una acción fuerte.`;
    riskOfNotActing =
      "Tomar decisiones prematuras o basadas en señales todavía incompletas.";
    successIndicator =
      "Mayor repetición del patrón o confirmación manual del criterio estratégico.";
  }

  if (confidence === "Baja") {
    priority = "Baja";
    horizon = "30-60 días";
    recommendedAction =
      "Registrar más decisiones, objetivos y prioridades antes de ejecutar acciones.";
    justification =
      "La señal estratégica todavía es débil.";
    riskOfNotActing =
      "Baja calidad del aprendizaje ejecutivo por falta de información suficiente.";
    successIndicator =
      "Memoria ejecutiva con más datos reales y patrones mejor definidos.";
  }

  return {
    generatedAt: new Date().toISOString(),
    advisorStatus: "Executive Advisor Autónomo v2 activo",
    recommendedAction,
    priority,
    horizon,
    justification,
    riskOfNotActing,
    successIndicator,
    confidence,
    frequency,
    strategicFocus,
    dominantPattern,
    nextStep:
      "Convertir esta recomendación en una tarea ejecutiva supervisada."
  };
}

module.exports = buildExecutiveAction;