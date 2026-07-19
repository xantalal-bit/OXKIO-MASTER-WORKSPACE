const DEGRADED_SOURCES = new Set(["mock", "fallback", "unavailable"]);

function isWeekend(date) {
  const day = date.getDay();

  return day === 0 || day === 6;
}

function getDaySegment(date) {
  const hour = date.getHours();

  if (hour >= 5 && hour < 12) {
    return "mañana";
  }

  if (hour >= 12 && hour < 20) {
    return "tarde";
  }

  return "noche";
}

function getSummary(daySegment, weekend) {
  if (weekend) {
    return "Fin de semana. Mantén una revisión ligera y prepara el próximo bloque de trabajo.";
  }

  if (daySegment === "mañana") {
    return "Comienza la jornada. Es un buen momento para revisar las prioridades del día.";
  }

  if (daySegment === "tarde") {
    return "La tarde está avanzada. Revisa el estado de las tareas pendientes.";
  }

  return "Finaliza la jornada. Es un buen momento para preparar el día siguiente.";
}

function getHealth(availability) {
  if (!availability || typeof availability !== "object") {
    return "unknown";
  }

  if (availability.operational === false || availability.criticalError === true) {
    return "critical";
  }

  if (availability.operational !== true) {
    return "unknown";
  }

  const sources = Array.isArray(availability.sources) ? availability.sources : [];
  const degraded = sources.some((source) => {
    if (!source || typeof source !== "object") return true;
    return source.available === false || DEGRADED_SOURCES.has(source.source);
  });

  return degraded ? "warning" : "healthy";
}

function getExecutiveStatus(availability) {
  const now = new Date();
  const daySegment = getDaySegment(now);
  const weekend = isWeekend(now);

  return {
    title: "Estado general",
    summary: getSummary(daySegment, weekend),
    health: getHealth(availability),
    source: "system"
  };
}

module.exports = {
  getHealth,
  getExecutiveStatus
};
