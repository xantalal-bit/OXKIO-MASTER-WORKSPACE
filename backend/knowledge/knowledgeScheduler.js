// OXKIO KNOWLEDGE SCHEDULER V1

function normalizeName(name) {
  return String(name || "").trim();
}

function normalizePipeline(pipeline) {
  if (!pipeline || typeof pipeline.runConnector !== "function") {
    throw new Error("Pipeline must implement runConnector(connectorName).");
  }

  return pipeline;
}

class KnowledgeScheduler {
  constructor() {
    this.pipelines = new Map();
    this.lastResults = new Map();
  }

  registerPipeline(name, pipeline) {
    const pipelineName = normalizeName(name);

    if (!pipelineName) {
      throw new Error("Pipeline name is required.");
    }

    this.pipelines.set(pipelineName, normalizePipeline(pipeline));

    return {
      name: pipelineName,
      registered: true
    };
  }

  run(name) {
    const pipelineName = normalizeName(name);
    const pipeline = this.pipelines.get(pipelineName);

    if (!pipeline) {
      const result = {
        ok: false,
        pipeline: pipelineName,
        error: `Pipeline not found: ${pipelineName}`
      };

      this.lastResults.set(pipelineName, result);

      return result;
    }

    try {
      const result = pipeline.runConnector(pipelineName);
      const normalizedResult = {
        ok: result && result.ok === true,
        pipeline: pipelineName,
        result
      };

      this.lastResults.set(pipelineName, normalizedResult);

      return normalizedResult;
    } catch (error) {
      const result = {
        ok: false,
        pipeline: pipelineName,
        error: error.message || String(error)
      };

      this.lastResults.set(pipelineName, result);

      return result;
    }
  }

  runAll() {
    return Array.from(this.pipelines.keys()).map((pipelineName) => this.run(pipelineName));
  }

  getLastResults() {
    return Array.from(this.lastResults.values()).map((result) => ({ ...result }));
  }

  getStatus() {
    const pipelineNames = Array.from(this.pipelines.keys());
    const lastResults = this.getLastResults();

    return {
      name: "KnowledgeScheduler",
      version: "1.0",
      totalPipelines: pipelineNames.length,
      pipelines: pipelineNames,
      lastResults
    };
  }
}

module.exports = new KnowledgeScheduler();
module.exports.KnowledgeScheduler = KnowledgeScheduler;
