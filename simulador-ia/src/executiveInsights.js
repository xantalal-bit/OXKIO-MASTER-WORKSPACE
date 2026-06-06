function normalizeText(item) {
  if (typeof item === "string") {
    return item;
  }

  if (item && item.text) {
    return item.text;
  }

  return "";
}

function detectKeywordScore(texts, keywords) {
  return texts.filter(text =>
    keywords.some(keyword =>
      text.toLowerCase().includes(keyword)
    )
  ).length;
}

function generateExecutiveInsights(memory) {
  const decisions = memory.decisions || [];
  const priorities = memory.priorities || [];
  const goals = memory.goals || [];

  const allTexts = [
    ...decisions,
    ...priorities,
    ...goals
  ]
    .map(normalizeText)
    .filter(Boolean);

  const patterns = [
    {
      name: "Consolidación del núcleo",
      description:
        "La memoria muestra una tendencia clara a consolidar Oxkio Core antes de añadir nuevos módulos.",
      keywords: [
        "core",
        "núcleo",
        "nucleo",
        "consolidar",
        "consolidación",
        "consolidacion",
        "antes de añadir",
        "módulos secundarios",
        "modulos secundarios"
      ]
    },
    {
      name: "Priorización estratégica",
      description:
        "La memoria refleja decisiones orientadas a priorizar proyectos con mayor viabilidad y menor riesgo.",
      keywords: [
        "prioridad",
        "priorizar",
        "priorización",
        "priorizacion",
        "proyecto a",
        "viabilidad",
        "riesgo",
        "escalabilidad"
      ]
    },
    {
      name: "Expansión controlada",
      description:
        "La memoria sugiere avanzar de forma progresiva, evitando dispersión y manteniendo control operativo.",
      keywords: [
        "expandir",
        "expansión",
        "expansion",
        "módulos",
        "modulos",
        "supervisión",
        "supervision",
        "seguimiento",
        "control"
      ]
    }
  ];

  const detectedPatterns = patterns
    .map(pattern => {
      const frequency =
        detectKeywordScore(
          allTexts,
          pattern.keywords
        );

      return {
        name: pattern.name,
        description: pattern.description,
        frequency,
        confidence:
          frequency >= 4
            ? "Alta"
            : frequency >= 2
              ? "Media"
              : frequency === 1
                ? "Baja"
                : "Sin detectar"
      };
    })
    .filter(pattern => pattern.frequency > 0)
    .sort((a, b) => b.frequency - a.frequency);

  const dominantPattern =
    detectedPatterns[0] || null;

  return {
    generatedAt: new Date().toISOString(),
    totalAnalyzedItems: allTexts.length,
    dominantPattern,
    detectedPatterns,
    executiveConclusion:
      dominantPattern
        ? `Patrón estratégico dominante: ${dominantPattern.name}. ${dominantPattern.description}`
        : "Todavía no hay suficientes datos para detectar un patrón estratégico dominante."
  };
}

module.exports = generateExecutiveInsights;