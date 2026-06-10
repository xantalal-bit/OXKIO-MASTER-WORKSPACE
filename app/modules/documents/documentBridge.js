function detectarCategoriaDocumento(fileName, mimeType) {
  return window.OxkioDocumentClassifier.detectDocumentCategory(
    fileName,
    mimeType
  );
}

function sugerirCarpeta(tipo) {
  return window.OxkioDocumentFolderAdvisor.suggestFolder(
    tipo
  );
}

function extraerFechas(texto) {
  return window.OxkioDocumentDates.extractDates(
    texto
  );
}

window.OxkioDocumentBridge = {
  detectarCategoriaDocumento,
  sugerirCarpeta,
  extraerFechas
};