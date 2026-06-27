// OXKIO SECURITY AUDITOR V1

const securityInventory = require("./securityInventory");

const ALLOWED_STATUSES = [
  "OK",
  "WARNING",
  "CRITICAL"
];

const CRITICAL_RISKS = [
  "HIGH",
  "CRITICAL"
];

function now() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeStatus(status) {
  const value = normalizeText(status || "OK").toUpperCase();

  return ALLOWED_STATUSES.includes(value) ? value : "WARNING";
}

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

function isPositive(value) {
  if (typeof value === "boolean") {
    return value;
  }

  const text = normalizeText(value).toLowerCase();

  return ["ok", "true", "yes", "si", "active", "available", "protected", "clean"].includes(text);
}

function createFinding(status, area, message, details) {
  return {
    status: normalizeStatus(status),
    area,
    message,
    details: details || {}
  };
}

function highestStatus(findings) {
  if (findings.some((finding) => finding.status === "CRITICAL")) {
    return "CRITICAL";
  }

  if (findings.some((finding) => finding.status === "WARNING")) {
    return "WARNING";
  }

  return "OK";
}

function getInventoryFromContext(context) {
  if (context && context.securityInventory) {
    return context.securityInventory;
  }

  return securityInventory;
}

function getInventoryAssets(inventory) {
  if (!inventory) {
    return [];
  }

  if (typeof inventory.listAssets === "function") {
    return normalizeList(inventory.listAssets());
  }

  if (Array.isArray(inventory.assets)) {
    return inventory.assets;
  }

  return [];
}

function getHighRiskAssets(inventory, assets) {
  if (inventory && typeof inventory.getHighRiskAssets === "function") {
    return normalizeList(inventory.getHighRiskAssets());
  }

  return normalizeList(assets).filter((asset) => {
    return CRITICAL_RISKS.includes(normalizeText(asset.riskLevel).toUpperCase());
  });
}

class SecurityAuditor {
  constructor(inventory) {
    this.inventory = inventory || securityInventory;
    this.lastAudit = null;
  }

  audit(context) {
    const auditContext = context || {};
    const inventory = auditContext.securityInventory || this.inventory || getInventoryFromContext(auditContext);
    const findings = [];
    const recommendations = [];
    const assets = getInventoryAssets(inventory);
    const highRiskAssets = getHighRiskAssets(inventory, assets);

    this.auditInventory(assets, findings, recommendations);
    this.auditBackups(assets, auditContext, findings, recommendations);
    this.auditRepository(auditContext.repositoryStatus, findings, recommendations);
    this.auditHighRiskAssets(highRiskAssets, findings, recommendations);
    this.auditProtectedStores(auditContext.protectedStores, findings, recommendations);

    const result = {
      overallStatus: highestStatus(findings),
      findings,
      recommendations,
      checkedAt: now()
    };

    this.lastAudit = result;

    return result;
  }

  auditInventory(assets, findings, recommendations) {
    if (assets.length === 0) {
      findings.push(createFinding(
        "WARNING",
        "SECURITY_INVENTORY",
        "Security inventory has no registered assets."
      ));
      recommendations.push("Register the critical digital assets in SecurityInventory.");
      return;
    }

    findings.push(createFinding(
      "OK",
      "SECURITY_INVENTORY",
      "Security inventory is available.",
      { totalAssets: assets.length }
    ));
  }

  auditBackups(assets, context, findings, recommendations) {
    const backupAssets = assets.filter((asset) => normalizeText(asset.type).toUpperCase() === "BACKUP");
    const contextBackups = normalizeList(context.backups);
    const hasBackup = backupAssets.length > 0 || contextBackups.length > 0 || isPositive(context.backupsExist);

    if (!hasBackup) {
      findings.push(createFinding(
        "CRITICAL",
        "BACKUPS",
        "No backup evidence was provided."
      ));
      recommendations.push("Register at least one backup asset or provide backup evidence in the audit context.");
      return;
    }

    const weakBackups = backupAssets.filter((asset) => {
      const status = normalizeText(asset.backupStatus).toLowerCase();

      return !status || status.includes("pending") || status.includes("missing") || status.includes("none");
    });

    if (weakBackups.length > 0) {
      findings.push(createFinding(
        "WARNING",
        "BACKUPS",
        "Some backup assets do not report a healthy backup status.",
        { affectedAssets: weakBackups.map((asset) => asset.name) }
      ));
      recommendations.push("Review backupStatus for registered backup assets and confirm restore procedures.");
      return;
    }

    findings.push(createFinding(
      "OK",
      "BACKUPS",
      "Backup evidence is present.",
      { registeredBackupAssets: backupAssets.length, contextBackups: contextBackups.length }
    ));
  }

  auditRepository(repositoryStatus, findings, recommendations) {
    if (!repositoryStatus) {
      findings.push(createFinding(
        "WARNING",
        "REPOSITORY",
        "Repository status was not provided in audit context."
      ));
      recommendations.push("Pass repositoryStatus in the audit context; do not execute git from the auditor.");
      return;
    }

    if (repositoryStatus.hasUncommittedChanges || repositoryStatus.dirty) {
      findings.push(createFinding(
        "WARNING",
        "REPOSITORY",
        "Repository status reports uncommitted changes.",
        { branch: repositoryStatus.branch || "" }
      ));
      recommendations.push("Review pending repository changes before security-sensitive releases.");
      return;
    }

    findings.push(createFinding(
      "OK",
      "REPOSITORY",
      "Repository context reports a clean state.",
      { branch: repositoryStatus.branch || "" }
    ));
  }

  auditHighRiskAssets(highRiskAssets, findings, recommendations) {
    if (highRiskAssets.length === 0) {
      findings.push(createFinding(
        "OK",
        "HIGH_RISK_ASSETS",
        "No HIGH or CRITICAL assets were found."
      ));
      return;
    }

    const criticalAssets = highRiskAssets.filter((asset) => {
      return normalizeText(asset.riskLevel).toUpperCase() === "CRITICAL";
    });

    findings.push(createFinding(
      criticalAssets.length > 0 ? "CRITICAL" : "WARNING",
      "HIGH_RISK_ASSETS",
      "HIGH or CRITICAL assets require explicit review.",
      { affectedAssets: highRiskAssets.map((asset) => asset.name) }
    ));
    recommendations.push("Define owner, protection, and backupStatus for every HIGH or CRITICAL asset.");
  }

  auditProtectedStores(protectedStores, findings, recommendations) {
    const stores = normalizeList(protectedStores);

    if (stores.length === 0) {
      findings.push(createFinding(
        "WARNING",
        "PROTECTED_STORES",
        "No protected stores were provided in audit context."
      ));
      recommendations.push("Provide protectedStores with name and protected status in the audit context.");
      return;
    }

    const unprotectedStores = stores.filter((store) => !isPositive(store.protected));

    if (unprotectedStores.length > 0) {
      findings.push(createFinding(
        "CRITICAL",
        "PROTECTED_STORES",
        "One or more stores are not protected.",
        { affectedStores: unprotectedStores.map((store) => store.name || store.path || "unknown") }
      ));
      recommendations.push("Protect every store that contains operational, security, or governance data.");
      return;
    }

    findings.push(createFinding(
      "OK",
      "PROTECTED_STORES",
      "All provided stores are marked as protected.",
      { totalStores: stores.length }
    ));
  }

  getStatus() {
    return {
      name: "SecurityAuditor",
      version: "1.0",
      allowedStatuses: ALLOWED_STATUSES.slice(),
      hasLastAudit: Boolean(this.lastAudit),
      lastOverallStatus: this.lastAudit ? this.lastAudit.overallStatus : null,
      lastCheckedAt: this.lastAudit ? this.lastAudit.checkedAt : null
    };
  }
}

module.exports = new SecurityAuditor();
module.exports.SecurityAuditor = SecurityAuditor;
module.exports.ALLOWED_STATUSES = ALLOWED_STATUSES;
