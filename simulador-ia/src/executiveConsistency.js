function normalizeText(item) {
  if (typeof item === "string") {
    return item;
  }

  if (item && item.text) {
    return item.text;
  }

  return "";
}

function containsAny(text, keywords) {
  const lowerText = text.toLowerCase();

  return keywords.some(keyword =>
    lowerText.includes(keyword)
  );
}

function analyzeExecutiveConsistency(memory) {
  const decisions =
    memory.decisions || [];

  const texts =
    decisions
      .map(normalizeText)
      .filter(Boolean);

  const expansionKeywords = [
    "expandir",
    "expansión",
    "expansion",
    "módulos",
    "modulos",
    "nuevas funcionalidades",
    "crecimiento",
    "escalar"
  ];

  const consolidationKeywords = [
    "consolidar",
    "consolidación",
    "consolidacion",
    "núcleo",
    "nucleo",
    "core",
    "estabilidad",
    "motor",
    "memoria",
    "antes de expandir",
    "antes de añadir"
  ];

  const contradictions = [];

  const hasExpansion =
    texts.some(text =>
      containsAny(text, expansionKeywords)
    );

  const hasConsolidation =
    texts.some(text =>
      containsAny(text, consolidationKeywords)
    );

  if (hasExpansion && hasConsolidation) {
    contradictions.push({
      type: "expansion_vs_consolidation",
      level: "Media",
      title: "Tensión entre expansión y consolidación",
      message:
        "La memoria contiene decisiones orientadas a expansión y también decisiones orientadas a consolidar el núcleo.",
      recommendation:
        "Definir explícitamente si la fase actual es consolidación o expansión antes de añadir nuevas funcionalidades."
    });
  }

  const projectAKeywords = [
    "proyecto a",
    "seleccionar el proyecto a",
    "priorización del proyecto a",
    "priorizacion del proyecto a"
  ];

  const abandonKeywords = [
    "abandonar",
    "descartar",
    "pausar",
    "cancelar",
    "congelar"
  ];

  const hasProjectAPriority =
    texts.some(text =>
      containsAny(text, projectAKeywords)
    );

  const hasAbandonSignal =
    texts.some(text =>
      containsAny(text, abandonKeywords)
    );

  if (hasProjectAPriority && hasAbandonSignal) {
    contradictions.push({
      type: "priority_vs_abandonment",
      level: "Alta",
      title: "Contradicción sobre prioridad de proyecto",
      message:
        "La memoria contiene señales de priorización y señales de abandono o pausa.",
      recommendation:
        "Revisar la decisión estratégica antes de ejecutar nuevas acciones."
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    consistencyStatus: "Executive Consistency Engine v1 activo",
    analyzedDecisions: texts.length,
    totalContradictions: contradictions.length,
    contradictions,
    overallStatus:
      contradictions.length > 0
        ? "Revisar consistencia estratégica"
        : "Sin contradicciones estratégicas relevantes"
  };
}

module.exports = analyzeExecutiveConsistency;