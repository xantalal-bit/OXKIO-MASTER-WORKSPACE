'use strict';

function getAgendaPriority(agenda) {
  if (!agenda) {
    return null;
  }

  if (typeof agenda.summary === 'string' && agenda.summary) {
    return agenda.summary;
  }

  if (Array.isArray(agenda.items) && agenda.items.length > 0) {
    return `Revisar agenda: ${agenda.items.length} elementos pendientes.`;
  }

  if (Array.isArray(agenda.events) && agenda.events.length > 0) {
    return `Revisar agenda: ${agenda.events.length} eventos pendientes.`;
  }

  return null;
}

function buildMorningBriefing(dashboardState) {
  const state = dashboardState || {};
  const executiveBriefing = state.executiveBriefing || {};
  const executiveResponse = executiveBriefing.executiveResponse || {};
  const executivePlan = executiveBriefing.executivePlan || {};
  const knowledgeInventory = state.knowledgeInventory || {};
  const recommendation = knowledgeInventory.recommendation || {};
  const priorities = [];
  const agendaPriority = getAgendaPriority(state.agenda);

  if (agendaPriority) {
    priorities.push(agendaPriority);
  }

  if (executivePlan.currentStep) {
    priorities.push(executivePlan.currentStep);
  }

  if (recommendation.message) {
    priorities.push(recommendation.message);
  }

  return {
    generatedAt: new Date().toISOString(),
    title: 'Buenos días, José Antonio',
    summary: executiveResponse.message || '',
    priorities,
    recommendations: executiveResponse.recommendations || [],
  };
}

module.exports = {
  buildMorningBriefing,
};
