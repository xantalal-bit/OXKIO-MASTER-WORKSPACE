// OXKIO KNOWLEDGE CONNECTOR MANAGER V1

function normalizeText(value) {
  return String(value || "").trim();
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

function normalizeConnector(connector) {
  const input = connector || {};
  const name = normalizeText(input.name);

  if (!name) {
    throw new Error("El conector debe tener name.");
  }

  return {
    name,
    version: normalizeText(input.version || "1.0"),
    enabled: input.enabled === true,
    source: normalizeText(input.source || "UNKNOWN"),
    description: normalizeText(input.description),
    capabilities: normalizeCapabilities(input.capabilities)
  };
}

class KnowledgeConnectorManager {
  constructor() {
    this.connectors = new Map();
  }

  registerConnector(connector) {
    const normalizedConnector = normalizeConnector(connector);

    this.connectors.set(normalizedConnector.name, normalizedConnector);

    return normalizedConnector;
  }

  listConnectors() {
    return Array.from(this.connectors.values()).map((connector) => ({ ...connector }));
  }

  getConnector(name) {
    const connector = this.connectors.get(normalizeText(name));

    return connector ? { ...connector } : null;
  }

  enableConnector(name) {
    const connectorName = normalizeText(name);
    const connector = this.connectors.get(connectorName);

    if (!connector) {
      return null;
    }

    connector.enabled = true;

    return { ...connector };
  }

  disableConnector(name) {
    const connectorName = normalizeText(name);
    const connector = this.connectors.get(connectorName);

    if (!connector) {
      return null;
    }

    connector.enabled = false;

    return { ...connector };
  }

  getStatus() {
    const connectors = this.listConnectors();
    const enabled = connectors.filter((connector) => connector.enabled);

    return {
      name: "KnowledgeConnectorManager",
      version: "1.0",
      totalConnectors: connectors.length,
      enabledConnectors: enabled.length,
      disabledConnectors: connectors.length - enabled.length,
      connectors
    };
  }
}

module.exports = new KnowledgeConnectorManager();
module.exports.KnowledgeConnectorManager = KnowledgeConnectorManager;
