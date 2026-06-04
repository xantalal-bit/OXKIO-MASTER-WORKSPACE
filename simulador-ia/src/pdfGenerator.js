const PDFDocument = require("pdfkit");
const path = require("path");

function writeSection(doc, title, content) {
  doc
    .moveDown()
    .fontSize(16)
    .fillColor("#0f172a")
    .text(title, {
      underline: true
    });

  doc
    .moveDown(0.4)
    .fontSize(11)
    .fillColor("#334155")
    .text(content || "No disponible.", {
      align: "left"
    });
}

function generateExecutivePDF(res, data) {
  const doc = new PDFDocument({
    margin: 50
  });

  const logoPath = path.join(
    __dirname,
    "../../app/favicon.png"
  );

  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": "attachment; filename=oxkio-executive-report.pdf"
  });

  doc.pipe(res);

  doc.image(logoPath, 50, 45, {
    width: 55
  });

  doc.moveDown(2);

  doc
    .fontSize(24)
    .fillColor("#0f172a")
    .text("OXKIO EXECUTIVE REPORT", {
      align: "center"
    });

  doc
    .moveDown(0.5)
    .fontSize(11)
    .fillColor("#475569")
    .text("Confidential Executive Intelligence Report", {
      align: "center"
    });

  doc.moveDown();

  doc
    .fontSize(12)
    .fillColor("#334155")
    .text(`Fecha: ${new Date().toLocaleString()}`);

  writeSection(
    doc,
    "Proyecto",
    data.project || "No especificado"
  );

  writeSection(
    doc,
    "Indicadores Ejecutivos",
    `Viabilidad: ${data.viabilityScore}/100
Riesgo: ${data.riskScore}/100
Escalabilidad: ${data.scalabilityScore}/100
Dificultad: ${data.difficulty || "-"}`
  );

  const ceoAgent =
    data.agentAnalysis &&
    data.agentAnalysis.agents
      ? data.agentAnalysis.agents.find(
          agent => agent.agent === "CEO Agent"
        )
      : null;

  const summary =
    ceoAgent &&
    ceoAgent.recommendations &&
    ceoAgent.recommendations[0]
      ? ceoAgent.recommendations[0]
      : "No hay resumen ejecutivo disponible.";

  writeSection(
    doc,
    "Resumen Ejecutivo",
    summary
  );

  writeSection(
    doc,
    "Executive Advisor GPT",
    data.executiveAdvisor ||
      "No hay decisión ejecutiva IA disponible."
  );

  doc.addPage();

  doc.image(logoPath, 50, 35, {
    width: 35
  });

  doc
    .fontSize(20)
    .fillColor("#0f172a")
    .text("COMITÉ IA EXECUTIVE", {
      align: "center"
    });

  doc
    .moveDown(0.5)
    .fontSize(10)
    .fillColor("#64748b")
    .text("Análisis multiagente generado por Oxkio", {
      align: "center"
    });

  doc.moveDown(2);

  if (
    data.agentAnalysis &&
    data.agentAnalysis.agents
  ) {
    data.agentAnalysis.agents.forEach(agent => {
      doc.moveDown(0.5);

      doc
        .fontSize(13)
        .fillColor("#0f172a")
        .text(agent.agent);

      doc
        .fontSize(11)
        .fillColor("#334155")
        .text(`Foco: ${agent.focus}`);

      const items =
        agent.recommendations ||
        agent.alerts ||
        agent.strategies ||
        agent.opportunities ||
        [];

      items.forEach(item => {
        doc
          .fontSize(10)
          .fillColor("#334155")
          .text(`- ${item}`);
      });
    });
  }

  doc.moveDown();

  doc
    .fontSize(10)
    .fillColor("#64748b")
    .text("Generado por Oxkio Executive Intelligence Engine", {
      align: "center"
    });

  doc.end();
}

module.exports = {
  generateExecutivePDF
};
