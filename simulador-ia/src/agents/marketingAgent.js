function analyzeMarketing(simulation) {

  const strategies = [];

  if (simulation.scalabilityScore >= 80) {
    strategies.push(
      "Potenciar campañas digitales escalables."
    );
  }

  if (simulation.project === "consulting") {
    strategies.push(
      "Fortalecer marca personal en LinkedIn."
    );
  }

  if (simulation.project === "restaurant") {
    strategies.push(
      "Impulsar marketing local y reseñas online."
    );
  }

  if (simulation.project === "saas") {
    strategies.push(
      "Priorizar captación B2B automatizada."
    );
  }

  return {
    agent: "Marketing Agent",
    focus: "crecimiento y captación",
    strategies
  };
}

module.exports = analyzeMarketing;