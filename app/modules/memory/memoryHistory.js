function buildHistoryMemoryStatus(data) {
  return {
    ok: true,
    type: "history",
    summary: "Memoria historica preparada.",
    records: Array.isArray(data) ? data.length : 0
  };
}

window.OxkioMemoryHistory = {
  buildHistoryMemoryStatus
};