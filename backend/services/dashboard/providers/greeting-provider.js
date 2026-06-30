const CLIENT_ZERO_NAME = "José Antonio";

function getDayPeriod(date) {
  const hour = date.getHours();

  if (hour >= 5 && hour < 12) {
    return "Buenos días";
  }

  if (hour >= 12 && hour < 20) {
    return "Buenas tardes";
  }

  return "Buenas noches";
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatSpanishDate(date) {
  const formatter = new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  return capitalize(formatter.format(date));
}

function getGreeting() {
  const now = new Date();
  const dayPeriod = getDayPeriod(now);

  return {
    title: `${dayPeriod}, ${CLIENT_ZERO_NAME}`,
    subtitle: formatSpanishDate(now),
    source: "system"
  };
}

module.exports = {
  getGreeting
};
