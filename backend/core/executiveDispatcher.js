// OXKIO EXECUTIVE DISPATCHER V1

class ExecutiveDispatcher {
  constructor() {
    this.defaultAgent = "GeneralAssistant";
  }

  selectAgent(analysis, executiveContext) {
    const safeAnalysis = analysis || {};
    const safeContext = executiveContext || {};
    const intent = String(safeAnalysis.intent || "").toLowerCase();
    const currentPriority = safeContext.currentPriority || {};
    const currentPriorityProduct = String(currentPriority.product || "").toLowerCase();

    if (currentPriorityProduct.includes("business hunter") && intent === "business") {
      return this.explainSelection(
        "BusinessHunterAgent",
        "La prioridad oficial actual apunta a Business Hunter y la intención es business.",
        0.9
      );
    }

    if (intent === "email") {
      return this.explainSelection("EmailAgent", "La intención detectada es email.", 0.9);
    }

    if (intent === "meeting") {
      return this.explainSelection("CalendarAgent", "La intención detectada es meeting.", 0.9);
    }

    if (intent === "task") {
      return this.explainSelection("TaskAgent", "La intención detectada es task.", 0.85);
    }

    if (intent === "document") {
      return this.explainSelection("DocumentAgent", "La intención detectada es document.", 0.85);
    }

    if (intent === "status") {
      return this.explainSelection("ExecutiveSupervisor", "La intención detectada es status.", 0.9);
    }

    if (intent === "knowledge") {
      return this.explainSelection("KnowledgeCurator", "La intención detectada es knowledge.", 0.85);
    }

    return this.explainSelection(
      this.defaultAgent,
      "No existe una regla específica para la intención detectada.",
      0.5
    );
  }

  explainSelection(agent, reason, confidence) {
    return {
      agent,
      reason,
      confidence
    };
  }
}

module.exports = ExecutiveDispatcher;

// Pruebas manuales:
// node --check backend/core/executiveDispatcher.js
// node -e "const ExecutiveDispatcher = require('./backend/core/executiveDispatcher'); const dispatcher = new ExecutiveDispatcher(); console.log(dispatcher.selectAgent({ intent: 'email' }, {}));"
// node -e "const ExecutiveDispatcher = require('./backend/core/executiveDispatcher'); const dispatcher = new ExecutiveDispatcher(); console.log(dispatcher.selectAgent({ intent: 'business' }, { currentPriority: { product: 'Business Hunter' } }));"
