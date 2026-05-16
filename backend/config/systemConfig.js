const systemConfig = {
  app: {
    name: "Oxkio",
    version: "0.2.0",
    environment: "development"
  },

  security: {
    requireApprovals: true,
    preventDoubleExecution: true,
    safeMode: true
  },

  execution: {
    enableExecutionLogs: true,
    defaultProviderMode: "SAFE_DRAFT_ONLY"
  },

  gmail: {
    enabled: true,
    mode: "SAFE_DRAFT_ONLY",
    allowRealSend: false
  },

  calendar: {
    enabled: false,
    mode: "SAFE_ONLY"
  },

  memory: {
    enabled: true,
    persistence: "json"
  }
};

module.exports = systemConfig;