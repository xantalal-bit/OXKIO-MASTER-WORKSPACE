function buildExecutiveExportPackage(dashboard) {
  return {
    generatedAt: new Date().toISOString(),
    packageStatus: "Executive Export Package v1 activo",

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

    queueSummary:
      dashboard.queue
        ? {
            totalActions: dashboard.queue.totalActions,
            pendingActions: dashboard.queue.pendingActions,
            approvedActions: dashboard.queue.approvedActions,
            rejectedActions: dashboard.queue.rejectedActions
          }
        : null,

    approvalReady:
      dashboard.queue &&
      dashboard.queue.approvedActions > 0
  };
}

module.exports = buildExecutiveExportPackage;