const {
  generateCEOAnalysis
} = require("../openaiClient");

async function analyzeAsCEO(
  simulation,
  prompt
) {

  const aiAnalysis =
    await generateCEOAnalysis(
      prompt,
      simulation
    );

  return {

    agent: "CEO Agent",

    focus:
      "visión estratégica y toma de decisiones",

    recommendations: [
      aiAnalysis
    ]

  };
}

module.exports = analyzeAsCEO;