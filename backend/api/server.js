const http = require("http");
const EmailWorkflow = require("../workflows/emailWorkflow");
const EmailAgent = require("../agents/emailAgent");
const ProposalEngine = require("../core/proposalEngine");
const ApprovalQueue = require("../core/approvalQueue");
const { ExecutionAdapter } = require("../services/execution/execution-adapter");
const { ExecutionService } = require("../services/execution/execution-service");
const { createAuthorizedGmailDraftProvider } = require("../services/execution/gmail-draft-provider-factory");
const ActionExecutor = require("../core/actionExecutor");
const ExecutionLogger = require("../core/executionLogger");
const GmailConnector = require("../integrations/gmail/connector");
const systemConfig = require("../config/systemConfig");
const WorkflowManager = require("../workflows/workflowManager");
const SystemStateManager = require("../core/systemStateManager");
const ProjectManagerService = require("../projects/projectManagerService");
const DashboardIntelligence = require("../services/dashboard/dashboard-intelligence");
const { matchExecutiveQuery } = require("../services/executive/executive-query-router");
const { searchKnowledge } = require("../services/knowledge/knowledge-query-service");
const { UniversalKnowledgeSupervisor } = require("../services/knowledge/universal-knowledge-supervisor");
const {
  handleExecutiveChatRequest,
  isExecutiveChatRoute
} = require("./routes/executive-chat");
const {
  handleExecutiveIdentityRequest,
  isExecutiveIdentityRoute
} = require("./routes/executive-identity");
const {
  handleApproveRequest,
  handleExecutiveSecurityContextRequest,
  handleExecuteApprovedRequest
} = require("./routes/executive-approval");
const {
  handleBusinessHunterOperationRequest,
  isBusinessHunterOperationRoute
} = require("./routes/business-hunter-operations");
const { handleKnowledgeOperationRequest, isKnowledgeOperationRoute } = require("./routes/knowledge-operations");
const { handleMemoryOperationRequest, isMemoryOperationRoute } = require("./routes/memory-operations");
const { handleGmailOperationRequest, isGmailOperationRoute } = require("./routes/gmail-operations");
const { createExecutiveCsrf } = require("../security/executive-csrf");
const {
  authenticateFirebaseRequest,
  createFirebaseAdminVerifier,
  sendFirebaseAuthError
} = require("../security/firebase-server-auth");
const { createExecutiveAuthorizer } = require("../security/executive-authorization");
const { createExecutiveRuntime } = require("../services/runtime/executive-runtime-factory");
const { businessHunterReadonlyService } = require("../services/operations/business-hunter-readonly-service");
const { createKnowledgeReadonlyService } = require("../services/operations/knowledge-readonly-service");
const { createMemoryReadonlyService } = require("../services/operations/memory-readonly-service");
const { createGmailReadonlyService } = require("../services/operations/gmail-readonly-service");
const { createOperationsCoordinator } = require("../services/operations/operations-coordinator");
const { getClienteCeroIdentity } = require("../services/private-context/client-identity-resolver");
const { buildGmailPrivateContext } = require("../services/private-context/gmail-private-provider");
const { buildCalendarPrivateContext } = require("../services/private-context/calendar-private-provider");
const {
  getSystem,
  getIntentAnalyzer,
  getRuleEngine,
  getExecutiveBrain
} = require("../runtime/executive-runtime");
const {
  getAuthUrl,
  getTokens,
  getGmailClient,
  inspectGoogleOAuthReadiness
} = require("../integrations/googleOAuth");

const system = getSystem();
const intentAnalyzer = getIntentAnalyzer();
const ruleEngine = getRuleEngine();
const executiveBrain = getExecutiveBrain();
const proposalEngine = new ProposalEngine();
const approvalQueue = new ApprovalQueue();
const runtimeConfig = Object.freeze({ runtimeMode: "production" });
const executiveRuntime = createExecutiveRuntime({
  mode: runtimeConfig.runtimeMode,
  productionMemory: system.memory,
  productionApprovalQueue: approvalQueue
});
const executiveCsrf = createExecutiveCsrf();
const verifyFirebaseIdToken = createFirebaseAdminVerifier();
const authorizeFirebaseIdentity = createExecutiveAuthorizer();
const executionConfig = Object.freeze({ executionEnabled: false });
const gmailDraftComposition = createAuthorizedGmailDraftProvider({
  executionEnabled: executionConfig.executionEnabled,
  oauthReadiness: executionConfig.executionEnabled
    ? inspectGoogleOAuthReadiness()
    : null,
  getGmailClient
});
const gmailDraftProvider = gmailDraftComposition.provider;
const executionAdapter = new ExecutionAdapter({ emailProvider: gmailDraftProvider });
const executionService = new ExecutionService({ approvalQueue, executionAdapter });
const universalKnowledgeSupervisor = new UniversalKnowledgeSupervisor({ approvalQueue });
const executionLogger = new ExecutionLogger();
const knowledgeReadonlyService = createKnowledgeReadonlyService();
const memoryReadonlyService = createMemoryReadonlyService({ memoryEngine: executiveRuntime.memory });
const gmailReadonlyService = createGmailReadonlyService();
const operationsCoordinator = createOperationsCoordinator({
  businessHunterService: businessHunterReadonlyService,
  knowledgeReadonlyService,
  memoryReadonlyService,
  gmailReadonlyService,
  executionLogger,
});
const actionExecutor = new ActionExecutor();
const gmailConnector = new GmailConnector();
gmailConnector.connect();
const workflowManager = new WorkflowManager();
const systemStateManager = new SystemStateManager();
function buildRequestPrivateIdentity(firebaseIdentity) {
  const privateIdentity = getClienteCeroIdentity();
  return {
    ...privateIdentity,
    userId: firebaseIdentity.uid
  };
}

function createDashboardReaders(firebaseIdentity) {
  const identity = buildRequestPrivateIdentity(firebaseIdentity);
  return {
    gmailReader: () => buildGmailPrivateContext({ ...identity, maxMessages: 5 }),
    calendarReader: () => buildCalendarPrivateContext({
      ...identity,
      range: "next7Days",
      maxResults: 10
    })
  };
}

const MUTABLE_EXECUTIVE_ROUTES = new Set([
  "/api/approve",
  "/api/execute-approved"
]);

function requiresFirebaseAuthentication(pathname) {
  return pathname.startsWith("/api/") || pathname === "/oauth/google";
}

systemStateManager.updateIntegration(
    "gmail",
    "connected",
    {
        mode: systemConfig.gmail.mode
    }
);

systemStateManager.updateWorkflow(
    "emailWorkflow",
    "available"
);

const PORT = 3000;

function normalizeAssetSearchMessage(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAssetSearchTerm(message = "") {
  const normalized = normalizeAssetSearchMessage(message);
  const prefixes = [
    "busca ",
    "buscar ",
    "localizar ",
    "encuentra ",
    "donde esta ",
  ];
  const prefix = prefixes.find((candidate) => normalized.startsWith(candidate));

  if (!prefix) {
    return null;
  }

  return normalized.slice(prefix.length).trim();
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  });

  res.end(JSON.stringify(data, null, 2));
}

const server = http.createServer(async (req, res) => {

const pathname = req.url.split("?")[0];
const methodMustBeHandledFirst = MUTABLE_EXECUTIVE_ROUTES.has(pathname)
  && req.method !== "POST";

if (requiresFirebaseAuthentication(pathname) && !methodMustBeHandledFirst) {
  const authentication = await authenticateFirebaseRequest(req, {
    verifyIdToken: verifyFirebaseIdToken,
    authorizeIdentity: authorizeFirebaseIdentity
  });
  if (!authentication.ok) {
    return sendFirebaseAuthError(res, authentication);
  }
  res.setHeader("Cache-Control", "no-store");
  Object.defineProperty(req, "oxkioIdentity", {
    value: authentication.identity,
    enumerable: false,
    writable: false
  });
}

const requestPrivateIdentity = req.oxkioIdentity
  ? buildRequestPrivateIdentity(req.oxkioIdentity)
  : null;
const dashboardReaders = req.oxkioIdentity
  ? createDashboardReaders(req.oxkioIdentity)
  : null;

if (isExecutiveIdentityRoute(pathname, req.method)) {
  return handleExecutiveIdentityRequest(req, res, {
    dependencies: { getClienteCeroIdentity: () => req.oxkioIdentity }
  });
}
if (pathname === "/api/executive/security-context") {
  return handleExecutiveSecurityContextRequest(req, res, {
    getIdentity: () => requestPrivateIdentity,
    csrf: executiveCsrf
  });
}

if (isExecutiveChatRoute(pathname, req.method)) {
  return handleExecutiveChatRequest(req, res, {
    dependencies: {
      memory: executiveRuntime.memory,
      proposalEngine,
      approvalQueue: executiveRuntime.approvalQueue,
      getClienteCeroIdentity: () => requestPrivateIdentity,
      buildGmailPrivateContext,
      buildCalendarPrivateContext,
      getDashboardState: DashboardIntelligence.getDashboardState,
      dashboardGmailReader: dashboardReaders.gmailReader,
      dashboardCalendarReader: dashboardReaders.calendarReader
    }
  });
}

if (pathname === "/oauth/google" && req.method === "GET") {
  try {
    const authUrl = getAuthUrl();

    return sendJson(res, 200, {
      ok: true,
      authUrl
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error.message
    });
  }
}

if (pathname === "/oauth/google/callback" && req.method === "GET") {
  try {
    const fullUrl = new URL(req.url, `http://${req.headers.host}`);
    const code = fullUrl.searchParams.get("code");

    if (!code) {
      return sendJson(res, 400, {
        ok: false,
        error: "Falta code OAuth"
      });
    }

    await getTokens(code);

return sendJson(res, 200, {
  ok: true,
  message: "OAuth Gmail conectado correctamente",
  gmailConnected: true,
  tokenSaved: true
});
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error.message
    });
  }
}
if (pathname === "/api/gmail/inbox" && req.method === "GET") {
  try {
    const { getGmailClient } = require("../integrations/googleOAuth");
    const gmail = getGmailClient();

    const listResponse = await gmail.users.messages.list({
      userId: "me",
      maxResults: 5,
      labelIds: ["INBOX"]
    });

    const messages = listResponse.data.messages || [];

    const emails = [];

    for (const msg of messages) {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date"]
      });

      const headers = detail.data.payload.headers || [];

      const getHeader = (name) => {
        const found = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
        return found ? found.value : "";
      };

      emails.push({
        id: msg.id,
        threadId: detail.data.threadId,
        from: getHeader("From"),
        subject: getHeader("Subject"),
        date: getHeader("Date"),
        snippet: detail.data.snippet
      });
    }

    return sendJson(res, 200, {
      ok: true,
      mode: "SAFE_READ_ONLY",
      count: emails.length,
      emails
    });

  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error.message
    });
  }
}
if (pathname === "/api/gmail/analyze" && req.method === "GET") {

  try {

    const { getGmailClient } = require("../integrations/googleOAuth");
    const gmail = getGmailClient();

    const listResponse = await gmail.users.messages.list({
      userId: "me",
      maxResults: 1,
      labelIds: ["INBOX"]
    });

    const messages = listResponse.data.messages || [];

    if (messages.length === 0) {
      return sendJson(res, 200, {
        ok: true,
        message: "No hay correos en inbox"
      });
    }

    const msg = messages[0];

    const detail = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"]
    });

    const headers = detail.data.payload.headers || [];

    const getHeader = (name) => {
      const found = headers.find(
        h => h.name.toLowerCase() === name.toLowerCase()
      );

      return found ? found.value : "";
    };

    const emailData = {
      from: getHeader("From"),
      subject: getHeader("Subject"),
      date: getHeader("Date"),
      snippet: detail.data.snippet
    };

    const analysis = intentAnalyzer.analyze(
      `${emailData.subject} ${emailData.snippet}`
    );

    const proposal = {
  type: "email_draft",
  to: emailData.from,
  subject: `Re: ${emailData.subject}`,
  body: "Hola,\n\nHe recibido tu correo. Lo reviso y te respondo en breve.\n\nUn saludo.",
  summary: "Borrador de respuesta preparado para revisión.",
  recommendation: "Crear borrador en Gmail sin enviar.",
  requiresApproval: true
};

    const approvalItem = approvalQueue.add(
      proposal,
      {
        source: "gmail",
        email: emailData
      }
    );

    return sendJson(res, 200, {
  ok: true,
  mode: "SAFE_PROPOSAL_ONLY",
  emailPreview: {
    from: emailData.from.split("<")[0].trim(),
    subject: emailData.subject,
    date: emailData.date
  },
  analysis: {
    intent: analysis.intent,
    urgency: analysis.urgency,
    requiresApproval: analysis.requiresApproval
  },
  proposal: {
  summary: proposal.summary || "Correo analizado correctamente",
  recommendation: proposal.recommendation,
  generatedAt: new Date().toISOString()
},
  approvalId: approvalItem.id
});
    } catch (error) {

    return sendJson(res, 500, {
      ok: false,
      error: error.message
    });

  }
}
if (req.url === "/") {

  const fs = require("fs");
  const path = require("path");

  const indexPath = path.join(__dirname, "../../app/index.html");

  res.writeHead(200, {
    "Content-Type": "text/html"
  });

  res.end(fs.readFileSync(indexPath));

  return;
}
if (req.url === "/approvals") {

  const fs = require("fs");
  const path = require("path");

  const approvalsPath = path.join(__dirname, "../../app/approvals.html");

  res.writeHead(200, {
    "Content-Type": "text/html"
  });

  res.end(fs.readFileSync(approvalsPath));

  return;
}
if (req.url === "/executive-dashboard.html") {

  const fs = require("fs");
  const path = require("path");

  const dashboardPath = path.join(__dirname, "../../app/executive-dashboard.html");

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8"
  });

  res.end(fs.readFileSync(dashboardPath));

  return;
}
if (req.url === "/executive-chat.html") {

  const fs = require("fs");
  const path = require("path");

  const chatPath = path.join(__dirname, "../../app/executive-chat.html");

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8"
  });

  res.end(fs.readFileSync(chatPath));

  return;
}
if (req.url === "/business-hunter-dashboard.html") {

  const fs = require("fs");
  const path = require("path");

  const dashboardPath = path.join(__dirname, "../../app/business-hunter-dashboard.html");

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8"
  });

  res.end(fs.readFileSync(dashboardPath));

  return;
}
if (req.url === "/js/executive-chat.js") {

  const fs = require("fs");
  const path = require("path");

  const scriptPath = path.join(__dirname, "../../app/js/executive-chat.js");

  res.writeHead(200, {
    "Content-Type": "application/javascript; charset=utf-8"
  });

  res.end(fs.readFileSync(scriptPath));

  return;
}
if (req.url === "/js/business-hunter-dashboard.js") {

  const fs = require("fs");
  const path = require("path");

  const scriptPath = path.join(__dirname, "../../app/js/business-hunter-dashboard.js");

  res.writeHead(200, {
    "Content-Type": "application/javascript; charset=utf-8"
  });

  res.end(fs.readFileSync(scriptPath));

  return;
}
if (req.url === "/js/firebase-authenticated-fetch.js") {
  const fs = require("fs");
  const path = require("path");
  const scriptPath = path.join(__dirname, "../../app/js/firebase-authenticated-fetch.js");

  res.writeHead(200, {
    "Content-Type": "application/javascript; charset=utf-8"
  });
  res.end(fs.readFileSync(scriptPath));
  return;
}
if (req.url === "/css/executive-chat.css") {

  const fs = require("fs");
  const path = require("path");

  const stylePath = path.join(__dirname, "../../app/css/executive-chat.css");

  res.writeHead(200, {
    "Content-Type": "text/css; charset=utf-8"
  });

  res.end(fs.readFileSync(stylePath));

  return;
}
if (req.url === "/css/business-hunter-dashboard.css") {

  const fs = require("fs");
  const path = require("path");

  const stylePath = path.join(__dirname, "../../app/css/business-hunter-dashboard.css");

  res.writeHead(200, {
    "Content-Type": "text/css; charset=utf-8"
  });

  res.end(fs.readFileSync(stylePath));

  return;
}
if (req.url === "/app/logo.png") {

  const fs = require("fs");
  const path = require("path");

  const logoPath = path.join(__dirname, "../../app/logo.png");

  res.writeHead(200, {
    "Content-Type": "image/png"
  });

  res.end(fs.readFileSync(logoPath));

  return;
}
if (req.url === "/logo.png") {

  const fs = require("fs");
  const path = require("path");

  const logoPath = path.join(__dirname, "../../app/logo.png");

  res.writeHead(200, {
    "Content-Type": "image/png"
  });

  res.end(fs.readFileSync(logoPath));

  return;
}
if (req.url === "/app/favicon.png") {

  const fs = require("fs");
  const path = require("path");

  const faviconPath = path.join(__dirname, "../../app/favicon.png");

  res.writeHead(200, {
    "Content-Type": "image/png"
  });

  res.end(fs.readFileSync(faviconPath));

  return;
}
if (req.url === "/favicon.png") {

  const fs = require("fs");
  const path = require("path");

  const faviconPath = path.join(__dirname, "../../app/favicon.png");

  res.writeHead(200, {
    "Content-Type": "image/png"
  });

  res.end(fs.readFileSync(faviconPath));

  return;
}
if (req.url === "/manifest.webmanifest") {

  const fs = require("fs");
  const path = require("path");

  const manifestPath = path.join(__dirname, "../../app/manifest.webmanifest");

  res.writeHead(200, {
    "Content-Type": "application/manifest+json; charset=utf-8",
    "Cache-Control": "public, max-age=3600"
  });

  res.end(fs.readFileSync(manifestPath));

  return;
}
if (req.url === "/icons/icon-192.png" ||
    req.url === "/icons/icon-512.png" ||
    req.url === "/icons/apple-touch-icon.png") {

  const fs = require("fs");
  const path = require("path");
  const iconFiles = {
    "/icons/icon-192.png": "icon-192.png",
    "/icons/icon-512.png": "icon-512.png",
    "/icons/apple-touch-icon.png": "apple-touch-icon.png"
  };
  const iconPath = path.join(__dirname, "../../app/icons", iconFiles[req.url]);

  res.writeHead(200, {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=604800"
  });

  res.end(fs.readFileSync(iconPath));

  return;
}

if (req.url === "/modules/projects/projectManager.js") {
  const fs = require("fs");
  const path = require("path");
  const modulePath = path.join(
    __dirname,
    "../../app/modules/projects/projectManager.js"
  );

  res.writeHead(200, {
    "Content-Type": "application/javascript; charset=utf-8"
  });
  res.end(fs.readFileSync(modulePath));
  return;
}

if (req.url.startsWith("/modules/strategic-intelligence/")) {

  const fs = require("fs");
  const path = require("path");

  const requestedFile = req.url.replace("/modules/strategic-intelligence/", "");
  const allowedFiles = [
    "strategicAnalyzer.js",
    "strategicSuggestions.js",
    "strategicActions.js"
  ];

  if (!allowedFiles.includes(requestedFile)) {
    return sendJson(res, 404, {
      ok: false,
      error: "Modulo no encontrado"
    });
  }

  const modulePath = path.join(
    __dirname,
    "../../app/modules/strategic-intelligence",
    requestedFile
  );

  res.writeHead(200, {
    "Content-Type": "application/javascript"
  });

  res.end(fs.readFileSync(modulePath));

  return;
}

if (req.url.startsWith("/modules/documents/")) {

  const fs = require("fs");
  const path = require("path");

  const requestedFile = req.url.replace("/modules/documents/", "");

  const allowedFiles = [
  "documentClassifier.js",
  "documentFolderAdvisor.js",
  "documentDates.js",
  "documentBridge.js"
];

  if (!allowedFiles.includes(requestedFile)) {
    return sendJson(res, 404, {
      ok: false,
      error: "Modulo no encontrado"
    });
  }

  const modulePath = path.join(
    __dirname,
    "../../app/modules/documents",
    requestedFile
  );

  res.writeHead(200, {
    "Content-Type": "application/javascript"
  });

  res.end(fs.readFileSync(modulePath));

  return;
}

if (req.url.startsWith("/modules/memory/")) {

  const fs = require("fs");
  const path = require("path");

  const requestedFile = req.url.replace("/modules/memory/", "");
  const allowedFiles = [
    "memoryOperational.js",
    "memoryStrategic.js",
    "memoryHistory.js",
    "memoryDecisions.js",
    "memoryBridge.js"
  ];

  if (!allowedFiles.includes(requestedFile)) {
    return sendJson(res, 404, {
      ok: false,
      error: "Modulo no encontrado"
    });
  }

  const modulePath = path.join(
    __dirname,
    "../../app/modules/memory",
    requestedFile
  );

  res.writeHead(200, {
    "Content-Type": "application/javascript"
  });

  res.end(fs.readFileSync(modulePath));

  return;
}

if (req.url === "/api/status") {
  return sendJson(res, 200, {
    ok: true,
    system: "OXKIO V2",
    status: "RUNNING",
    details: system.getStatus(),
    timestamp: new Date().toISOString()
  });
}

if (pathname === "/api/dashboard" && req.method === "GET") {
  try {
    const dashboardState = await DashboardIntelligence.getDashboardState({
      approvalQueue,
      gmailReader: dashboardReaders.gmailReader,
      calendarReader: dashboardReaders.calendarReader,
      operationsStatus: operationsCoordinator.getStatus()
    });

    return sendJson(res, 200, dashboardState);
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: "No se pudo generar el estado del dashboard."
    });
  }
}

if (pathname === "/api/projects" && req.method === "GET") {
  try {
    return sendJson(res, 200, {
      ok: true,
      readOnly: true,
      projects: ProjectManagerService.getProjects()
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      readOnly: true,
      error: "No se pudo cargar la información de proyectos."
    });
  }
}

  if (req.url === "/api/process-email") {

    const emailAgent = new EmailAgent();
    const workflow = new EmailWorkflow(emailAgent);

    const testEmail = {
      from: "ceo@empresa.com",
      subject: "URGENTE: reunión consejo",
      body: "Necesitamos confirmar asistencia antes de las 18:00"
    };

    const result = workflow.process(testEmail);

    system.memory.saveShortTerm({
      type: "EMAIL_WORKFLOW",
      result
    });

    system.logs.addLog(
      "WORKFLOW",
      "Email procesado mediante endpoint /api/process-email",
      result
    );

    return sendJson(res, 200, {
      ok: true,
      result,
      memory: system.memory.getStatus(),
      logs: system.logs.getStatus()
    });
  }

 if (req.url.startsWith("/api/chat")) {

  const url = new URL(req.url, `http://${req.headers.host}`);

  const message = url.searchParams.get("message");
  const queryType = matchExecutiveQuery(message);

  switch (queryType) {
    case "knowledgeSearch": {
      try {
        const assetName = extractAssetSearchTerm(message);
        let result = searchKnowledge(assetName);

        if (!result.found && assetName.includes(" ")) {
          result = searchKnowledge(assetName.replace(/\s+/g, "-"));
        }

        if (result.found) {
          const dashboardState = await DashboardIntelligence.getDashboardState({ approvalQueue });
          const knowledgeInventory = dashboardState.knowledgeInventory || {};
          const recommendation = knowledgeInventory.recommendation || {};
          const pipeline = result.pipeline || {};
          const catalog = pipeline.catalog || {};

          return sendJson(res, 200, {
            ok: true,
            module: "chat",
            message,
            source: "documentCatalog",
            response: {
              title: "Catálogo documental del activo",
              asset: result.asset.name,
              folder: pipeline.folder,
              summary: catalog.summary,
              extensions: catalog.extensions,
              recommendation: recommendation.message
            }
          });
        }

        return sendJson(res, 200, {
          ok: true,
          module: "chat",
          message,
          source: "assetLocator",
          response: {
            title: "Activo no encontrado",
            matches: []
          }
        });
      } catch (error) {
        return sendJson(res, 500, {
          ok: false,
          module: "chat",
          error: "No se pudo localizar el activo."
        });
      }
    }

    case "morningBriefing": {
      try {
        const dashboardState = await DashboardIntelligence.getDashboardState({ approvalQueue });
        const morningBriefing = dashboardState.morningBriefing || {};

        return sendJson(res, 200, {
          ok: true,
          module: "chat",
          message,
          source: "morningBriefing",
          response: {
            title: morningBriefing.title,
            summary: morningBriefing.summary,
            priorities: morningBriefing.priorities,
            recommendations: morningBriefing.recommendations
          }
        });
      } catch (error) {
        return sendJson(res, 500, {
          ok: false,
          module: "chat",
          error: "No se pudo construir el briefing ejecutivo del dia."
        });
      }
    }

    case "projects": {
      try {
        const dashboardState = await DashboardIntelligence.getDashboardState({ approvalQueue });
        const knowledgeInventory = dashboardState.knowledgeInventory || {};
        const summary = knowledgeInventory.summary || {};
        const recommendation = knowledgeInventory.recommendation || {};
        const assets = Array.isArray(knowledgeInventory.assets)
          ? knowledgeInventory.assets.filter((asset) => asset.recognized)
          : [];

        return sendJson(res, 200, {
          ok: true,
          module: "chat",
          message,
          source: "knowledgeInventory",
          response: {
            title: "Proyectos prioritarios",
            summary: `Activos estratégicos detectados: ${summary.recognizedAssets || assets.length}.`,
            projects: assets,
            recommendation: recommendation.message
          }
        });
      } catch (error) {
        return sendJson(res, 500, {
          ok: false,
          module: "chat",
          error: "No se pudo construir el inventario de conocimiento."
        });
      }
    }

    case "knowledgeInventory": {
      try {
        const dashboardState = await DashboardIntelligence.getDashboardState({ approvalQueue });
        const knowledgeInventory = dashboardState.knowledgeInventory || {};
        const recommendation = knowledgeInventory.recommendation || {};
        const assets = Array.isArray(knowledgeInventory.assets)
          ? knowledgeInventory.assets.filter((asset) => asset.recognized)
          : [];

        return sendJson(res, 200, {
          ok: true,
          module: "chat",
          message,
          source: "knowledgeInventory",
          response: {
            title: "Conocimiento disponible",
            summary: `Proyectos estratégicos conocidos: ${assets.length}.`,
            knownAssets: assets,
            nextRecommendation: recommendation.message
          }
        });
      } catch (error) {
        return sendJson(res, 500, {
          ok: false,
          module: "chat",
          error: "No se pudo construir el conocimiento disponible."
        });
      }
    }

    case "greeting": {
      try {
        const dashboardState = await DashboardIntelligence.getDashboardState({ approvalQueue });
        const executiveBriefing = dashboardState.executiveBriefing;

        return sendJson(res, 200, {
          ok: true,
          module: "chat",
          message,
          source: "executiveBriefing",
          executiveBriefing,
          response: executiveBriefing.executiveResponse
        });
      } catch (error) {
        return sendJson(res, 500, {
          ok: false,
          module: "chat",
          error: "No se pudo construir el briefing ejecutivo."
        });
      }
    }
  }

 const brainResult = executiveBrain.think(message);
const analysis = brainResult.analysis;
const proposal = proposalEngine.generate(brainResult);


const approvalItem = approvalQueue.add(
  proposal,
  {
    message,
    analysis
  }
);
 system.memory.saveShortTerm({
  type: "chat",
  message,
  analysis,
  timestamp: new Date().toISOString()
});

system.logs.addLog({
  type: "CHAT",
  message,
  analysis,
  timestamp: new Date().toISOString()
});

  res.writeHead(200, {
    "Content-Type": "application/json"
  });

res.end(JSON.stringify({
  ok: true,
  module: "chat",
 message,
analysis,
brainResult,
proposal,
approvalItem,
response: {
      summary: "He analizado tu solicitud.",
      intent: analysis.intent,
      urgency: analysis.urgency,
      proposedAction: analysis.actionType,
      requiresApproval: analysis.requiresApproval,
      nextStep: analysis.requiresApproval
        ? "Necesito tu autorización antes de ejecutar esta acción."
        : "Puedo responder directamente sin ejecutar ninguna acción."
    }
  }));

  return;
}
if (req.url.startsWith("/api/add-rule")) {

  const url = new URL(req.url, `http://${req.headers.host}`);

  const keyword = url.searchParams.get("keyword") || "";
  const description = url.searchParams.get("description") || "";

  const result = ruleEngine.addRule({
    keyword,
    description
  });

  res.writeHead(200, {
    "Content-Type": "application/json"
  });

  res.end(JSON.stringify({
    ok: true,
    module: "rules",
    result,
    rules: ruleEngine.getRules()
  }, null, 2));

  return;
}

if (req.url.startsWith("/api/rules")) {

  res.writeHead(200, {
    "Content-Type": "application/json"
  });

  res.end(JSON.stringify({
    ok: true,
    module: "rules",
    rules: ruleEngine.getRules(),
    status: ruleEngine.getStatus()
  }, null, 2));

  return;
}

if (req.url.startsWith("/api/search-memory")) {

  const url = new URL(req.url, `http://${req.headers.host}`);

  const keyword = url.searchParams.get("keyword") || "";

  const results = system.memory.searchMemory(keyword);

  res.writeHead(200, {
    "Content-Type": "application/json"
  });

  res.end(JSON.stringify({
    ok: true,
    module: "search-memory",
    keyword,
    results
  }, null, 2));

  return;
}
if (req.url.startsWith("/api/memory")) {

  res.writeHead(200, {
    "Content-Type": "application/json"
  });

  res.end(JSON.stringify({
    ok: true,
    module: "memory",
    memory: system.memory.getShortTerm(),
status: system.memory.getStatus()
  }, null, 2));

  return;
}
 
  if (req.url === "/api/logs") {
    return sendJson(res, 200, {
      ok: true,
      logs: system.logs.getLogs(),
      status: system.logs.getStatus()
    });
  }
if (pathname === "/api/pending-approvals" && req.method === "GET") {

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(JSON.stringify({
    ok: true,
    module: "approval-queue",
    pending: approvalQueue.listPending(),
    status: approvalQueue.getStatus()
  }, null, 2));

  return;
}

if (pathname === "/api/knowledge-supervisor/github-releases/discover" && req.method === "POST") {
  try {
    const result = await universalKnowledgeSupervisor.discover();
    return sendJson(res, 200, { ok: true, module: "universal-knowledge-supervisor", result });
  } catch (error) {
    return sendJson(res, error.status || 500, {
      ok: false,
      module: "universal-knowledge-supervisor",
      error: error.code || "github_release_discovery_failed"
    });
  }
}

if (pathname === "/api/approve") {
  return handleApproveRequest(req, res, {
    approvalQueue,
    getIdentity: () => requestPrivateIdentity,
    csrf: executiveCsrf
  });
}
if (pathname === "/api/approval-history" && req.method === "GET") {

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(JSON.stringify({
    ok: true,
    module: "approval-queue",
    history: approvalQueue.getHistory(),
    status: approvalQueue.getStatus()
  }, null, 2));

  return;
}
if (pathname === "/api/execute-approved") {
  return handleExecuteApprovedRequest(req, res, {
    approvalQueue,
    executionService,
    config: executionConfig,
    getIdentity: () => requestPrivateIdentity,
    csrf: executiveCsrf
  });
}
if (isBusinessHunterOperationRoute(pathname, req.method)) {
  return handleBusinessHunterOperationRequest(req, res, {
    operationsCoordinator,
    getIdentity: () => requestPrivateIdentity
  });
}
if (isKnowledgeOperationRoute(pathname, req.method)) {
  return handleKnowledgeOperationRequest(req, res, {
    operationsCoordinator,
    getIdentity: () => requestPrivateIdentity
  });
}
if (isMemoryOperationRoute(pathname, req.method)) {
  return handleMemoryOperationRequest(req, res, {
    operationsCoordinator,
    getIdentity: () => requestPrivateIdentity
  });
}
if (isGmailOperationRoute(pathname, req.method)) {
  return handleGmailOperationRequest(req, res, {
    operationsCoordinator,
    getIdentity: () => requestPrivateIdentity
  });
}
if (req.url.startsWith("/api/execution-logs")) {

  res.writeHead(200, {
    "Content-Type": "application/json"
  });

  res.end(JSON.stringify({
    ok: true,
    module: "execution-logger",
    logs: executionLogger.list(),
    status: executionLogger.getStatus()
  }, null, 2));

  return;
}

if (pathname === "/api/simulator-executive-export" && req.method === "GET") {
  try {
    const response = await fetch(
      "http://localhost:3100/executive-export"
    );

    const data = await response.json();

    res.writeHead(200, {
      "Content-Type": "application/json"
    });

    res.end(
      JSON.stringify({
        ok: true,
        source: "Simulador IA Executive",
        target: "Oxkio",
        data
      })
    );

    return;
  } catch (error) {
    res.writeHead(500, {
      "Content-Type": "application/json"
    });

    res.end(
      JSON.stringify({
        ok: false,
        message: "No se pudo conectar con Simulador IA",
        error: error.message
      })
    );

    return;
  }
}

if (pathname === "/api/system-status") {

    return sendJson(res, 200, {
  ok: true,
  message: "OAuth Gmail conectado correctamente",
  gmailConnected: true,
  tokenSaved: true
});

}
if (pathname === "/api/execute" && req.method === "POST") {

  let body = "";

  req.on("data", chunk => {
    body += chunk.toString();
  });

  req.on("end", async () => {

    try {

      const data = JSON.parse(body);

      const userMessage = data.message || "";

      const intent = intentAnalyzer.analyze(userMessage);

const proposal = proposalEngine.generate({
  analysis: intent,
  decision: {
    recommendation: "Generar propuesta",
    requiresApproval: true
  }
});

      approvalQueue.add({
        type: "execution",
        proposal
      });

      executionLogger.add({
        type: "proposal-created",
        proposal
      });

      return sendJson(res, 200, {
        ok: true,
        message: "Propuesta generada correctamente",
        intent,
        proposal,
        approvalQueue: approvalQueue.getHistory()
      });

    } catch (error) {

  console.error("[API EXECUTE ERROR]", error);

  return sendJson(res, 500, {
        ok: false,
        error: error.message
      });

    }

  });

  return;
}
  return sendJson(res, 404, {
    ok: false,
    error: "Endpoint no encontrado"
  });
});

server.on("close", () => {
  executiveRuntime.cleanup();
});

server.listen(PORT, () => {
  console.log("=================================");
  console.log("OXKIO API SERVER RUNNING");
  console.log("App:", systemConfig.app.name);
  console.log("Version:", systemConfig.app.version);
  console.log("Safe Mode:", systemConfig.security.safeMode);
  console.log("Gmail Mode:", systemConfig.gmail.mode);
  console.log("=================================");
});
