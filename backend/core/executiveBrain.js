const SupervisorAgent = require("../agents/executive/supervisorAgent");
const ExecutiveDispatcher = require("./executiveDispatcher");
const knowledgeCurator = require("../knowledge/knowledgeCurator");
const ecosystemService = require("../ecosystem/ecosystemService");

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

    think(message = "", executiveContextInput = null) {

        const analysis = this.intentAnalyzer.analyze(message);

        const relatedMemory = this.memory.searchMemory(message);

        const matchedRules = this.ruleEngine.evaluate({ message, analysis, relatedMemory });

        const strategicMemory = this.supervisor.searchStrategicMemory(message);

        const knowledge = this.knowledgeCurator.searchKnowledge(message);

const governanceExecutiveContext = this.getExecutiveContext();
const projectToLearn = analysis.projectToLearn || (
    analysis.intent === "learn_project"
        ? this.detectProjectToLearn(message, governanceExecutiveContext)
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
const projectRecommendation = projectKnowledgeSummary
    ? this.buildProjectRecommendation(projectKnowledgeSummary)
    : null;
const ecosystemContext = {
    ecosystemName: ecosystemService.getEcosystemName(),
    ecosystemRoot: ecosystemService.getEcosystemRoot(),
    governanceFolder: ecosystemService.getGovernanceFolder(),
    governanceFiles: ecosystemService.getGovernanceFiles(),
};
const executiveMission = this.buildExecutiveMission(executiveContextInput);
const executivePlan = this.buildExecutivePlan(executiveMission);

let selectedAgent;

try {
    if (analysis.intent === "learn_project") {
        selectedAgent = {
            agent: "ExecutiveSupervisor",
            reason: "El Supervisor coordina el aprendizaje de proyectos.",
            confidence: 0.95
        };
    } else {
        selectedAgent = this.dispatcher.selectAgent(analysis, governanceExecutiveContext);
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
    governanceExecutiveContext,
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
    projectRecommendation,
    policyValidation,
    executiveContext: {
        governance: governanceExecutiveContext,
        dashboard: executiveContextInput
    },
    executiveMission,
    executivePlan,
    ecosystemContext,
    projectToLearn,
    selectedAgent,
    decision,
    status: "EXECUTIVE_BRAIN_OK"
};
    }

    detectProjectToLearn(message, executiveContext) {
        return this.detectKnownProject(message);
    }

    buildExecutiveMission(executiveContext) {
        const priorities = [];
        const risks = [];
        const opportunities = [];
        const dashboard = executiveContext && executiveContext.dashboard
            ? executiveContext.dashboard
            : {};
        const agenda = dashboard.agenda || {};
        const gmail = dashboard.gmail || {};
        const summary = executiveContext ? executiveContext.executiveSummary : null;
        const agendaEvents = Array.isArray(agenda.events)
            ? agenda.events
            : [];
        const inbox = gmail.inbox || {};
        const alerts = summary && Array.isArray(summary.alerts)
            ? summary.alerts
            : [];

        if (agendaEvents.length > 0 || agenda.nextEvent) {
            priorities.push("Revisar agenda");
        }

        if (
            Number(inbox.unread || 0) > 0 ||
            Number(inbox.priority || 0) > 0 ||
            Number(inbox.requiresReview || 0) > 0
        ) {
            priorities.push("Revisar correo");
        }

        alerts.forEach((alert) => {
            risks.push(String(alert));
        });

        if (summary && summary.recommendation) {
            opportunities.push(summary.recommendation);
        }

        return {
            currentMission: priorities.length > 0 || risks.length > 0 || opportunities.length > 0
                ? "Mantener el foco ejecutivo con el contexto disponible."
                : "Obtener contexto ejecutivo.",
            priorities,
            risks,
            opportunities
        };
    }

    buildExecutivePlan(executiveMission) {
        const priorities = executiveMission && Array.isArray(executiveMission.priorities)
            ? executiveMission.priorities
            : [];
        const nextSteps = [];
        const hasAgendaPriority = priorities.some((priority) => {
            return normalizeSearchText(priority).includes("agenda");
        });
        const hasEmailPriority = priorities.some((priority) => {
            return normalizeSearchText(priority).includes("correo");
        });

        let currentStep = "Obtener contexto";

        if (hasAgendaPriority) {
            currentStep = "Revisar agenda";
        }

        if (hasEmailPriority) {
            nextSteps.push("Revisar correo");
        }

        return {
            currentStep,
            nextSteps,
            completedSteps: []
        };
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

    buildProjectRecommendation(projectKnowledgeSummary) {
        const highlights = Array.isArray(projectKnowledgeSummary.highlights)
            ? projectKnowledgeSummary.highlights.join(" ")
            : "";
        const normalizedHighlights = normalizeSearchText(highlights);
        const recommendations = [];

        if (
            normalizedHighlights.includes("proximo objetivo") ||
            normalizedHighlights.includes("siguiente desarrollo")
        ) {
            recommendations.push("Se recomienda continuar con el siguiente objetivo identificado en el conocimiento del proyecto.");
        }

        if (normalizedHighlights.includes("pendiente")) {
            recommendations.push("Existen tareas pendientes que deberían revisarse antes de iniciar nuevos desarrollos.");
        }

        if (normalizedHighlights.includes("operativo")) {
            recommendations.push("El proyecto presenta una base estable sobre la que continuar el desarrollo.");
        }

        return {
            project: projectKnowledgeSummary.project,
            recommendation: recommendations.length > 0
                ? recommendations.join(" ")
                : "El conocimiento disponible no contiene recomendaciones ejecutivas automáticas."
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
