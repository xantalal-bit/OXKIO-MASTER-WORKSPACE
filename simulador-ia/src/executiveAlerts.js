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
  const lowerText =
    text.toLowerCase();

  return keywords.some(keyword =>
    lowerText.includes(keyword)
  );
}

function generateExecutiveAlerts(memory) {
  const decisions =
    memory.decisions || [];

  const priorities =
    memory.priorities || [];

  const goals =
    memory.goals || [];

  const allItems =
    [
      ...decisions,
      ...priorities,
      ...goals
    ]
      .map(normalizeText)
      .filter(Boolean);

  const recentItems =
    allItems.slice(0, 5);

  const olderItems =
    allItems.slice(5);

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
    "memoria"
  ];

  const recentExpansion =
    recentItems.filter(text =>
      containsAny(text, expansionKeywords)
    ).length;

  const recentConsolidation =
    recentItems.filter(text =>
      containsAny(text, consolidationKeywords)
    ).length;

  const olderExpansion =
    olderItems.filter(text =>
      containsAny(text, expansionKeywords)
    ).length;

  const olderConsolidation =
    olderItems.filter(text =>
      containsAny(text, consolidationKeywords)
    ).length;

  const alerts = [];

  if (
    olderExpansion > 0 &&
    recentConsolidation > recentExpansion
  ) {
    alerts.push({
      type: "strategy_shift",
      level: "Alta",
      title: "Cambio de estrategia detectado",
      message:
        "La memoria indica un cambio desde expansión hacia consolidación del núcleo.",
      evidence: {
        olderExpansion,
        recentConsolidation
      },
      recommendation:
        "Validar este cambio y mantener el foco en consolidar motor y memoria antes de expandir funcionalidades."
    });
  }

  if (
    recentExpansion > recentConsolidation &&
    recentConsolidation > 0
  ) {
    alerts.push({
      type: "possible_dispersion",
      level: "Media",
      title: "Posible dispersión estratégica",
      message:
        "La memoria muestra señales simultáneas de expansión y consolidación.",
      evidence: {
        recentExpansion,
        recentConsolidation
      },
      recommendation:
        "Revisar prioridades antes de iniciar nuevas funcionalidades."
    });
  }

  if (
    recentConsolidation >= 3 &&
    recentExpansion === 0
  ) {
    alerts.push({
      type: "consolidation_focus",
      level: "Informativa",
      title: "Foco de consolidación estable",
      message:
        "Las señales recientes apuntan a consolidar motor, memoria y núcleo antes de expandir.",
      evidence: {
        recentConsolidation,
        recentExpansion
      },
      recommendation:
        "Mantener la fase de consolidación antes de añadir nuevas capacidades."
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    alertStatus: "Executive Alerts v1 activo",
    totalAnalyzedItems: allItems.length,
    totalAlerts: alerts.length,
    alerts
  };
}

module.exports = generateExecutiveAlerts;