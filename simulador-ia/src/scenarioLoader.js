const fs = require("fs");
const path = require("path");

function loadScenarios() {

  const scenariosPath =
    path.join(
      __dirname,
      "../data/scenarios-json"
    );

  const files =
    fs.readdirSync(scenariosPath);

  const scenarios = {};

  files.forEach(file => {

    const filePath =
      path.join(scenariosPath, file);

    const rawData =
      fs.readFileSync(filePath, "utf8");

    const scenario =
      JSON.parse(rawData);

    scenarios[scenario.project] =
      scenario;

  });

  return scenarios;
}

module.exports = loadScenarios;