const USER = {
  name: "José Antonio",
  role: "Cliente Cero"
};

const VERSION = "1.0";

function buildExecutiveContext(dashboardState) {
  const dashboard = dashboardState || {};

  return {
    user: USER,
    system: {
      generatedAt: new Date().toISOString(),
      version: VERSION
    },
    dashboard,
    executiveSummary: dashboard.executiveSummary || null
  };
}

module.exports = {
  buildExecutiveContext
};
