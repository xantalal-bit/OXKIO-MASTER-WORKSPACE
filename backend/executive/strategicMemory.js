// OXKIO EXECUTIVE STRATEGIC MEMORY V1

const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "strategicMemoryStore.json");

const ALLOWED_TYPES = [
  "LAW",
  "DECISION",
  "ARCHITECTURE",
  "MILESTONE",
  "INITIATIVE"
];

function now() {
  return new Date().toISOString();
}

function createId(type) {
  return `${String(type || "record").toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

function normalizeRecordList(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeType(type) {
  const value = String(type || "").toUpperCase();

  if (!ALLOWED_TYPES.includes(value)) {
    throw new Error(`Tipo de memoria estrategica no permitido: ${type}`);
  }

  return value;
}

function normalizeRecord(input, type) {
  const recordType = normalizeType(type || input.type);
  const timestamp = now();

  return {
    id: input.id || createId(recordType),
    type: recordType,
    title: String(input.title || "").trim(),
    description: String(input.description || "").trim(),
    createdAt: input.createdAt || timestamp,
    tags: normalizeArray(input.tags),
    source: String(input.source || "USER").trim()
  };
}

function normalizeStoredRecord(input) {
  return normalizeRecord(input || {}, input && input.type);
}

function recordMatches(record, query) {
  const terms = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) {
    return true;
  }

  const haystack = [
    record.id,
    record.type,
    record.title,
    record.description,
    record.source,
    ...normalizeArray(record.tags)
  ].join(" ").toLowerCase();

  return terms.every((term) => haystack.includes(term));
}

class ExecutiveStrategicMemory {
  constructor(storePath) {
    this.storePath = storePath || STORE_PATH;
  }

  readStore() {
    try {
      if (!fs.existsSync(this.storePath)) {
        return { version: "1.0", records: [] };
      }

      const data = JSON.parse(fs.readFileSync(this.storePath, "utf8"));

      return {
        version: data.version || "1.0",
        records: normalizeRecordList(data.records).map(normalizeStoredRecord)
      };
    } catch (error) {
      return { version: "1.0", records: [] };
    }
  }

  writeStore(store) {
    const data = {
      version: store.version || "1.0",
      records: normalizeRecordList(store.records)
    };

    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");

    return data;
  }

  addRecord(type, input) {
    const store = this.readStore();
    const record = normalizeRecord(input || {}, type);

    store.records.push(record);
    this.writeStore(store);

    return record;
  }

  addDecision(input) {
    return this.addRecord("DECISION", input);
  }

  addLaw(input) {
    return this.addRecord("LAW", input);
  }

  addArchitectureNote(input) {
    return this.addRecord("ARCHITECTURE", input);
  }

  addMilestone(input) {
    return this.addRecord("MILESTONE", input);
  }

  addInitiative(input) {
    return this.addRecord("INITIATIVE", input);
  }

  listAll() {
    return this.readStore().records;
  }

  search(query) {
    return this.listAll().filter((record) => recordMatches(record, query));
  }
}

module.exports = new ExecutiveStrategicMemory();
module.exports.ExecutiveStrategicMemory = ExecutiveStrategicMemory;
module.exports.ALLOWED_TYPES = ALLOWED_TYPES;
