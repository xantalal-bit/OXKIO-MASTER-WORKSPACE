function buildDecisionMemoryStatus(data) {
  return {
    ok: true,
    type: "decisions",
    summary: "Memoria de decisiones preparada.",
    decisions: Array.isArray(data) ? data.length : 0
  };
}

window.OxkioMemoryDecisions = {
  buildDecisionMemoryStatus
};