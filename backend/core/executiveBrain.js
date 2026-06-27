const SupervisorAgent = require("../agents/executive/supervisorAgent");
const ExecutiveDispatcher = require("./executiveDispatcher");
const knowledgeCurator = require("../knowledge/knowledgeCurator");

const KNOWN_PROJECTS = [
    "Business Hunter",
    "OXKIO",
    "Profesor IA",
    "GIU",
    "XANTALALSHOP"
];

function normalizeSearchText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function summarizeHighlight(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim();
}

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
const projectToLearn = analysis.projectToLearn || (
    analysis.intent === "learn_project"
        ? this.detectProjectToLearn(message, executiveContext)
        : null
);
const projectName = projectToLearn || this.detectKnownProject(message);
const projectKnowledge = projectName
    ? this.knowledgeCurator.searchKnowledge(projectName)
    : [];
const projectKnowledgeSummary = projectKnowledge.length > 0
    ? this.buildProjectKnowledgeSummary(projectName, projectKnowledge)
    : null;
const projectResponse = projectKnowledgeSummary
    ? this.buildProjectResponse(projectKnowledgeSummary)
    : null;

let selectedAgent;

try {
    if (analysis.intent === "learn_project") {
        selectedAgent = {
            agent: "ExecutiveSupervisor",
            reason: "El Supervisor coordina el aprendizaje de proyectos.",
            confidence: 0.95
        };
    } else {
        selectedAgent = this.dispatcher.selectAgent(analysis, executiveContext);
    }
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
    projectKnowledge,
    projectKnowledgeSummary,
    projectResponse,
    policyValidation,
    executiveContext,
    projectToLearn,
    selectedAgent,
    decision,
    status: "EXECUTIVE_BRAIN_OK"
};
    }

    detectProjectToLearn(message, executiveContext) {
        return this.detectKnownProject(message);
    }

    detectKnownProject(message) {
        const messageText = normalizeSearchText(message);

        return KNOWN_PROJECTS.find((projectName) => {
            return messageText.includes(normalizeSearchText(projectName));
        }) || null;
    }

    buildProjectKnowledgeSummary(projectName, projectKnowledge = []) {
        const highlights = projectKnowledge
            .map((item) => {
                const summary = summarizeHighlight(item && item.summary);
                const title = summarizeHighlight(item && item.title);
                const content = summarizeHighlight(item && item.content);

                return summary || title || content.split(/\s+/).slice(0, 20).join(" ");
            })
            .filter(Boolean)
            .slice(0, 5);

        return {
            project: projectName,
            documentsFound: projectKnowledge.length,
            highlights
        };
    }

    buildProjectResponse(projectKnowledgeSummary) {
        const highlightsList = Array.isArray(projectKnowledgeSummary.highlights)
            ? projectKnowledgeSummary.highlights.filter(Boolean)
            : [];
        const highlights = highlightsList.join(", ");
        const normalizedHighlights = normalizeSearchText(highlights);
        const pendingSignals = [
            "proximo objetivo",
            "siguiente desarrollo",
            "prioridad",
            "pendiente"
        ];
        const hasPendingSignals = pendingSignals.some((signal) => {
            return normalizedHighlights.includes(signal);
        });

        if (highlightsList.length === 0) {
            return {
                project: projectKnowledgeSummary.project,
                response: `Según el conocimiento disponible, ${projectKnowledgeSummary.project} tiene información registrada, pero todavía no hay puntos clave suficientes para resumir.`
            };
        }

        const nextStepsSentence = hasPendingSignals
            ? " Hay indicios de próximos pasos pendientes."
            : "";

        return {
            project: projectKnowledgeSummary.project,
            response: `Según el conocimiento disponible, ${projectKnowledgeSummary.project} cuenta con ${projectKnowledgeSummary.documentsFound} documentos relevantes. Puntos clave: ${highlights}.${nextStepsSentence}`
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
