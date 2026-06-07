function buildTimelineSummary(queue) {
  if (
    !queue ||
    !queue.actions ||
    !queue.actions.length
  ) {
    return [];
  }

  return queue.actions
    .slice(0, 5)
    .map(action => ({
      id: action.id,
      title: action.title,
      status: action.status,
      priority: action.priority,
      createdAt: action.createdAt,
      approvedAt: action.approvedAt || null,
      rejectedAt: action.rejectedAt || null
    }));
}

function buildTopPriorities(dashboard) {
  return [
    {
      order: 1,
      title: "Foco estratégico",
      value: dashboard.strategicFocus || null
    },
    {
      order: 2,
      title: "Patrón dominante",
      value: dashboard.dominantPattern || null
    },
    {
      order: 3,
      title: "Siguiente acción",
      value:
        dashboard.advisor && dashboard.advisor.nextStep
          ? dashboard.advisor.nextStep
          : null
    }
  ];
}

function buildExecutiveExportPackage(dashboard) {
  const queue =
    dashboard.queue || null;

  return {
    generatedAt: new Date().toISOString(),
    packageStatus: "Executive Export Package v2 activo",

    source: "Simulador IA Executive",
    target: "Oxkio Core",

    strategicFocus:
      dashboard.strategicFocus || null,

    dominantPattern:
      dashboard.dominantPattern || null,

    confidence:
      dashboard.confidence || null,

    executiveRecommendation:
      dashboard.executiveRecommendation || null,

    recommendedAction:
      dashboard.advisor
        ? dashboard.advisor.recommendedAction
        : null,

    nextStep:
      dashboard.advisor
        ? dashboard.advisor.nextStep
        : null,

    healthStatus:
      dashboard.executiveHealth || null,

    consistency:
      dashboard.consistency
        ? {
            status: dashboard.consistency.overallStatus,
            totalContradictions:
              dashboard.consistency.totalContradictions
          }
        : null,

    queueSummary:
      queue
        ? {
            totalActions: queue.totalActions,
            pendingActions: queue.pendingActions,
            approvedActions: queue.approvedActions,
            rejectedActions: queue.rejectedActions
          }
        : null,

    topPriorities:
      buildTopPriorities(dashboard),

    timelineSummary:
      buildTimelineSummary(queue),

    approvalReady:
      queue &&
      queue.approvedActions > 0
  };
}

module.exports = buildExecutiveExportPackage;