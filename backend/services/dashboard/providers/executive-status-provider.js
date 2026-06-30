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

function getExecutiveStatus() {
  const now = new Date();
  const daySegment = getDaySegment(now);
  const weekend = isWeekend(now);
  const dayType = weekend ? "fin de semana" : "día laborable";

  return {
    title: `Estado ejecutivo: ${dayType}, ${daySegment}`,
    summary: getSummary(daySegment, weekend),
    source: "system"
  };
}

module.exports = {
  getExecutiveStatus
};
