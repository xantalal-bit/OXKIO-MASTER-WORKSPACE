// OXKIO SECURITY INVENTORY V1

const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "securityInventoryStore.json");

const ALLOWED_TYPES = [
  "REPOSITORY",
  "BACKUP",
  "DOCUMENTATION",
  "CREDENTIAL",
  "DOMAIN",
  "CLOUD_STORAGE",
  "LOCAL_FOLDER",
  "KNOWLEDGE_BASE",
  "PRODUCT"
];

const ALLOWED_RISKS = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL"
];

const SECRET_FIELD_PATTERN = /(password|passwd|pwd|token|secret|credentialValue|apiKey|accessKey|privateKey|clientSecret)/i;
const SECRET_VALUE_PATTERN = /(bearer\s+|sk-[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9_]{12,}|xox[baprs]-|-----BEGIN\s+(RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE KEY-----)/i;

function now() {
  return new Date().toISOString();
}

function createId() {
  return `security-asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeSearchText(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeType(type) {
  const value = normalizeText(type || "PRODUCT").toUpperCase();

  return ALLOWED_TYPES.includes(value) ? value : "PRODUCT";
}

function normalizeRiskLevel(riskLevel) {
  const value = normalizeText(riskLevel || "MEDIUM").toUpperCase();

  return ALLOWED_RISKS.includes(value) ? value : "MEDIUM";
}

function normalizeNotes(notes) {
  if (Array.isArray(notes)) {
    return notes.map((note) => normalizeText(note)).filter(Boolean);
  }

  const text = normalizeText(notes);

  return text ? [text] : [];
}

function normalizeAsset(input) {
  const timestamp = now();

  return {
    id: input.id || createId(),
    name: normalizeText(input.name),
    type: normalizeType(input.type),
    location: normalizeText(input.location),
    owner: normalizeText(input.owner),
    protection: normalizeText(input.protection),
    backupStatus: normalizeText(input.backupStatus),
    riskLevel: normalizeRiskLevel(input.riskLevel),
    notes: normalizeNotes(input.notes),
    createdAt: input.createdAt || timestamp,
    updatedAt: input.updatedAt || timestamp
  };
}

function normalizeAssetList(value) {
  return Array.isArray(value) ? value : [];
}

function containsSecretField(input) {
  return Object.keys(input || {}).some((key) => SECRET_FIELD_PATTERN.test(key));
}

function containsSecretValue(input) {
  const values = [
    input.name,
    input.location,
    input.owner,
    input.protection,
    input.backupStatus,
    input.notes
  ];

  return values.some((value) => {
    if (Array.isArray(value)) {
      return value.some((item) => SECRET_VALUE_PATTERN.test(normalizeText(item)));
    }

    return SECRET_VALUE_PATTERN.test(normalizeText(value));
  });
}

function assertNoSecretMaterial(input) {
  if (containsSecretField(input) || containsSecretValue(input || {})) {
    throw new Error("SecurityInventory does not store passwords, tokens, or secret credential values.");
  }
}

function sameAsset(a, b) {
  return normalizeSearchText(a.name) === normalizeSearchText(b.name)
    && normalizeSearchText(a.type) === normalizeSearchText(b.type)
    && normalizeSearchText(a.location) === normalizeSearchText(b.location);
}

function buildSearchCorpus(asset) {
  return normalizeSearchText([
    asset.id,
    asset.name,
    asset.type,
    asset.location,
    asset.owner,
    asset.protection,
    asset.backupStatus,
    asset.riskLevel,
    ...normalizeNotes(asset.notes)
  ].join(" "));
}

class SecurityInventory {
  constructor(storePath) {
    this.storePath = storePath || STORE_PATH;
  }

  readStore() {
    try {
      if (!fs.existsSync(this.storePath)) {
        return { version: "1.0", assets: [] };
      }

      const data = JSON.parse(fs.readFileSync(this.storePath, "utf8"));

      return {
        version: data.version || "1.0",
        assets: normalizeAssetList(data.assets).map(normalizeAsset)
      };
    } catch (error) {
      return { version: "1.0", assets: [] };
    }
  }

  writeStore(store) {
    const data = {
      version: store.version || "1.0",
      assets: normalizeAssetList(store.assets)
    };

    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");

    return data;
  }

  addAsset(asset) {
    const input = asset || {};
    assertNoSecretMaterial(input);

    const normalizedAsset = normalizeAsset(input);
    const store = this.readStore();
    const duplicate = store.assets.find((item) => sameAsset(item, normalizedAsset));

    if (duplicate) {
      return duplicate;
    }

    store.assets.push(normalizedAsset);
    this.writeStore(store);

    return normalizedAsset;
  }

  listAssets() {
    return this.readStore().assets;
  }

  searchAssets(query) {
    const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);

    if (terms.length === 0) {
      return this.listAssets();
    }

    return this.listAssets().filter((asset) => {
      const corpus = buildSearchCorpus(asset);

      return terms.every((term) => corpus.includes(term));
    });
  }

  getStatus() {
    const assets = this.listAssets();
    const byType = ALLOWED_TYPES.reduce((counts, type) => {
      counts[type] = assets.filter((asset) => asset.type === type).length;

      return counts;
    }, {});
    const byRiskLevel = ALLOWED_RISKS.reduce((counts, riskLevel) => {
      counts[riskLevel] = assets.filter((asset) => asset.riskLevel === riskLevel).length;

      return counts;
    }, {});

    return {
      name: "SecurityInventory",
      version: "1.0",
      totalAssets: assets.length,
      allowedTypes: ALLOWED_TYPES.slice(),
      allowedRiskLevels: ALLOWED_RISKS.slice(),
      highRiskAssets: this.getHighRiskAssets().length,
      byType,
      byRiskLevel
    };
  }

  getHighRiskAssets() {
    return this.listAssets().filter((asset) => {
      return asset.riskLevel === "HIGH" || asset.riskLevel === "CRITICAL";
    });
  }
}

module.exports = new SecurityInventory();
module.exports.SecurityInventory = SecurityInventory;
module.exports.ALLOWED_TYPES = ALLOWED_TYPES;
module.exports.ALLOWED_RISKS = ALLOWED_RISKS;
