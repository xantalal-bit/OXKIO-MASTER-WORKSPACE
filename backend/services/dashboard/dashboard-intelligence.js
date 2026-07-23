const { getGreeting } = require("./providers/greeting-provider");
const { getExecutiveStatus } = require("./providers/executive-status-provider");
const { getAgenda } = require("./providers/agenda-provider");
const { getGmail } = require("./providers/gmail-dashboard-provider");
const { getMemory } = require("./providers/memory-provider");
const { getAutomations } = require("./providers/automations-provider");
const { buildExecutiveSummary } = require("./executive-summary-builder");
const { buildExecutiveState } = require("../executive/executive-orchestrator");
const { buildMorningBriefing } = require("../executive/morning-briefing");
const { discoverKnowledge } = require("../knowledge/discovery-engine");
const { getExecutiveBrain } = require("../../runtime/executive-runtime");

const RECENT_ACTIVITY_MS = 90 * 24 * 60 * 60 * 1000;
const BUSINESS_HUNTER_ALIASES = [
  "business hunter",
  "businesshunter",
  "business",
  "captacion",
  "leads",
  "prospeccion",
  "clientes"
];
const XOSE_ALIASES = [
  "xose",
  "xose y oxi",
  "oxi",
  "divulgador ia",
  "comunicador ia",
  "comunicacion ia",
  "contenido ia",
  "creador de contenido ia",
  "redes sociales"
];

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getAssetSearchText(asset) {
  if (!asset || typeof asset !== "object") return "";
  return [
    asset.name,
    asset.category,
    asset.domain,
    asset.assetType,
    ...(Array.isArray(asset.aliases) ? asset.aliases : [])
  ].map(normalizeSearchText).filter(Boolean).join(" ");
}

function matchesAliases(asset, aliases) {
  const searchable = ` ${getAssetSearchText(asset)} `;
  return aliases.some((alias) => searchable.includes(` ${normalizeSearchText(alias)} `));
}

function isUsefulAsset(asset) {
  return Boolean(asset && typeof asset === "object" && (
    asset.recognized === true
    || ["recognized", "active", "partial"].includes(normalizeSearchText(asset.status))
  ));
}

function getValidDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getAssetDate(asset) {
  if (!asset || typeof asset !== "object") return null;
  return [asset.updatedAt, asset.modifiedAt, asset.lastUpdated, asset.publishedAt]
    .map(getValidDate)
    .find(Boolean) || null;
}

function latestDate(assets) {
  const dates = assets.map(getAssetDate).filter(Boolean);
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString();
}

function getModuleStatus(candidates, usefulAssets, updatedAt, now) {
  if (candidates.length === 0) return "unknown";
  if (usefulAssets.length === 0) return "inactive";
  if (!updatedAt) return "partial";
  return now.getTime() - new Date(updatedAt).getTime() <= RECENT_ACTIVITY_MS
    ? "active"
    : "partial";
}

function unavailableEcosystemEntry(name) {
  return {
    name,
    status: "unknown",
    summary: "No disponible",
    items: 0,
    updatedAt: null,
    source: "unavailable",
    available: false
  };
}

function unavailableBusinessHunterOperation() {
  return {
    worker: "business-hunter-readonly",
    mode: "manual",
    executionEnabled: false,
    running: false,
    status: "ready",
    lastExecution: null,
    durationMs: null,
    sourceStatus: "unavailable",
    summary: "Sin ejecuciones todavía.",
    opportunitiesCount: 0,
    opportunities: [],
    recommendations: [],
    itemsCount: 0,
    topics: [],
    proposalCreated: false,
    approvalId: null,
    errors: [],
    phase: "queued",
    activeOperation: null,
    recentOperations: [],
  };
}

function buildBusinessHunterOperationView(operation) {
  if (!operation || typeof operation !== "object") {
    return unavailableBusinessHunterOperation();
  }

  const currentOperation = operation.activeOperation && typeof operation.activeOperation === "object"
    ? operation.activeOperation
    : null;
  const recentOperations = Array.isArray(operation.recentOperations)
    ? operation.recentOperations.slice(0, 5)
    : [];
  const lastOperation = recentOperations[0] || null;
  const source = currentOperation || lastOperation || operation;
  const businessResult = source.result && typeof source.result === "object" ? source.result : source;
  const status = ["running", "completed", "completed_with_warnings", "failed"].includes(source.status)
    ? source.status
    : (operation.running ? "running" : "ready");
  const running = operation.running === true || status === "running";
  const opportunityCount = Array.isArray(businessResult.opportunities)
    ? businessResult.opportunities.length
    : 0;
  const emailsCount = Number.isInteger(businessResult.emailsCount)
    ? Math.max(0, Math.min(10, businessResult.emailsCount))
    : 0;
  const sourceStatus = ["real", "partial", "unavailable"].includes(source.sourceStatus)
    ? source.sourceStatus
    : "unavailable";

  return {
    worker: typeof source.worker === "string" ? source.worker : "business-hunter-readonly",
    mode: "manual",
    executionEnabled: false,
    running,
    status,
    phase: PHASES_FOR_DASHBOARD.has(source.phase) ? source.phase : (running ? "running_worker" : "completed"),
    activeOperation: currentOperation,
    recentOperations,
    lastExecution: source.startedAt ? {
      operationId: source.operationId || null,
      interactionId: source.interactionId || null,
      startedAt: source.startedAt || null,
      completedAt: source.completedAt || null,
      durationMs: Number.isFinite(source.durationMs) ? source.durationMs : null,
    } : null,
    durationMs: Number.isFinite(source.durationMs) ? source.durationMs : null,
    sourceStatus,
    summary: typeof source.resultSummary === "string" && source.resultSummary.trim()
      ? source.resultSummary.trim()
      : typeof businessResult.summary === "string" && businessResult.summary.trim()
        ? businessResult.summary.trim()
      : sourceStatus === "unavailable"
        ? (source.worker === "memory-readonly"
          ? "No se ha encontrado memoria suficiente para completar la revisión."
          : source.worker === "gmail-readonly"
            ? "No hay correo seguro disponible para completar la revisión."
          : "Business Hunter no ha proporcionado datos de fuente disponibles.")
        : "Sin resumen disponible.",
    opportunitiesCount: opportunityCount,
    opportunities: Array.isArray(businessResult.opportunities)
      ? businessResult.opportunities.slice(0, 10)
      : [],
    relevantItems: Array.isArray(businessResult.relevantItems)
      ? businessResult.relevantItems.slice(0, 5).map((item) => ({
        sender: typeof item.sender === "string" ? item.sender.slice(0, 100) : "Remitente no disponible",
        subject: typeof item.subject === "string" ? item.subject.slice(0, 140) : "Sin asunto",
        summary: typeof item.summary === "string" ? item.summary.slice(0, 180) : "Sin resumen disponible.",
      }))
      : [],
    recommendations: Array.isArray(businessResult.recommendations)
      ? businessResult.recommendations.slice(0, 5).map((recommendation) => String(recommendation)).filter(Boolean)
      : [],
    itemsCount: Number.isInteger(businessResult.itemsCount) ? businessResult.itemsCount : opportunityCount,
    emailsCount,
    topics: Array.isArray(businessResult.topics)
      ? businessResult.topics.slice(0, 5).map((topic) => String(topic)).filter(Boolean)
      : [],
    proposalCreated: source.proposalCreated === true,
    approvalId: typeof source.approvalId === "string" && source.approvalId.trim()
      ? source.approvalId.trim()
      : null,
    warnings: Array.isArray(source.warnings)
      ? source.warnings.slice(0, 5).map((warning) => String(warning)).filter(Boolean)
      : [],
    errors: Array.isArray(source.errors)
      ? source.errors.slice(0, 5).map((error) => String(error)).filter(Boolean)
      : [],
  };
}

const PHASES_FOR_DASHBOARD = new Set([
  "queued", "validating", "running_worker", "validating_result", "logging", "completed", "failed"
]);

function buildModuleView(name, assets, aliases, now, summaryLabel) {
  const candidates = assets.filter((asset) => matchesAliases(asset, aliases));
  const usefulAssets = candidates.filter(isUsefulAsset);
  const updatedAt = latestDate(usefulAssets);
  const status = getModuleStatus(candidates, usefulAssets, updatedAt, now);
  const summary = usefulAssets.length > 0
    ? `${usefulAssets.length} elementos de ${summaryLabel} identificados en el inventario.`
    : candidates.length > 0
      ? "Módulo reconocido sin elementos activos."
      : "Sin evidencia suficiente en el inventario.";

  return {
    name,
    status,
    summary,
    items: usefulAssets.length,
    updatedAt,
    source: "knowledge-inventory",
    available: true
  };
}

function buildEcosystemView(knowledgeInventory, options = {}) {
  const unavailable = {
    businessHunter: unavailableEcosystemEntry("Business Hunter"),
    xose: unavailableEcosystemEntry("Xose"),
    ecosystem: unavailableEcosystemEntry("XANTALAL")
  };
  if (!knowledgeInventory || !Array.isArray(knowledgeInventory.assets)) {
    return unavailable;
  }

  const now = getValidDate(options.now) || new Date();
  const assets = knowledgeInventory.assets.filter((asset) => asset && typeof asset === "object");
  const usefulAssets = assets.filter(isUsefulAsset);
  const assetUpdatedAt = latestDate(usefulAssets);
  const generatedAt = getValidDate(knowledgeInventory.generatedAt);
  const ecosystemUpdatedAt = assetUpdatedAt || (generatedAt ? generatedAt.toISOString() : null);
  const ecosystemStatus = usefulAssets.length === 0
    ? (assets.length > 0 ? "inactive" : "unknown")
    : assetUpdatedAt
      ? getModuleStatus(usefulAssets, usefulAssets, assetUpdatedAt, now)
      : "partial";

  return {
    businessHunter: buildModuleView(
      "Business Hunter",
      assets,
      BUSINESS_HUNTER_ALIASES,
      now,
      "actividad comercial"
    ),
    xose: buildModuleView(
      "Xose",
      assets,
      XOSE_ALIASES,
      now,
      "comunicación y divulgación IA"
    ),
    ecosystem: {
      name: "XANTALAL",
      status: ecosystemStatus,
      summary: usefulAssets.length > 0
        ? `${usefulAssets.length} elementos útiles identificados en el inventario.`
        : "Sin elementos útiles identificados en el inventario.",
      items: usefulAssets.length,
      updatedAt: ecosystemUpdatedAt,
      source: "knowledge-inventory",
      available: true
    }
  };
}

async function getDashboardState(options = {}) {
  const timestamp = new Date().toISOString();
  const [
    greeting,
    agenda,
    gmail,
    memory,
    automations
  ] = await Promise.all([
    getGreeting(timestamp),
    getAgenda(timestamp, options.calendarReader),
    getGmail(timestamp, options.gmailReader),
    getMemory(timestamp),
    getAutomations(timestamp, options.approvalQueue)
  ]);
  const knowledgeInventory = discoverKnowledge();
  const ecosystem = buildEcosystemView(knowledgeInventory);
  const businessHunterOperation = buildBusinessHunterOperationView(options.operationsStatus);
  const executiveStatus = getExecutiveStatus({
    operational: true,
    sources: [agenda, gmail, memory, automations, ecosystem]
  });

  const dashboardState = {
    greeting,
    executiveStatus,
    agenda,
    gmail,
    memory,
    automations
  };
  const executiveSummary = buildExecutiveSummary(dashboardState);
  const dashboardStateWithSummary = {
    ...dashboardState,
    executiveSummary
  };
  const { executiveBriefing } = await buildExecutiveState({
    executiveBrain: getExecutiveBrain(),
    dashboardState: dashboardStateWithSummary
  });
  const dashboardStateWithIntelligence = {
    ...dashboardStateWithSummary,
    executiveBriefing,
    knowledgeInventory,
    ecosystem,
    operations: {
      businessHunter: businessHunterOperation,
    }
  };
  const morningBriefing = buildMorningBriefing(dashboardStateWithIntelligence);

  return {
    ...dashboardStateWithIntelligence,
    morningBriefing
  };
}

module.exports = {
  buildBusinessHunterOperationView,
  buildEcosystemView,
  getDashboardState
};
