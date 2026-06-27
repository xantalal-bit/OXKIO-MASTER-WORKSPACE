// OXKIO KNOWLEDGE ACQUISITION ENGINE V1

const knowledgeCurator = require("./knowledgeCurator");
const { KnowledgeConnectorManager } = require("./knowledgeConnectorManager");
const KnowledgeIngestionPipeline = require("./knowledgeIngestionPipeline");
const { KnowledgeScheduler } = require("./knowledgeScheduler");

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeSearchText(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeCapabilities(value) {
  if (Array.isArray(value)) {
    return value.map((capability) => normalizeText(capability)).filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((capability) => normalizeText(capability)).filter(Boolean);
  }

  return [];
}

function inferCapabilities(connector) {
  const capabilities = normalizeCapabilities(connector.capabilities);

  ["connect", "fetchItems", "normalizeItem", "disconnect"].forEach((methodName) => {
    if (typeof connector[methodName] === "function" && !capabilities.includes(methodName)) {
      capabilities.push(methodName);
    }
  });

  return capabilities;
}

function buildSearchCorpus(connector) {
  return normalizeSearchText([
    connector.name,
    connector.version,
    connector.source,
    connector.description,
    ...normalizeCapabilities(connector.capabilities)
  ].join(" "));
}

class KnowledgeAcquisitionEngine {
  constructor(options) {
    const config = options || {};

    this.name = "KnowledgeAcquisitionEngine";
    this.version = "1.0";
    this.connectorManager = config.connectorManager || new KnowledgeConnectorManager();
    this.scheduler = config.scheduler || new KnowledgeScheduler();
    this.executableConnectors = new Map();

    this.attachExecutableConnectorLookup();
    this.pipeline = config.pipeline || new KnowledgeIngestionPipeline(
      config.curator || knowledgeCurator,
      this.connectorManager
    );
  }

  attachExecutableConnectorLookup() {
    const originalGetConnector = this.connectorManager.getConnector.bind(this.connectorManager);

    this.connectorManager.getConnector = (name) => {
      const registeredConnector = originalGetConnector(name);

      if (!registeredConnector) {
        return null;
      }

      const executableConnector = this.executableConnectors.get(registeredConnector.name);

      if (!executableConnector) {
        return registeredConnector;
      }

      return Object.assign(executableConnector, registeredConnector);
    };
  }

  registerConnector(connector) {
    const input = connector || {};
    const connectorName = normalizeText(input.name);

    if (!connectorName) {
      throw new Error("Connector name is required.");
    }

    this.executableConnectors.set(connectorName, input);

    const registeredConnector = this.connectorManager.registerConnector({
      name: connectorName,
      version: input.version || "1.0",
      enabled: input.enabled !== false,
      source: input.source || "UNKNOWN",
      description: input.description,
      capabilities: inferCapabilities(input)
    });

    this.scheduler.registerPipeline(connectorName, this.pipeline);

    return registeredConnector;
  }

  runConnector(name) {
    return this.scheduler.run(name);
  }

  runAll() {
    return this.scheduler.runAll();
  }

  searchConnectors(query) {
    const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
    const connectors = this.connectorManager.listConnectors();

    if (terms.length === 0) {
      return connectors;
    }

    return connectors.filter((connector) => {
      const corpus = buildSearchCorpus(connector);

      return terms.every((term) => corpus.includes(term));
    });
  }

  getStatus() {
    return {
      name: this.name,
      version: this.version,
      connectorManager: this.connectorManager.getStatus(),
      scheduler: this.scheduler.getStatus()
    };
  }
}

module.exports = new KnowledgeAcquisitionEngine();
module.exports.KnowledgeAcquisitionEngine = KnowledgeAcquisitionEngine;
