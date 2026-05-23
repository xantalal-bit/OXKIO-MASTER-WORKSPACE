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
],

viabilityScore: 78,
riskScore: 65,
scalabilityScore: 80
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
    ],

    viabilityScore: 72,
riskScore: 82,
scalabilityScore: 95
  },

  restaurant: {
    investment: "20000€ - 100000€",
    difficulty: "Alta",
    risk: "Alto",
    time: "6-18 meses",
    strategies: [
      "Buena ubicación",
      "Control de costes",
      "Marketing local",
      "Reservas online"
    ],

    viabilityScore: 68,
riskScore: 85,
scalabilityScore: 55
  },

  consulting: {
  investment: "5000€ - 30000€",
  difficulty: "Media-Alta",
  risk: "Medio",
  time: "3-12 meses",

  strategies: [
    "Captación LinkedIn",
    "Automatización IA",
    "Servicios recurrentes",
    "Marca profesional",
    "Networking empresarial"
  ],

  viabilityScore: 84,
  riskScore: 52,
  scalabilityScore: 88
}

};

module.exports = scenarios;