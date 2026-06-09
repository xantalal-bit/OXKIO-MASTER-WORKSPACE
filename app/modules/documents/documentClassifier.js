function detectDocumentCategory(fileName, mimeType) {
  const n = (fileName || "").toLowerCase();
  const m = (mimeType || "").toLowerCase();

  if (n.includes("dni") || n.includes("pasaporte")) return "personal";
  if (n.includes("factura") || n.includes("invoice")) return "gasto";
  if (n.includes("contrato") || n.includes("acuerdo")) return "profesional";
  if (n.includes("seguro") || n.includes("itv") || n.includes("licencia")) return "renovación";
  if (m.includes("image/")) return "imagen";
  if (m.includes("pdf")) return "pdf";

  return "general";
}

window.OxkioDocumentClassifier = {
  detectDocumentCategory
};
