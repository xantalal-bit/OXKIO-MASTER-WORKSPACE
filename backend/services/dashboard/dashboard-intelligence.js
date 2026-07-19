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
    getAgenda(timestamp),
    getGmail(timestamp, options.gmailReader),
    getMemory(timestamp),
    getAutomations(timestamp, options.approvalQueue)
  ]);
  const executiveStatus = getExecutiveStatus({
    operational: true,
    sources: [agenda, gmail, memory, automations]
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
  const knowledgeInventory = discoverKnowledge();
  const ecosystem = buildEcosystemView(knowledgeInventory);
  const dashboardStateWithIntelligence = {
    ...dashboardStateWithSummary,
    executiveBriefing,
    knowledgeInventory,
    ecosystem
  };
  const morningBriefing = buildMorningBriefing(dashboardStateWithIntelligence);

  return {
    ...dashboardStateWithIntelligence,
    morningBriefing
  };
}

module.exports = {
  buildEcosystemView,
  getDashboardState
};
