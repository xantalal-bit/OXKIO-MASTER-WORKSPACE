const fs = require("fs");
const path = require("path");

const historyPath = path.join(__dirname, "../data/history/simulations.json");

function readHistory() {
  if (!fs.existsSync(historyPath)) {
    return [];
  }

  const raw = fs.readFileSync(historyPath, "utf8");

  if (!raw.trim()) {
    return [];
  }

  return JSON.parse(raw);
}

function saveSimulation(entry) {
  const history = readHistory();

  const savedEntry = {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    ...entry
  };

  history.unshift(savedEntry);

  fs.writeFileSync(
    historyPath,
    JSON.stringify(history, null, 2),
    "utf8"
  );

  return savedEntry;
}

function getHistory() {
  return readHistory();
}

function getExecutiveInsights() {

  const history = readHistory();

  if (!history.length) {
    return {
      totalSimulations: 0,
      mostSimulatedProject: null
    };
  }

  const projects = {};

  history.forEach(item => {

    const project =
      item.result &&
      item.result.project
        ? item.result.project
        : "unknown";

    projects[project] =
      (projects[project] || 0) + 1;

  });

  const mostSimulatedProject =
    Object.entries(projects)
      .sort((a, b) => b[1] - a[1])[0][0];

  return {
    totalSimulations: history.length,
    mostSimulatedProject,
    projects
  };
}


module.exports = {
  saveSimulation,
  getHistory,
  getExecutiveInsights
};
