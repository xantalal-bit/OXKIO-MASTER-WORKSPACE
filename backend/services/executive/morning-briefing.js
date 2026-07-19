'use strict';

const MAX_ITEMS = 5;
const SOURCE_STATUS_UNAVAILABLE = Object.freeze({
  gmail: 'unavailable',
  calendar: 'unavailable',
  approvals: 'unavailable',
  memory: 'unavailable',
  ecosystem: 'unavailable',
});

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function isRealGmail(gmail) {
  return Boolean(gmail && gmail.available === true && gmail.source === 'gmail');
}

function isRealCalendar(agenda) {
  return Boolean(agenda && agenda.available === true && agenda.source === 'calendar');
}

function isRealApprovals(automations) {
  return Boolean(
    automations
    && automations.available === true
    && automations.source === 'approval-queue'
  );
}

function isRealMemory(memory) {
  return Boolean(
    memory
    && memory.source === 'runtime-memory'
    && memory.counters
    && typeof memory.counters === 'object'
  );
}

function getEcosystemStatus(ecosystem) {
  const entries = ecosystem && typeof ecosystem === 'object'
    ? [ecosystem.businessHunter, ecosystem.xose, ecosystem.ecosystem]
    : [];
  const availableEntries = entries.filter((entry) => (
    entry && entry.available === true && entry.source === 'knowledge-inventory'
  ));

  if (availableEntries.length === 0) return 'unavailable';
  if (availableEntries.length !== entries.length) return 'partial';
  if (availableEntries.some((entry) => ['partial', 'unknown'].includes(entry.status))) {
    return 'partial';
  }
  return 'real';
}

function getSourceStatus(state) {
  return {
    gmail: isRealGmail(state.gmail) ? 'real' : 'unavailable',
    calendar: isRealCalendar(state.agenda) ? 'real' : 'unavailable',
    approvals: isRealApprovals(state.automations) ? 'real' : 'unavailable',
    memory: isRealMemory(state.memory) ? 'real' : 'unavailable',
    ecosystem: getEcosystemStatus(state.ecosystem),
  };
}

function buildPriorities(state, sourceStatus) {
  const priorities = [];

  if (sourceStatus.calendar === 'real') {
    const eventCount = Math.min(
      10,
      Array.isArray(state.agenda.events) ? state.agenda.events.length : 0,
    );
    if (eventCount > 0) {
      priorities.push({
        type: 'calendar',
        title: 'Revisar agenda',
        detail: `${eventCount} ${eventCount === 1 ? 'evento próximo' : 'eventos próximos'}.`,
        source: 'calendar',
        confidence: 'high',
      });
    }
  }

  if (sourceStatus.approvals === 'real') {
    const pending = nonNegativeNumber(state.automations.pending);
    const approved = nonNegativeNumber(state.automations.approved);
    if (pending + approved > 0) {
      priorities.push({
        type: 'approval',
        title: 'Revisar compromisos ejecutivos',
        detail: `${pending} pendientes y ${approved} aprobados.`,
        source: 'approval-queue',
        confidence: 'high',
      });
    }
  }

  if (sourceStatus.gmail === 'real') {
    const unread = nonNegativeNumber(state.gmail.unread);
    const important = nonNegativeNumber(state.gmail.important);
    if (unread + important > 0) {
      priorities.push({
        type: 'gmail',
        title: 'Revisar Gmail',
        detail: `${unread} no leídos y ${important} importantes.`,
        source: 'gmail',
        confidence: important > 0 ? 'high' : 'medium',
      });
    }
  }

  if (sourceStatus.memory === 'real') {
    const recent = nonNegativeNumber(state.memory.counters.shortTermItems);
    if (recent > 0) {
      priorities.push({
        type: 'memory',
        title: 'Revisar señales recientes',
        detail: `${recent} registros recientes agregados.`,
        source: 'runtime-memory',
        confidence: 'medium',
      });
    }
  }

  if (sourceStatus.ecosystem !== 'unavailable') {
    const total = nonNegativeNumber(
      state.ecosystem && state.ecosystem.ecosystem && state.ecosystem.ecosystem.items,
    );
    if (total > 0) {
      priorities.push({
        type: 'ecosystem',
        title: 'Mantener seguimiento del ecosistema',
        detail: `${total} elementos útiles agregados.`,
        source: 'knowledge-inventory',
        confidence: sourceStatus.ecosystem === 'real' ? 'medium' : 'low',
      });
    }
  }

  return priorities.slice(0, MAX_ITEMS);
}

function buildAlerts(sourceStatus) {
  const labels = {
    gmail: 'Gmail no está disponible.',
    calendar: 'Calendar no está disponible.',
    approvals: 'Approval Queue no está disponible.',
    memory: 'Memoria no está disponible.',
  };
  const alerts = Object.entries(labels)
    .filter(([source]) => sourceStatus[source] === 'unavailable')
    .map(([source, message]) => ({ type: 'source_unavailable', message, source }));

  if (sourceStatus.ecosystem === 'partial') {
    alerts.push({
      type: 'source_degraded',
      message: 'El ecosistema tiene información parcial.',
      source: 'ecosystem',
    });
  } else if (sourceStatus.ecosystem === 'unavailable') {
    alerts.push({
      type: 'source_unavailable',
      message: 'El ecosistema no está disponible.',
      source: 'ecosystem',
    });
  }

  return alerts.slice(0, MAX_ITEMS);
}

function buildSummary(state, sourceStatus, priorities) {
  const facts = [];
  if (sourceStatus.approvals === 'real') {
    const pending = nonNegativeNumber(state.automations.pending);
    if (pending > 0) facts.push(`${pending} compromisos pendientes`);
  }
  if (sourceStatus.calendar === 'real') {
    const events = Array.isArray(state.agenda.events) ? state.agenda.events.length : 0;
    if (events > 0) {
      const count = Math.min(events, 10);
      facts.push(`${count} ${count === 1 ? 'evento próximo' : 'eventos próximos'}`);
    }
  }
  if (sourceStatus.gmail === 'real') {
    const unread = nonNegativeNumber(state.gmail.unread);
    if (unread > 0) facts.push(`${unread} correos no leídos`);
  }

  const unavailable = Object.values(sourceStatus).filter((status) => status === 'unavailable').length;
  const factualSummary = facts.length > 0
    ? `Hay ${facts.slice(0, 3).join(', ')}.`
    : priorities.length > 0
      ? 'Hay actividad agregada que conviene revisar.'
      : 'No hay prioridades respaldadas por evidencia en este momento.';
  return unavailable > 0
    ? `${factualSummary} ${unavailable} ${unavailable === 1 ? 'fuente no está disponible' : 'fuentes no están disponibles'}.`
    : factualSummary;
}

function safeGeneratedAt(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function unavailableBriefing(generatedAt) {
  return {
    title: 'Resumen ejecutivo del día',
    summary: 'No se pudo generar el resumen ejecutivo.',
    priorities: [],
    alerts: [],
    sourceStatus: { ...SOURCE_STATUS_UNAVAILABLE },
    generatedAt,
    available: false,
  };
}

function buildMorningBriefing(dashboardState, options = {}) {
  const generatedAt = safeGeneratedAt(options.now);
  try {
    if (!dashboardState || typeof dashboardState !== 'object') {
      return unavailableBriefing(generatedAt);
    }
    const sourceStatus = getSourceStatus(dashboardState);
    const priorities = buildPriorities(dashboardState, sourceStatus);
    return {
      title: 'Resumen ejecutivo del día',
      summary: buildSummary(dashboardState, sourceStatus, priorities),
      priorities,
      alerts: buildAlerts(sourceStatus),
      sourceStatus,
      generatedAt,
      available: true,
    };
  } catch (error) {
    return unavailableBriefing(generatedAt);
  }
}

module.exports = {
  MAX_ITEMS,
  buildMorningBriefing,
  getSourceStatus,
};
