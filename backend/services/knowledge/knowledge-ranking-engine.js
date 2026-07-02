'use strict';

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function splitTerms(value) {
  return normalizeText(value)
    .split(/[^a-z0-9]+/g)
    .filter((term) => term.length > 2);
}

function uniqueTerms(values) {
  return Array.from(new Set(values.filter(Boolean).map(normalizeText).filter(Boolean)));
}

function getKnowledgeObjectId(knowledgeObject, index) {
  if (!knowledgeObject || typeof knowledgeObject !== 'object') {
    return `knowledge-object-${index}`;
  }

  return (
    knowledgeObject.id
    || (knowledgeObject.identity && knowledgeObject.identity.id)
    || (knowledgeObject.identity && knowledgeObject.identity.path)
    || `knowledge-object-${index}`
  );
}

function getDocumentType(knowledgeObject) {
  const metadata = knowledgeObject && knowledgeObject.metadata ? knowledgeObject.metadata : {};
  const classification = metadata.documentTypeClassification || {};

  return normalizeText(classification.type || '');
}

function getName(knowledgeObject) {
  const identity = knowledgeObject && knowledgeObject.identity ? knowledgeObject.identity : {};

  return normalizeText(identity.name || '');
}

function getProjectValues(knowledgeObject) {
  const strategy = knowledgeObject && knowledgeObject.strategy ? knowledgeObject.strategy : {};
  const identity = knowledgeObject && knowledgeObject.identity ? knowledgeObject.identity : {};

  return uniqueTerms([
    strategy.primaryProject,
    ...(Array.isArray(strategy.secondaryProjects) ? strategy.secondaryProjects : []),
    identity.source,
    identity.path,
  ]);
}

function getKeywordValues(knowledgeObject) {
  const content = knowledgeObject && knowledgeObject.content ? knowledgeObject.content : {};

  return uniqueTerms(Array.isArray(content.keywords) ? content.keywords : []);
}

function getStructureText(knowledgeObject) {
  const metadata = knowledgeObject && knowledgeObject.metadata ? knowledgeObject.metadata : {};
  const structure = metadata.documentStructure || {};

  const parts = [];

  (Array.isArray(structure.headings) ? structure.headings : []).forEach((heading) => {
    if (heading && heading.title) {
      parts.push(heading.title);
    }
  });

  (Array.isArray(structure.lists) ? structure.lists : []).forEach((listItem) => {
    if (listItem && listItem.text) {
      parts.push(listItem.text);
    }
  });

  (Array.isArray(structure.links) ? structure.links : []).forEach((link) => {
    if (link && link.url) {
      parts.push(link.url);
    }
  });

  (Array.isArray(structure.tables) ? structure.tables : []).forEach((table) => {
    if (table) {
      parts.push(String(table.rowCount || ''));
      parts.push(String(table.columnCount || ''));
    }
  });

  (Array.isArray(structure.codeBlocks) ? structure.codeBlocks : []).forEach((block) => {
    if (block && block.code) {
      parts.push(block.code);
    }
  });

  return normalizeText(parts.join(' '));
}

function getContentText(knowledgeObject) {
  const content = knowledgeObject && knowledgeObject.content ? knowledgeObject.content : {};

  return normalizeText(content.raw || '');
}

function getSearchTerms(options) {
  const terms = [];

  if (options && typeof options.query === 'string') {
    terms.push(...splitTerms(options.query));
    terms.push(normalizeText(options.query));
  }

  if (options && typeof options.project === 'string') {
    terms.push(normalizeText(options.project));
    terms.push(...splitTerms(options.project));
  }

  if (options && Array.isArray(options.documentTypes)) {
    options.documentTypes.forEach((documentType) => {
      terms.push(normalizeText(documentType));
    });
  }

  if (options && Array.isArray(options.keywords)) {
    options.keywords.forEach((keyword) => {
      terms.push(normalizeText(keyword));
      terms.push(...splitTerms(keyword));
    });
  }

  if (options && Array.isArray(options.structureTerms)) {
    options.structureTerms.forEach((term) => {
      terms.push(normalizeText(term));
      terms.push(...splitTerms(term));
    });
  }

  return uniqueTerms(terms);
}

function scoreFieldMatch(fieldValue, term, exactWeight, partialWeight, reasons, reasonLabel) {
  if (!fieldValue || !term) {
    return 0;
  }

  if (fieldValue === term) {
    reasons.push(`${reasonLabel} exact match: "${term}"`);
    return exactWeight;
  }

  if (fieldValue.includes(term) || term.includes(fieldValue)) {
    reasons.push(`${reasonLabel} partial match: "${term}"`);
    return partialWeight;
  }

  return 0;
}

function scoreKnowledgeObject(knowledgeObject, options) {
  const id = getKnowledgeObjectId(knowledgeObject);
  const name = getName(knowledgeObject);
  const documentType = getDocumentType(knowledgeObject);
  const projectValues = getProjectValues(knowledgeObject);
  const keywordValues = getKeywordValues(knowledgeObject);
  const structureText = getStructureText(knowledgeObject);
  const contentText = getContentText(knowledgeObject);
  const searchTerms = getSearchTerms(options);
  const reasons = [];
  let score = 0;

  if (searchTerms.length === 0) {
    if (name) {
      score += 2;
      reasons.push('identity.name present');
    }

    if (documentType && documentType !== 'generic') {
      score += 2;
      reasons.push(`documentTypeClassification present: ${documentType}`);
    }

    if (projectValues.length > 0) {
      score += 1.5;
      reasons.push('strategy.primaryProject or related project present');
    }

    if (keywordValues.length > 0) {
      score += Math.min(keywordValues.length, 5) * 0.5;
      reasons.push('content.keywords present');
    }

    if (structureText) {
      score += 1;
      reasons.push('metadata.documentStructure present');
    }

    return {
      id,
      score: Number(score.toFixed(2)),
      reasons,
    };
  }

  searchTerms.forEach((term) => {
    score += scoreFieldMatch(name, term, 8, 4, reasons, 'identity.name');

    projectValues.forEach((project) => {
      score += scoreFieldMatch(project, term, 6, 3, reasons, 'strategy.project');
    });

    score += scoreFieldMatch(documentType, term, 5, 2.5, reasons, 'documentTypeClassification.type');

    keywordValues.forEach((keyword) => {
      score += scoreFieldMatch(keyword, term, 3, 1.5, reasons, 'content.keywords');
    });

    score += scoreFieldMatch(structureText, term, 2.5, 1, reasons, 'metadata.documentStructure');
    score += scoreFieldMatch(contentText, term, 1.5, 0.5, reasons, 'content.raw');
  });

  if (name && searchTerms.some((term) => name === term)) {
    score += 1;
    reasons.push('name exactness bonus');
  }

  if (projectValues.some((project) => searchTerms.includes(project))) {
    score += 0.75;
    reasons.push('project alignment bonus');
  }

  if (documentType && searchTerms.includes(documentType)) {
    score += 0.75;
    reasons.push('document type alignment bonus');
  }

  return {
    id,
    score: Number(score.toFixed(2)),
    reasons,
  };
}

function rankKnowledgeObjects(knowledgeObjects, options = {}) {
  const objects = Array.isArray(knowledgeObjects) ? knowledgeObjects : [];

  if (objects.length === 0) {
    return [];
  }

  return objects
    .map((knowledgeObject, index) => scoreKnowledgeObject(knowledgeObject, options, index))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return String(left.id).localeCompare(String(right.id));
    })
    .map((entry, index) => ({
      id: entry.id,
      score: entry.score,
      rankingPosition: index + 1,
      reasons: entry.reasons,
    }));
}

module.exports = {
  rankKnowledgeObjects,
};
