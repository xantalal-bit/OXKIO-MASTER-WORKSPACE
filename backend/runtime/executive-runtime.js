const OxkioSystem = require("../core/system");
const IntentAnalyzer = require("../core/intentAnalyzer");
const RuleEngine = require("../core/ruleEngine");
const ExecutiveBrain = require("../core/executiveBrain");

let systemInstance = null;
let intentAnalyzerInstance = null;
let ruleEngineInstance = null;
let executiveBrainInstance = null;

function getSystem() {
  if (!systemInstance) {
    systemInstance = new OxkioSystem();
    systemInstance.boot();
  }

  return systemInstance;
}

function getMemory() {
  return getSystem().memory;
}

function getIntentAnalyzer() {
  if (!intentAnalyzerInstance) {
    intentAnalyzerInstance = new IntentAnalyzer();
  }

  return intentAnalyzerInstance;
}

function getRuleEngine() {
  if (!ruleEngineInstance) {
    ruleEngineInstance = new RuleEngine();
  }

  return ruleEngineInstance;
}

function getExecutiveBrain() {
  if (!executiveBrainInstance) {
    executiveBrainInstance = new ExecutiveBrain(
      getMemory(),
      getIntentAnalyzer(),
      getRuleEngine()
    );
  }

  return executiveBrainInstance;
}

module.exports = {
  getSystem,
  getMemory,
  getIntentAnalyzer,
  getRuleEngine,
  getExecutiveBrain
};
