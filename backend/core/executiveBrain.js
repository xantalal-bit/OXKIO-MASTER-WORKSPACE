const SupervisorAgent = require("../agents/executive/supervisorAgent");

class ExecutiveBrain {

   constructor(memory, intentAnalyzer, ruleEngine) {
        this.memory = memory;
        this.intentAnalyzer = intentAnalyzer;
        this.ruleEngine = ruleEngine;
        this.supervisor = new SupervisorAgent({
            getAll: () => [],
            getStatus: () => []
        });
    }

    getExecutiveContext() {
        try {
            return {
                governanceStatus: this.supervisor.getGovernanceStatus(),
                currentPriority: this.supervisor.getCurrentPriority(),
                currentFocus: this.supervisor.getCurrentFocus(),
                recommendedInitiative: this.supervisor.recommendNextInitiative()
            };
        } catch (error) {
            return {
                governanceStatus: null,
                currentPriority: null,
                currentFocus: [],
                recommendedInitiative: null,
                error: error.message || String(error)
            };
        }
    }

    think(message = "") {

        const analysis = this.intentAnalyzer.analyze(message);

        const relatedMemory = this.memory.searchMemory(message);

        const matchedRules = this.ruleEngine.evaluate({ message, analysis, relatedMemory });

const executiveContext = this.getExecutiveContext();

const decision = this.buildDecision(message, analysis, relatedMemory, matchedRules, executiveContext);

       return {
    message,
    analysis,
    relatedMemory,
    matchedRules,
    executiveContext,
    decision,
    status: "EXECUTIVE_BRAIN_OK"
};
    }

   buildDecision(message, analysis, relatedMemory, matchedRules = [], executiveContext = null) {
        let recommendation = "Responder de forma informativa.";
        let riskLevel = "low";
        let nextAction = "respond";
        let requiresApproval = analysis.requiresApproval;

        if (analysis.urgency === "high") {
            riskLevel = "medium";
            recommendation = "Priorizar esta solicitud y preparar acción supervisada.";
        }

        if (analysis.intent === "meeting") {
            nextAction = "prepare_meeting_proposal";
            recommendation = "Preparar propuesta de reunión con contexto disponible.";
        }

        if (analysis.intent === "email") {
            nextAction = "prepare_email_response";
            recommendation = "Preparar borrador de email para revisión.";
        }

        if (analysis.intent === "task") {
            nextAction = "prepare_task_creation";
            recommendation = "Preparar creación de tarea supervisada.";
        }

        if (analysis.intent === "document") {
            nextAction = "prepare_document_review";
            recommendation = "Preparar revisión del documento o archivo indicado.";
        }

        if (relatedMemory.length > 0) {
            recommendation += " Se ha encontrado memoria relacionada.";
        }
        if (matchedRules.length > 0) {
    riskLevel = "medium";
    recommendation += " Se han aplicado reglas ejecutivas.";
}

        if (executiveContext && executiveContext.currentPriority) {
            recommendation += ` Prioridad oficial actual: ${executiveContext.currentPriority.product}.`;
        }

        if (executiveContext && executiveContext.recommendedInitiative) {
            recommendation += ` Iniciativa recomendada: ${executiveContext.recommendedInitiative.title}.`;
        }

        return {
            recommendation,
            nextAction,
            riskLevel,
            requiresApproval
        };
    }
}

module.exports = ExecutiveBrain;
