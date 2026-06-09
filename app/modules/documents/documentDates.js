function extractDates(text) {

  if (!text) {
    return [];
  }

  const dates =
    text.match(/\b\d{2}\/\d{2}\/\d{4}\b/g) || [];

  return [...new Set(dates)];
}

window.OxkioDocumentDates = {
  extractDates
};
