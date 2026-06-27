// OXKIO GOVERNANCE READER V1
// Lee los documentos oficiales del Ecosistema XANTALAL

const fs = require("fs");
const path = require("path");

const GOVERNANCE_PATH = path.join(
  "C:",
  "Users",
  "janta",
  "OneDrive",
  "Documentos",
  "XANTALAL",
  "00_GOVERNANCE"
);

const FILES = {
  manual: "MANUAL_DE_GOBIERNO_XANTALAL.md",
  decisions: "DECISIONES_APROBADAS.md",
  roadmap: "ROADMAP_GENERAL.md",
  organigram: "ORGANIGRAMA.md",
  agents: "AGENTES.md"
};

const DEFAULT_SUMMARY = {
  ecosystem: "XANTALAL",
  version: "1.0",
  owner: "JosÃ© Antonio Ãlvarez"
};

function readFileSafe(filename) {
  const filePath = path.join(GOVERNANCE_PATH, filename);

  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      filename,
      content: "",
      error: "Archivo no encontrado"
    };
  }

  return {
    ok: true,
    filename,
    content: fs.readFileSync(filePath, "utf8")
  };
}

function normalizeMarkdown(content) {
  return String(content || "")
    .replace(/\r\n/g, "\n")
    .replace(/\\([#*_.,-])/g, "$1")
    .replace(/&#x20;/g, " ")
    .trim();
}

function compactText(value) {
  return String(value || "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function removeMarkdownListPrefix(line) {
  return compactText(
    String(line || "")
      .replace(/^\s*[-*]\s+/, "")
      .replace(/^\s*\d+\.\s+/, "")
  );
}

function firstMatch(content, patterns, fallback) {
  for (const pattern of patterns) {
    const match = content.match(pattern);

    if (match && match[1]) {
      return compactText(match[1]);
    }
  }

  return fallback;
}

function sectionBetween(content, startPattern, endPattern) {
  const startMatch = content.match(startPattern);

  if (!startMatch || typeof startMatch.index !== "number") {
    return "";
  }

  const startIndex = startMatch.index + startMatch[0].length;
  const rest = content.slice(startIndex);
  const endMatch = rest.match(endPattern);

  return endMatch && typeof endMatch.index === "number"
    ? rest.slice(0, endMatch.index).trim()
    : rest.trim();
}

function linesFromBlock(block) {
  return String(block || "")
    .split("\n")
    .map(removeMarkdownListPrefix)
    .filter(Boolean)
    .filter((line) => line !== "---")
    .filter((line) => !line.startsWith("#"));
}

function extractStatus(block) {
  return firstMatch(
    block,
    [
      /\*\*Estado(?: del documento)?:\*\*\s*([^\n]+)/i,
      /^Estado:\s*([^\n]+)/im
    ],
    ""
  );
}

function extractProducts(organigramContent, manualContent) {
  const source = sectionBetween(
    organigramContent,
    /^# PRODUCTOS\s*$/im,
    /^# ARQUITECTURA DE OXKIO\s*$/im
  );
  const products = [];
  const productPattern = /^##\s+(.+?)\s*$([\s\S]*?)(?=^---\s*$|^##\s+|(?![\s\S]))/gim;
  let match;

  while ((match = productPattern.exec(source)) !== null) {
    const name = compactText(match[1]);
    const description = linesFromBlock(match[2]).join(" ");

    if (name) {
      products.push({ name, description });
    }
  }

  if (products.length > 0) {
    return products;
  }

  const fallbackSource = sectionBetween(
    manualContent,
    /^## Productos del ecosistema\s*$/im,
    /^---\s*$/im
  );

  return linesFromBlock(fallbackSource).map((name) => ({ name, description: "" }));
}

function extractPriorities(roadmapContent) {
  const priorities = [];
  const priorityPattern =
    /^## PRIORIDAD\s+(\d+)\s*$\s*^###\s+(.+?)\s*$([\s\S]*?)(?=^---\s*$|^## PRIORIDAD\s+\d+|^#\s+)/gim;
  let match;

  while ((match = priorityPattern.exec(roadmapContent)) !== null) {
    const priority = Number(match[1]);
    const product = compactText(match[2]);
    const block = match[3] || "";
    const objectiveBlock = sectionBetween(
      block,
      /^Objetivo:\s*$/im,
      /^\*\*Estado:\*\*|^Estado:/im
    );

    priorities.push({
      priority,
      product,
      status: extractStatus(block),
      objective: linesFromBlock(objectiveBlock)
    });
  }

  return priorities;
}

function extractAgentField(block, labels) {
  for (const label of labels) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const singleLinePattern = new RegExp(`^\\*\\*${escapedLabel}:?\\*\\*\\s*([^\\n]+)`, "im");
    const plainLinePattern = new RegExp(`^${escapedLabel}:\\s*([^\\n]+)`, "im");
    const blockPattern = new RegExp(
      `^\\*\\*${escapedLabel}\\*\\*\\s*$([\\s\\S]*?)(?=^\\*\\*[^\\n]+\\*\\*|^Estado:|^Prioridad:|^Funciones|^Responsabilidad|^---\\s*$|^###\\s+)`,
      "im"
    );
    const plainBlockPattern = new RegExp(
      `^${escapedLabel}:\\s*$([\\s\\S]*?)(?=^\\*\\*[^\\n]+\\*\\*|^Estado:|^Prioridad:|^Funciones|^Responsabilidad|^---\\s*$|^###\\s+)`,
      "im"
    );

    const singleLineMatch = block.match(singleLinePattern) || block.match(plainLinePattern);

    if (singleLineMatch && singleLineMatch[1]) {
      return compactText(singleLineMatch[1]);
    }

    const blockMatch = block.match(blockPattern) || block.match(plainBlockPattern);

    if (blockMatch && blockMatch[1]) {
      return linesFromBlock(blockMatch[1]).join(" ");
    }
  }

  return "";
}

function extractAgents(agentsContent) {
  const agents = [];
  const categoryPattern =
    /^##\s+(?:\d+\.\s+)?(.+?)\s*$([\s\S]*?)(?=^##\s+(?:\d+\.\s+)?|^# PRINCIPIOS\s*$|^# AUTORIDAD\s*$)/gim;
  let categoryMatch;

  while ((categoryMatch = categoryPattern.exec(agentsContent)) !== null) {
    const category = compactText(categoryMatch[1]);
    const categoryBlock = categoryMatch[2] || "";
    const agentPattern = /^###\s+(.+?)\s*$([\s\S]*?)(?=^---\s*$|^###\s+|^##\s+|^#\s+)/gim;
    let agentMatch;

    while ((agentMatch = agentPattern.exec(categoryBlock)) !== null) {
      const name = compactText(agentMatch[1]);
      const block = agentMatch[2] || "";

      if (name) {
        agents.push({
          name,
          category,
          status: extractAgentField(block, ["Estado"]),
          priority: extractAgentField(block, ["Prioridad"]),
          responsibility: extractAgentField(block, ["Responsabilidad", "Funciones", "Funciones previstas"])
        });
      }
    }
  }

  return agents;
}

function extractDecisions(decisionsContent) {
  const decisions = [];
  const decisionPattern =
    /^## DECISI(?:Ó|Ã“|O)N\s+(\d+)\s*$([\s\S]*?)(?=^---\s*$\s*^## DECISI(?:Ó|Ã“|O)N\s+\d+|^# HIST(?:Ó|Ã“|O)RICO\s*$)/gim;
  let match;

  while ((match = decisionPattern.exec(decisionsContent)) !== null) {
    const number = match[1];
    const block = match[2] || "";
    const description = sectionBetween(
      block,
      /^### Descripci(?:ó|Ã³|o)n\s*$/im,
      /^\*\*Sustituye a:\*\*|^---\s*$/im
    );

    decisions.push({
      id: `DECISION-${number}`,
      number,
      date: firstMatch(block, [/^\*\*Fecha:\*\*\s*([^\n]+)/im], ""),
      status: extractStatus(block),
      project: firstMatch(block, [/^\*\*Proyecto:\*\*\s*([^\n]+)/im], ""),
      description: linesFromBlock(description).join(" "),
      replaces: firstMatch(block, [/^\*\*Sustituye a:\*\*\s*([^\n]+)/im], "")
    });
  }

  return decisions;
}

function buildDocumentsStatus(documents) {
  return Object.keys(documents).reduce((status, key) => {
    const document = documents[key];

    status[key] = {
      filename: document.filename,
      ok: Boolean(document.ok),
      error: document.error || null
    };

    return status;
  }, {});
}

function readGovernance() {
  return {
    ecosystem: "XANTALAL",
    version: "1.0",
    owner: "José Antonio Álvarez",
    sourcePath: GOVERNANCE_PATH,
    loadedAt: new Date().toISOString(),
    documents: {
      manual: readFileSafe(FILES.manual),
      decisions: readFileSafe(FILES.decisions),
      roadmap: readFileSafe(FILES.roadmap),
      organigram: readFileSafe(FILES.organigram),
      agents: readFileSafe(FILES.agents)
    }
  };
}

function readGovernanceSummary() {
  try {
    const governance = readGovernance();
    const documents = governance.documents || {};
    const manual = normalizeMarkdown(documents.manual && documents.manual.content);
    const decisions = normalizeMarkdown(documents.decisions && documents.decisions.content);
    const roadmap = normalizeMarkdown(documents.roadmap && documents.roadmap.content);
    const organigram = normalizeMarkdown(documents.organigram && documents.organigram.content);
    const agents = normalizeMarkdown(documents.agents && documents.agents.content);

    return {
      ecosystem: governance.ecosystem || DEFAULT_SUMMARY.ecosystem,
      version: firstMatch(
        manual || decisions || roadmap || organigram || agents,
        [
          /\*\*Versi(?:ó|Ã³|o)n:\*\*\s*([^\n]+)/i,
          /^## Versi(?:ó|Ã³|o)n\s+([^\n]+)/im
        ],
        governance.version || DEFAULT_SUMMARY.version
      ),
      owner: firstMatch(
        `${manual}\n${decisions}\n${organigram}`,
        [
          /\*\*Propietario del Ecosistema:\*\*\s*([^\n]+)/i,
          /\*\*Propietario del Ecosistema:\*\*\s*\n\s*([^\n]+)/i,
          /propietario y m(?:á|Ã¡|a)xima autoridad[^:]*:\s*\n\s*([^\n]+)/i
        ],
        governance.owner || DEFAULT_SUMMARY.owner
      ),
      sourcePath: governance.sourcePath || GOVERNANCE_PATH,
      loadedAt: governance.loadedAt || new Date().toISOString(),
      documentsStatus: buildDocumentsStatus(documents),
      products: extractProducts(organigram, manual),
      priorities: extractPriorities(roadmap),
      agents: extractAgents(agents),
      decisions: extractDecisions(decisions)
    };
  } catch (error) {
    return {
      ecosystem: DEFAULT_SUMMARY.ecosystem,
      version: DEFAULT_SUMMARY.version,
      owner: DEFAULT_SUMMARY.owner,
      sourcePath: GOVERNANCE_PATH,
      loadedAt: new Date().toISOString(),
      documentsStatus: {},
      products: [],
      priorities: [],
      agents: [],
      decisions: []
    };
  }
}

module.exports = {
  readGovernance,
  readGovernanceSummary
};

// Prueba manual:
// node -e "const { readGovernanceSummary } = require('./backend/governance/governanceReader'); console.log(JSON.stringify(readGovernanceSummary(), null, 2));"
