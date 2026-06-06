function normalizeText(item) {
  if (typeof item === "string") {
    return item;
  }

  if (item && item.text) {
    return item.text;
  }

  return "";
}

function detectTheme(text) {
  const value =
    text.toLowerCase();

  if (
    value.includes("expandir") ||
    value.includes("expansión") ||
    value.includes("expansion") ||
    value.includes("módulos") ||
    value.includes("modulos") ||
    value.includes("nuevas funcionalidades")
  ) {
    return "Expansión de funcionalidades";
  }

  if (
    value.includes("consolidar") ||
    value.includes("consolidación") ||
    value.includes("consolidacion") ||
    value.includes("core") ||
    value.includes("núcleo") ||
    value.includes("nucleo") ||
    value.includes("motor") ||
    value.includes("memoria")
  ) {
    return "Consolidación del núcleo";
  }

  if (
    value.includes("prioridad") ||
    value.includes("priorizar") ||
    value.includes("estratégica") ||
    value.includes("estrategica") ||
    value.includes("proyecto a")
  ) {
    return "Priorización estratégica";
  }

  return "Objetivo general";
}

function trackExecutiveGoals(memory) {
  const goals =
    memory.goals || [];

  const priorities =
    memory.priorities || [];

  const decisions =
    memory.decisions || [];

  const timeline =
    [
      ...goals,
      ...priorities,
      ...decisions
    ]
      .map((item, index) => ({
        index,
        text: normalizeText(item),
        type: item.type || "unknown",
        createdAt: item.createdAt || null
      }))
      .filter(item => item.text);

  const themes = {};

  timeline.forEach(item => {
    const theme =
      detectTheme(item.text);

    if (!themes[theme]) {
      themes[theme] = {
        theme,
        totalMentions: 0,
        firstSeenIndex: item.index,
        lastSeenIndex: item.index,
        latestText: item.text
      };
    }

    themes[theme].totalMentions += 1;
    themes[theme].lastSeenIndex = item.index;
    themes[theme].latestText = item.text;
  });

  const totalItems =
    timeline.length;

  const trackedGoals =
    Object.values(themes).map(theme => {
      const distanceFromLatest =
        theme.firstSeenIndex;

      let status = "Activo";

      if (
        theme.lastSeenIndex > 4 &&
        theme.totalMentions === 1
      ) {
        status = "Posiblemente abandonado";
      }

      if (
        theme.totalMentions >= 3
      ) {
        status = "Recurrente";
      }

      return {
        theme: theme.theme,
        totalMentions: theme.totalMentions,
        status,
        latestText: theme.latestText,
        distanceFromLatest,
        recommendation:
          status === "Posiblemente abandonado"
            ? "Confirmar si este objetivo sigue siendo prioritario."
            : status === "Recurrente"
              ? "Mantener seguimiento porque aparece como línea estratégica repetida."
              : "Seguir observando evolución en próximas decisiones."
      };
    });

  return {
    generatedAt: new Date().toISOString(),
    trackerStatus: "Executive Goal Tracker v1 activo",
    totalAnalyzedItems: totalItems,
    trackedGoals
  };
}

module.exports = trackExecutiveGoals;