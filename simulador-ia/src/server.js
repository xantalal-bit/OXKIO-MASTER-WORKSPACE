const http = require("http");
const url = require("url");
const fs = require("fs");
const path = require("path");

const loadScenarios = require("./scenarioLoader");
const runAgents = require("./agents/agentOrchestrator");
const {
  saveSimulation,
  getHistory,
  getExecutiveInsights
} = require("./simulationHistory");

const {
  generateExecutivePDF
} = require("./pdfGenerator");

const scenarios = loadScenarios();

const PORT = 3100;

function detectScenario(text) {
  const input = text.toLowerCase();

  const scenarioKeys = Object.keys(scenarios);

  const directMatch =
    scenarioKeys.find(key => input.includes(key));

  if (directMatch) return directMatch;

  if (
    input.includes("saas") ||
    input.includes("software") ||
    input.includes("plataforma") ||
    input.includes("app") ||
    input.includes("aplicación") ||
    input.includes("automatizar") ||
    input.includes("automatización") ||
    input.includes("despachos") ||
    input.includes("legaltech") ||
    input.includes("healthtech") ||
    input.includes("edtech") ||
    input.includes("ia para")
  ) {
    return "saas";
  }

  if (
    input.includes("restaurante") ||
    input.includes("restaurant") ||
    input.includes("bar") ||
    input.includes("cafetería") ||
    input.includes("hostelería")
  ) {
    return "restaurant";
  }

  if (
    input.includes("consultoría") ||
    input.includes("consultoria") ||
    input.includes("consultor") ||
    input.includes("empresa") ||
    input.includes("ceo") ||
    input.includes("negocio") ||
    input.includes("servicios profesionales") ||
    input.includes("asesoría") ||
    input.includes("asesoria")
  ) {
    return "consulting";
  }

  return "consulting";
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

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname === "/") {
    const frontendPath = path.join(__dirname, "../frontend/index.html");
    const html = fs.readFileSync(frontendPath, "utf8");

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });

    res.end(html);
    return;
  }

if (parsedUrl.pathname === "/history-ui") {
  const historyPath = path.join(__dirname, "../frontend/history.html");
  const html = fs.readFileSync(historyPath, "utf8");

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8"
  });

  res.end(html);
  return;
}

  if (parsedUrl.pathname === "/scenarios") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    });

    res.end(JSON.stringify(Object.keys(scenarios)));
    return;
  }

  if (parsedUrl.pathname === "/simulate") {
    const prompt = parsedUrl.query.prompt || "";
    const detectedScenario = detectScenario(prompt);
    const result = simulateBusiness(detectedScenario);

    if (!result.error) {

  result.agentAnalysis =
  await runAgents(
    result,
    prompt
  );

  saveSimulation({
    prompt,
    scenario: detectedScenario,
    result
  });

}

    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    });

    res.end(JSON.stringify(result));
    return;
  }

if (parsedUrl.pathname === "/report-pdf") {
  const prompt = parsedUrl.query.prompt || "";
  const detectedScenario = detectScenario(prompt);
  const result = simulateBusiness(detectedScenario);

  if (!result.error) {
    result.agentAnalysis =
      await runAgents(
        result,
        prompt
      );
  }

  generateExecutivePDF(
    res,
    result
  );

  return;
}

if (parsedUrl.pathname === "/insights") {

  const insights =
    getExecutiveInsights();

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });

  res.end(
    JSON.stringify(insights)
  );

  return;
}


if (parsedUrl.pathname === "/history") {

  const history =
    getHistory();

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });

  res.end(
    JSON.stringify(history)
  );

  return;
}

  res.writeHead(404, {
    "Content-Type": "application/json; charset=utf-8"
  });

  res.end(JSON.stringify({
    ok: false,
    message: "Ruta no encontrada"
  }));
});

server.listen(PORT, () => {
  console.log(`Servidor Simulador IA en http://localhost:${PORT}`);
});
