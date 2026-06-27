const SupervisorAgent = require("../agents/executive/supervisorAgent");
const ExecutiveDispatcher = require("./executiveDispatcher");
const knowledgeCurator = require("../knowledge/knowledgeCurator");

class ExecutiveBrain {

   constructor(memory, intentAnalyzer, ruleEngine) {
        this.memory = memory;
        this.intentAnalyzer = intentAnalyzer;
        this.ruleEngine = ruleEngine;
        this.supervisor = new SupervisorAgent({
            getAll: () => [],
            getStatus: () => []
        });
        this.dispatcher = new ExecutiveDispatcher();
        this.knowledgeCurator = knowledgeCurator;
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

        const strategicMemory = this.supervisor.searchStrategicMemory(message);

        const knowledge = this.knowledgeCurator.searchKnowledge(message);

const executiveContext = this.getExecutiveContext();

let selectedAgent;

try {
    selectedAgent = this.dispatcher.selectAgent(analysis, executiveContext);
} catch (error) {
    selectedAgent = {
        agent: "GeneralAssistant",
        reason: "Error al seleccionar agente.",
        confidence: 0
    };
}

const decision = this.buildDecision(
    message,
    analysis,
    relatedMemory,
    matchedRules,
    strategicMemory,
    knowledge,
    executiveContext,
    selectedAgent
);

const policyValidation = this.supervisor.validateDecision({
    type: analysis.intent,
    recommendation: decision.recommendation,
    selectedAgent
});

if (policyValidation.approved === false) {
    decision.riskLevel = "medium";
    decision.recommendation += ` Política aplicada: ${policyValidation.violatedPolicy}. ${policyValidation.recommendation}`;
}

       return {
    message,
    analysis,
    relatedMemory,
    matchedRules,
    strategicMemory,
    knowledge,
    policyValidation,
    executiveContext,
    selectedAgent,
    decision,
    status: "EXECUTIVE_BRAIN_OK"
};
    }

   buildDecision(
        message,
        analysis,
        relatedMemory,
        matchedRules = [],
        strategicMemory = [],
        knowledge = [],
        executiveContext = null,
        selectedAgent = null
    ) {
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

        if (analysis.intent === "learn_project") {
            nextAction = "learn_project";
            recommendation = "Preparar aprendizaje supervisado del proyecto.";
            requiresApproval = true;
            riskLevel = "medium";
        }

        if (relatedMemory.length > 0) {
            recommendation += " Se ha encontrado memoria relacionada.";
        }
        if (strategicMemory.length > 0) {
            recommendation += " Se encontraron decisiones estratégicas relacionadas.";
        }
        if (knowledge.length > 0) {
            recommendation += " Se encontró conocimiento relacionado.";
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

        if (selectedAgent && selectedAgent.agent) {
            recommendation += ` Agente recomendado: ${selectedAgent.agent}.`;
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
