const scenarios = require("./scenarios");

function detectScenario(text) {

  const input = text.toLowerCase();

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
    conclusion:
      "Proyecto viable con planificación y supervisión adecuada."
  };
}

const userInput = process.argv[2];
const detectedScenario = detectScenario(userInput || "");

if (!userInput) {
  console.log("Debes indicar un tipo de simulación.");
} else {
  if (detectedScenario) {
  console.log(simulateBusiness(detectedScenario));
} else {
  console.log({
    error: "No se pudo detectar un escenario válido"
  });
}
}