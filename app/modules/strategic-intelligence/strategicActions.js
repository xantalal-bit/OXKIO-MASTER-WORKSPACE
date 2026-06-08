function buildStrategicActions(analysis) {
  const actions = [];

  if (!analysis) {
    return ["Esperando análisis estratégico."];
  }

  if (analysis.level === "Riesgo alto") {
    actions.push("Revisar riesgos críticos.");
    actions.push("Solicitar validación humana antes de ejecutar.");
  }

  if (analysis.level === "Oportunidad fuerte") {
    actions.push("Preparar propuesta ejecutiva.");
    actions.push("Programar acción comercial supervisada.");
  }

  if (analysis.level === "Viabilidad baja") {
    actions.push("Revisar hipótesis de negocio.");
  }

  if (actions.length === 0) {
    actions.push("Continuar monitorización estratégica.");
  }

  return actions;
}

window.OxkioStrategicActions = {
  buildStrategicActions
};
