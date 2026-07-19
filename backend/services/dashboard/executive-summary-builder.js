function hasAgendaEvents(agenda) {
  const events = agenda && Array.isArray(agenda.events) ? agenda.events : [];

  return Boolean(
    agenda
    && agenda.source === "calendar"
    && agenda.available === true
    && events.length > 0
  );
}

function hasPendingGmail(gmail) {
  if (!gmail || gmail.available !== true || gmail.source !== "gmail") return false;
  const inbox = gmail.inbox || gmail;

  return Number(inbox.unread || 0) > 0
    || Number(inbox.priority || inbox.important || 0) > 0
    || Number(inbox.requiresReview || 0) > 0;
}

function getAutomationAlerts(automations) {
  const alerts = [];
  if (
    automations
    && automations.available === true
    && automations.source === "approval-queue"
    && Number(automations.failed || 0) > 0
  ) {
    alerts.push("Hay compromisos con ejecución fallida.");
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
      : null,
    recommendation: hasGmail
      ? "Revisar correo."
      : null,
    alerts
  };
}

module.exports = {
  buildExecutiveSummary
};
