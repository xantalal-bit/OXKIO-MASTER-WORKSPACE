// OXKIO BASE KNOWLEDGE CONNECTOR V1

class BaseKnowledgeConnector {
  constructor(config) {
    this.config = config || {};
    this.connected = false;
    this.name = this.config.name || this.constructor.name;
    this.version = this.config.version || "1.0";
    this.source = this.config.source || "UNKNOWN";
  }

  connect() {
    throw new Error("Method not implemented");
  }

  disconnect() {
    throw new Error("Method not implemented");
  }

  isConnected() {
    return this.connected === true;
  }

  fetchItems() {
    throw new Error("Method not implemented");
  }

  normalizeItem(item) {
    throw new Error("Method not implemented");
  }

  getStatus() {
    return {
      name: this.name,
      version: this.version,
      source: this.source,
      connected: this.isConnected()
    };
  }
}

module.exports = BaseKnowledgeConnector;
