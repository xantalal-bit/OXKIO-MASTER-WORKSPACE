// OXKIO KNOWLEDGE INGESTION PIPELINE V1

function connectorNameOf(connector, fallbackName) {
  return connector && connector.name ? connector.name : fallbackName;
}

function isEnabled(connector) {
  return connector && connector.enabled !== false;
}

function normalizeFetchedItems(items) {
  return Array.isArray(items) ? items : [];
}

class KnowledgeIngestionPipeline {
  constructor(curator, connectorManager) {
    this.curator = curator;
    this.connectorManager = connectorManager;
  }

  runConnector(connectorName) {
    const connector = this.connectorManager.getConnector(connectorName);
    const summary = {
      ok: false,
      connector: connectorName,
      fetched: 0,
      ingested: 0,
      duplicates: 0,
      errors: []
    };

    if (!connector) {
      summary.errors.push(`Connector not found: ${connectorName}`);
      return summary;
    }

    summary.connector = connectorNameOf(connector, connectorName);

    if (!isEnabled(connector)) {
      summary.errors.push(`Connector disabled: ${summary.connector}`);
      return summary;
    }

    try {
      connector.connect();

      const items = normalizeFetchedItems(connector.fetchItems());
      summary.fetched = items.length;

      items.forEach((item) => {
        try {
          const normalizedItem = typeof connector.normalizeItem === "function"
            ? connector.normalizeItem(item)
            : item;
          const duplicate = typeof this.curator.detectDuplicate === "function"
            ? this.curator.detectDuplicate(normalizedItem)
            : null;

          this.curator.ingestItem(normalizedItem);

          if (duplicate) {
            summary.duplicates += 1;
          } else {
            summary.ingested += 1;
          }
        } catch (error) {
          summary.errors.push(error.message || String(error));
        }
      });

      summary.ok = summary.errors.length === 0;
    } catch (error) {
      summary.errors.push(error.message || String(error));
    } finally {
      try {
        if (connector && typeof connector.disconnect === "function") {
          connector.disconnect();
        }
      } catch (error) {
        summary.errors.push(error.message || String(error));
        summary.ok = false;
      }
    }

    return summary;
  }
}

module.exports = KnowledgeIngestionPipeline;
