function analyzeGrowth(simulation) {

  const opportunities = [];

  if (simulation.scalabilityScore >= 80) {
    opportunities.push(
      "Preparar estrategia de expansión nacional e internacional."
    );
  }

  if (simulation.viabilityScore >= 70) {
    opportunities.push(
      "Validar canales de adquisición escalables."
    );
  }

  if (simulation.project === "consulting") {
    opportunities.push(
      "Crear red de partners y prescriptores."
    );
  }

  if (simulation.project === "restaurant") {
    opportunities.push(
      "Explorar franquicias y acuerdos locales."
    );
  }

  if (simulation.project === "saas") {
    opportunities.push(
      "Diseñar estrategia SaaS de crecimiento recurrente."
    );
  }

  return {
    agent: "Growth Agent",
    focus: "expansión y crecimiento empresarial",
    opportunities
  };
}

module.exports = analyzeGrowth;