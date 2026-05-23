const scenarios = {
  ecommerce: {
    investment: "3000€ - 15000€",
    difficulty: "Media",
    risk: "Medio-Alto",
    time: "3-12 meses",
    strategies: [
      "Marketing digital",
      "SEO",
      "Publicidad en redes",
      "Automatización logística"
    ]
  },

  saas: {
    investment: "10000€ - 50000€",
    difficulty: "Alta",
    risk: "Alto",
    time: "6-24 meses",
    strategies: [
      "MVP rápido",
      "Suscripción mensual",
      "Captación B2B",
      "Escalabilidad cloud"
    ]
  }
};

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

console.log(simulateBusiness("ecommerce"));