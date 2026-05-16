const http = require("http");
const OxkioSystem = require("../core/system");
const EmailWorkflow = require("../workflows/emailWorkflow");
const EmailAgent = require("../agents/emailAgent");
const IntentAnalyzer = require("../core/intentAnalyzer");
const ExecutiveBrain = require("../core/executiveBrain");
const MemoryEngine = require("../memory/memoryEngine");
const RuleEngine = require("../core/ruleEngine");
const ProposalEngine = require("../core/proposalEngine");
const ApprovalQueue = require("../core/approvalQueue");
const ActionExecutor = require("../core/actionExecutor");
const ExecutionLogger = require("../core/executionLogger");
const GmailConnector = require("../integrations/gmailConnector");
const systemConfig = require("../config/systemConfig");

const intentAnalyzer = new IntentAnalyzer();
const ruleEngine = new RuleEngine();
const proposalEngine = new ProposalEngine();
const approvalQueue = new ApprovalQueue();
const executionLogger = new ExecutionLogger();
const actionExecutor = new ActionExecutor();
const gmailConnector = new GmailConnector();
gmailConnector.connect();

const PORT = 3000;

const system = new OxkioSystem();
system.boot();

const executiveBrain = new ExecutiveBrain(
  system.memory,
  intentAnalyzer,
  ruleEngine
);

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  });

  res.end(JSON.stringify(data, null, 2));
}

const server = http.createServer((req, res) => {

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
if (req.url === "/api/status") {
  return sendJson(res, 200, {
    ok: true,
    system: "OXKIO V2",
    status: "RUNNING",
    details: system.getStatus(),
    timestamp: new Date().toISOString()
  });
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
if (req.url.startsWith("/api/pending-approvals")) {

  res.writeHead(200, {
    "Content-Type": "application/json"
  });

  res.end(JSON.stringify({
    ok: true,
    module: "approval-queue",
    pending: approvalQueue.listPending(),
    status: approvalQueue.getStatus()
  }, null, 2));

  return;
}

if (req.url.startsWith("/api/approve")) {

  const url = new URL(req.url, `http://${req.headers.host}`);

  const id = url.searchParams.get("id");

  const result = approvalQueue.approve(id);

  res.writeHead(200, {
    "Content-Type": "application/json"
  });

  res.end(JSON.stringify({
    ok: result.ok,
    module: "approval-queue",
    result,
    status: approvalQueue.getStatus()
  }, null, 2));

  return;
}
if (req.url.startsWith("/api/approval-history")) {

  res.writeHead(200, {
    "Content-Type": "application/json"
  });

  res.end(JSON.stringify({
    ok: true,
    module: "approval-queue",
    history: approvalQueue.getHistory(),
    status: approvalQueue.getStatus()
  }, null, 2));

  return;
}
if (req.url.startsWith("/api/execute-approved")) {

  const url = new URL(req.url, `http://${req.headers.host}`);

  const id = url.searchParams.get("id");

 const item = approvalQueue.getHistory().find(item => item.id === id);

if (executionLogger.hasExecuted(id)) {

  return sendJson(res, 400, {
    ok: false,
    error: "Esta aprobación ya fue ejecutada"
  });
}

 const result = actionExecutor.execute(item, {
  gmailConnector
});

  executionLogger.add({
  approvalId: id,
  executionResult: result,
  item
});

  res.writeHead(200, {
    "Content-Type": "application/json"
  });

  res.end(JSON.stringify({
    ok: result.ok,
    module: "action-executor",
    result
  }, null, 2));

  return;
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
  return sendJson(res, 404, {
    ok: false,
    error: "Endpoint no encontrado"
  });
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