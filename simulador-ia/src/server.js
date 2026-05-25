const http = require("http");
const url = require("url");

const loadScenarios = require("./scenarioLoader");

const scenarios = loadScenarios();

const runAgents = require("./agents/agentOrchestrator");

const PORT = 3100;

function detectScenario(text) {

  const input = text.toLowerCase();

  const scenarioKeys = Object.keys(scenarios);

  const directMatch =
    scenarioKeys.find(key =>
      input.includes(key)
    );

  if (directMatch) {
    return directMatch;
  }

  if (
    input.includes("restaurante") ||
    input.includes("restaurant")
  ) {
    return "restaurant";
  }

  if (
    input.includes("tienda") ||
    input.includes("ecommerce")
  ) {
    return "ecommerce";
  }

  if (
    input.includes("saas") ||
    input.includes("software")
  ) {
    return "saas";
  }

  if (
    input.includes("consultoría") ||
    input.includes("consultoria") ||
    input.includes("empresa") ||
    input.includes("ceo") ||
    input.includes("negocio")
  ) {
    return "consulting";
  }

  return null;
}

function simulateBusiness(type) {

  const scenario = scenarios[type];

  if (!scenario) {
    return {
      error: "Escenario no encontrado"
    };
  }

  return {
    project: type,
    estimatedInvestment: scenario.investment,
    difficulty: scenario.difficulty,
    risk: scenario.risk,
    estimatedTime: scenario.time,
    recommendedStrategies: scenario.strategies,
    viabilityScore: scenario.viabilityScore,
    riskScore: scenario.riskScore,
    scalabilityScore: scenario.scalabilityScore
  };
}

const server = http.createServer((req, res) => {

  const parsedUrl =
    url.parse(req.url, true);

    if (parsedUrl.pathname === "/scenarios") {

  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  });

  res.end(
    JSON.stringify(
      Object.keys(scenarios)
    )
  );

  return;
}

  if (parsedUrl.pathname === "/simulate") {

    const prompt =
      parsedUrl.query.prompt || "";

    const detectedScenario =
      detectScenario(prompt);

    const result =
      simulateBusiness(detectedScenario);

      result.agentAnalysis =
  runAgents(result);

    res.writeHead(200, {
      "Content-Type":
        "application/json; charset=utf-8",

      "Access-Control-Allow-Origin": "*"
    });

    res.end(JSON.stringify(result));

    return;
  }

  res.writeHead(200, {
    "Content-Type":
      "application/json; charset=utf-8"
  });

  res.end(JSON.stringify({
    ok: true,
    message: "Servidor Simulador IA funcionando"
  }));

});

server.listen(PORT, () => {
  console.log(
    `Servidor Simulador IA en http://localhost:${PORT}`
  );
});