const fs = require("fs");
const path = require("path");

const exportsPath = path.join(
  __dirname,
  "..",
  "exports"
);

const files = fs
  .readdirSync(exportsPath)
  .filter(file => file.endsWith(".json"));

if (files.length === 0) {
  console.log("No hay simulaciones exportadas.");
  process.exit();
}

const latestFile = files
  .map(file => ({
    name: file,
    time: fs.statSync(
      path.join(exportsPath, file)
    ).mtime.getTime()
  }))
  .sort((a, b) => b.time - a.time)[0];

const latestPath = path.join(
  exportsPath,
  latestFile.name
);

const content = fs.readFileSync(
  latestPath,
  "utf8"
);

console.log("Última simulación:");
console.log(latestFile.name);
console.log(content);