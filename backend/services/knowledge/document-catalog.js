'use strict';

const trackedExtensions = new Set([
  'pdf',
  'doc',
  'docx',
  'xlsx',
  'txt',
  'md',
  'json',
]);

function createExtensionSummary() {
  return {
    pdf: 0,
    doc: 0,
    docx: 0,
    xlsx: 0,
    txt: 0,
    md: 0,
    json: 0,
    other: 0,
  };
}

function normalizeExtension(extension) {
  return String(extension || '').replace(/^\./, '').toLowerCase();
}

function buildDocumentCatalog(discoveryResult) {
  const documents = discoveryResult && Array.isArray(discoveryResult.documents)
    ? discoveryResult.documents
    : [];
  const extensions = createExtensionSummary();
  let files = 0;
  let directories = 0;

  documents.forEach((document) => {
    if (document.type === 'directory') {
      directories += 1;
      return;
    }

    files += 1;

    const extension = normalizeExtension(document.extension);

    if (trackedExtensions.has(extension)) {
      extensions[extension] += 1;
      return;
    }

    extensions.other += 1;
  });

  return {
    generatedAt: new Date().toISOString(),
    folder: discoveryResult.folder,
    summary: {
      totalItems: discoveryResult.totalItems,
      files,
      directories,
    },
    extensions,
  };
}

module.exports = {
  buildDocumentCatalog,
};
