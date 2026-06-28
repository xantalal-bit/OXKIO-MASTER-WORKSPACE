const ecosystemConfig = require("./ecosystemConfig");

function getEcosystemName() {
  return ecosystemConfig.ecosystemName;
}

function getEcosystemRoot() {
  return ecosystemConfig.ecosystemRoot;
}

function getGovernanceFolder() {
  return ecosystemConfig.ecosystemRoot + "\\" + ecosystemConfig.governanceFolder;
}

function getGovernanceFiles() {
  return ecosystemConfig.governanceFiles;
}

function getConfiguration() {
  return {
    ecosystemName: ecosystemConfig.ecosystemName,
    ecosystemRoot: ecosystemConfig.ecosystemRoot,
    governanceFolder: getGovernanceFolder(),
    governanceFiles: ecosystemConfig.governanceFiles,
  };
}

module.exports = {
  getEcosystemName,
  getEcosystemRoot,
  getGovernanceFolder,
  getGovernanceFiles,
  getConfiguration,
};
