const http = require("http");
const OxkioSystem = require("../core/system");
const EmailWorkflow = require("../workflows/emailWorkflow");
const EmailAgent = require("../agents/emailAgent");
const IntentAnalyzer = require("../core/intentAnalyzer");
const MemoryEngine = require("../memory/memoryEngine");

const intentAnalyzer = new IntentAnalyzer();


const PORT = 3000;

const system = new OxkioSystem();
system.boot();

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

  const analysis = intentAnalyzer.analyze(message);

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

  return sendJson(res, 404, {
    ok: false,
    error: "Endpoint no encontrado"
  });
});

server.listen(PORT, () => {
  console.log(`OXKIO API SERVER RUNNING ON PORT ${PORT}`);
});