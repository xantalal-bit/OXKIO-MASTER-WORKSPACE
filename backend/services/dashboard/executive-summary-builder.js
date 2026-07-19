function hasAgendaEvents(agenda) {
  const events = agenda && Array.isArray(agenda.events) ? agenda.events : [];

  return Boolean(agenda && agenda.nextEvent) || events.length > 0;
}

function hasPendingGmail(gmail) {
  const inbox = gmail && gmail.inbox ? gmail.inbox : gmail || {};

  return Number(inbox.unread || 0) > 0
    || Number(inbox.priority || inbox.important || 0) > 0
    || Number(inbox.requiresReview || 0) > 0;
}

function getAutomationAlerts(automations) {
  const alerts = [];
  const active = automations && Array.isArray(automations.active)
    ? automations.active
    : [];
  const pendingApproval = Number((automations && automations.pendingApproval) || 0);
  const incidents = active.filter((automation) => {
    const status = String((automation && automation.status) || "").toLowerCase();
    return ["incident", "error", "failed", "blocked"].includes(status);
  });

  if (incidents.length > 0) {
    alerts.push("Hay incidencias en automatizaciones activas.");
  }

  if (pendingApproval > 0) {
    alerts.push("Hay automatizaciones pendientes de aprobacion.");
  }

  return alerts;
}

function buildExecutiveSummary(dashboardState) {
  const state = dashboardState || {};
  const alerts = getAutomationAlerts(state.automations);
  const hasAgenda = hasAgendaEvents(state.agenda);
  const hasGmail = hasPendingGmail(state.gmail);

  return {
    priority: hasAgenda
      ? "Revisar agenda."
      : "Mantener seguimiento operativo.",
    recommendation: hasGmail
      ? "Revisar correo."
      : "Continuar con el foco ejecutivo actual.",
    alerts
  };
}

module.exports = {
  buildExecutiveSummary
};
