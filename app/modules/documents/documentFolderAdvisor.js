function suggestFolder(type) {

  if (type === "personal") return "personales";
  if (type === "profesional") return "profesionales";
  if (type === "gasto") return "gastos";
  if (type === "renovación") return "renovaciones";
  if (type === "imagen") return "entradas-imagen";
  if (type === "pdf") return "entradas-pdf";

  return "general";
}

window.OxkioDocumentFolderAdvisor = {
  suggestFolder
};
