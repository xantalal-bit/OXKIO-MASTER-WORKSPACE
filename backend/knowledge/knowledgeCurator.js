// OXKIO KNOWLEDGE CURATOR V1

const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "knowledgeStore.json");

const CLASSIFICATIONS = [
  "OXKIO",
  "BUSINESS_HUNTER",
  "PROFESOR_IA",
  "GIU",
  "XANTALAL",
  "LEGAL",
  "SECURITY",
  "GENERAL"
];

function now() {
  return new Date().toISOString();
}

function createId() {
  return `knowledge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map((tag) => normalizeText(tag)).filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((tag) => normalizeText(tag)).filter(Boolean);
  }

  return [];
}

function uniqueTags(tags) {
  return tags.reduce((unique, tag) => {
    const exists = unique.some((item) => item.toLowerCase() === tag.toLowerCase());

    if (!exists) {
      unique.push(tag);
    }

    return unique;
  }, []);
}

function normalizeKnowledgeList(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeClassification(value) {
  const classification = String(value || "GENERAL").toUpperCase();

  return CLASSIFICATIONS.includes(classification) ? classification : "GENERAL";
}

function summarizeContent(content) {
  const text = normalizeText(content).replace(/\s+/g, " ");

  if (text.length <= 180) {
    return text;
  }

  return `${text.slice(0, 177).trim()}...`;
}

function normalizeItem(input) {
  const timestamp = now();

  return {
    id: input.id || createId(),
    title: normalizeText(input.title),
    source: normalizeText(input.source || "USER"),
    type: normalizeText(input.type || "NOTE"),
    content: normalizeText(input.content),
    summary: normalizeText(input.summary),
    tags: normalizeTags(input.tags),
    classification: normalizeClassification(input.classification),
    createdAt: input.createdAt || timestamp,
    updatedAt: input.updatedAt || timestamp
  };
}

function buildSearchCorpus(item) {
  return normalizeSearchText([
    item.id,
    item.title,
    item.source,
    item.type,
    item.content,
    item.summary,
    item.classification,
    ...normalizeTags(item.tags)
  ].join(" "));
}

class KnowledgeCurator {
  constructor(storePath) {
    this.storePath = storePath || STORE_PATH;
  }

  readStore() {
    try {
      if (!fs.existsSync(this.storePath)) {
        return { version: "1.0", knowledge: [] };
      }

      const data = JSON.parse(fs.readFileSync(this.storePath, "utf8"));

      return {
        version: data.version || "1.0",
        knowledge: normalizeKnowledgeList(data.knowledge).map(normalizeItem)
      };
    } catch (error) {
      return { version: "1.0", knowledge: [] };
    }
  }

  writeStore(store) {
    const data = {
      version: store.version || "1.0",
      knowledge: normalizeKnowledgeList(store.knowledge)
    };

    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");

    return data;
  }

  classifyItem(item) {
    const text = normalizeSearchText([
      item.title,
      item.type,
      item.content,
      item.summary,
      item.source
    ].join(" "));

    if (text.includes("oxkio")) {
      return "OXKIO";
    }

    if (text.includes("business hunter")) {
      return "BUSINESS_HUNTER";
    }

    if (text.includes("profesor ia")) {
      return "PROFESOR_IA";
    }

    if (text.includes("legal") || text.includes("rgpd") || text.includes("ai act")) {
      return "LEGAL";
    }

    if (
      text.includes("seguridad") ||
      text.includes("backup") ||
      text.includes("token") ||
      text.includes("permiso")
    ) {
      return "SECURITY";
    }

    return "GENERAL";
  }

  summarizeItem(item) {
    return summarizeContent(item.content);
  }

  tagItem(item) {
    const tags = normalizeTags(item.tags);
    const classification = item.classification || this.classifyItem(item);

    tags.push(classification.toLowerCase());

    if (item.type) {
      tags.push(normalizeText(item.type).toLowerCase());
    }

    return uniqueTags(tags);
  }

  detectDuplicate(item) {
    const normalizedItem = normalizeItem(item || {});
    const store = this.readStore();
    const title = normalizeSearchText(normalizedItem.title);
    const content = normalizeSearchText(normalizedItem.content);

    return store.knowledge.find((storedItem) => {
      return (
        normalizeSearchText(storedItem.title) === title &&
        normalizeSearchText(storedItem.content) === content
      );
    }) || null;
  }

  ingestItem(item) {
    const normalizedItem = normalizeItem(item || {});
    const duplicate = this.detectDuplicate(normalizedItem);

    if (duplicate) {
      return duplicate;
    }

    normalizedItem.classification = this.classifyItem(normalizedItem);
    normalizedItem.summary = normalizedItem.summary || this.summarizeItem(normalizedItem);
    normalizedItem.tags = this.tagItem(normalizedItem);
    normalizedItem.updatedAt = now();

    const store = this.readStore();
    store.knowledge.push(normalizedItem);
    this.writeStore(store);

    return normalizedItem;
  }

  listKnowledge() {
    return this.readStore().knowledge;
  }

  searchKnowledge(query) {
    const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);

    if (terms.length === 0) {
      return this.listKnowledge();
    }

    return this.listKnowledge().filter((item) => {
      const corpus = buildSearchCorpus(item);

      return terms.every((term) => corpus.includes(term));
    });
  }

  getStatus() {
    const knowledge = this.listKnowledge();
    const byClassification = CLASSIFICATIONS.reduce((counts, classification) => {
      counts[classification] = knowledge.filter((item) => item.classification === classification).length;

      return counts;
    }, {});

    return {
      name: "KnowledgeCurator",
      version: "1.0",
      totalItems: knowledge.length,
      classifications: CLASSIFICATIONS.slice(),
      byClassification
    };
  }
}

module.exports = new KnowledgeCurator();
module.exports.KnowledgeCurator = KnowledgeCurator;
module.exports.CLASSIFICATIONS = CLASSIFICATIONS;
