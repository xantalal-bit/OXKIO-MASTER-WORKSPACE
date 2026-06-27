// OXKIO KNOWLEDGE FLOW MANUAL TEST

const fs = require("fs");
const os = require("os");
const path = require("path");

const { KnowledgeCurator } = require("./knowledgeCurator");
const { KnowledgeConnectorManager } = require("./knowledgeConnectorManager");
const KnowledgeIngestionPipeline = require("./knowledgeIngestionPipeline");
const LearningHeroesConnector = require("./connectors/learningHeroesConnector");

function removeFileSafe(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error("No se pudo limpiar archivo temporal:", error.message || String(error));
  }
}

const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const learningHeroesJsonPath = path.join(os.tmpdir(), `oxkio-learning-heroes-${tempId}.json`);
const knowledgeStorePath = path.join(os.tmpdir(), `oxkio-knowledge-store-${tempId}.json`);

try {
  const learningHeroesItems = [
    {
      title: "Oxkio Gobierno Operativo",
      description: "Curso sobre Oxkio, gobierno operativo y memoria ejecutiva."
    },
    {
      title: "Business Hunter Discovery",
      description: "Curso para detectar oportunidades con Business Hunter."
    },
    {
      title: "Seguridad y permisos",
      description: "Curso sobre seguridad, backup, token y permiso en operaciones."
    }
  ];

  fs.writeFileSync(learningHeroesJsonPath, JSON.stringify(learningHeroesItems, null, 2), "utf8");

  const curator = new KnowledgeCurator(knowledgeStorePath);
  const connectorManager = new KnowledgeConnectorManager();
  const executableConnectors = new Map();
  const learningHeroesConnector = new LearningHeroesConnector({
    filePath: learningHeroesJsonPath
  });

  connectorManager.registerConnector({
    name: learningHeroesConnector.name,
    version: learningHeroesConnector.version,
    source: learningHeroesConnector.source,
    enabled: false,
    description: "Conector local de prueba para Learning Heroes.",
    capabilities: ["fetchItems", "normalizeItem"]
  });
  executableConnectors.set(learningHeroesConnector.name, learningHeroesConnector);

  connectorManager.enableConnector("LearningHeroesConnector");

  const getRegisteredConnector = connectorManager.getConnector.bind(connectorManager);
  connectorManager.getConnector = (name) => {
    const registeredConnector = getRegisteredConnector(name);

    if (!registeredConnector) {
      return null;
    }

    const executableConnector = executableConnectors.get(registeredConnector.name);

    return Object.assign(executableConnector, registeredConnector);
  };

  const pipeline = new KnowledgeIngestionPipeline(curator, connectorManager);
  const pipelineResult = pipeline.runConnector("LearningHeroesConnector");

  console.log("Pipeline result:");
  console.log(JSON.stringify(pipelineResult, null, 2));

  console.log("Curator status:");
  console.log(JSON.stringify(curator.getStatus(), null, 2));

  console.log("Search Oxkio:");
  console.log(JSON.stringify(curator.searchKnowledge("Oxkio"), null, 2));
} finally {
  removeFileSafe(learningHeroesJsonPath);
  removeFileSafe(knowledgeStorePath);
}
