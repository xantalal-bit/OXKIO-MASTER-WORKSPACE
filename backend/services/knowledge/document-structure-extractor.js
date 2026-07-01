'use strict';

function extractDocumentStructure(knowledgeObject) {
  const raw = knowledgeObject && knowledgeObject.content
    ? knowledgeObject.content.raw
    : '';

  if (typeof raw !== 'string' || raw.length === 0) {
    return {
      headings: [],
      lists: [],
      links: [],
      tables: [],
      codeBlocks: [],
    };
  }

  const headings = [];
  const lists = [];
  const links = [];
  const tables = [];
  const codeBlocks = [];
  const lines = raw.split(/\r?\n/);
  let currentCodeBlock = null;
  let currentTable = null;

  function flushTable() {
    if (currentTable) {
      tables.push(currentTable);
      currentTable = null;
    }
  }

  function isTableSeparator(line) {
    return /^\s*\|?[\s:-]+(\|[\s:-]+)+\|?\s*$/.test(line);
  }

  function isTableRow(line) {
    return /^\s*\|.*\|\s*$/.test(line) && line.split('|').length >= 3;
  }

  function extractLinks(line) {
    const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    const rawUrlPattern = /(https?:\/\/[^\s<>"')\]]+)/g;
    const found = [];
    let match;

    while ((match = markdownLinkPattern.exec(line)) !== null) {
      found.push(match[2]);
    }

    while ((match = rawUrlPattern.exec(line)) !== null) {
      found.push(match[1]);
    }

    return Array.from(new Set(found));
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^```(.*)$/);

    if (fenceMatch) {
      flushTable();

      if (currentCodeBlock) {
        codeBlocks.push(currentCodeBlock);
        currentCodeBlock = null;
      } else {
        currentCodeBlock = {
          language: String(fenceMatch[1] || '').trim() || null,
          code: [],
        };
      }

      continue;
    }

    if (currentCodeBlock) {
      currentCodeBlock.code.push(line);
      continue;
    }

    if (currentTable) {
      if (line.trim() === '') {
        flushTable();
        continue;
      }

      if (isTableRow(line)) {
        currentTable.rowCount += 1;
        continue;
      }

      flushTable();
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);

    if (headingMatch) {
      flushTable();

      headings.push({
        level: headingMatch[1].length,
        title: headingMatch[2].trim(),
      });
      continue;
    }

    const listMatch = line.match(/^\s*[-*]\s+(.*)$/);

    if (listMatch) {
      flushTable();

      lists.push({
        text: listMatch[1].trim(),
      });
      continue;
    }

    const lineLinks = extractLinks(line);

    if (lineLinks.length > 0) {
      lineLinks.forEach((url) => {
        links.push({ url });
      });
    }

    if (isTableRow(line)) {
      const nextLine = lines[index + 1];

      if (nextLine && isTableSeparator(nextLine)) {
        flushTable();

        const columns = line
          .split('|')
          .map((part) => part.trim())
          .filter(Boolean);

        currentTable = {
          columnCount: columns.length,
          rowCount: 1,
        };
      }
    }
  }

  flushTable();

  if (currentCodeBlock) {
    codeBlocks.push(currentCodeBlock);
  }

  return {
    headings,
    lists,
    links,
    tables,
    codeBlocks: codeBlocks.map((block) => ({
      language: block.language,
      code: block.code.join('\n'),
    })),
  };
}

module.exports = {
  extractDocumentStructure,
};
