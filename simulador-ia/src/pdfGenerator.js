const PDFDocument = require("pdfkit");

function generateExecutivePDF(res, data) {
  const doc = new PDFDocument({
    margin: 50
  });

  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": "attachment; filename=oxkio-executive-report.pdf"
  });

  doc.pipe(res);

  doc
    .fontSize(22)
    .text("OXKIO EXECUTIVE REPORT", {
      align: "center"
    });

  doc.moveDown();

  doc
    .fontSize(12)
    .text(`Fecha: ${new Date().toLocaleString()}`);

  doc.moveDown();

  doc
    .fontSize(16)
    .text("Proyecto", {
      underline: true
    });

  doc
    .fontSize(12)
    .text(data.project || "No especificado");

  doc.moveDown();

  doc
    .fontSize(16)
    .text("Indicadores Ejecutivos", {
      underline: true
    });

  doc
    .fontSize(12)
    .text(`Viabilidad: ${data.viabilityScore}/100`)
    .text(`Riesgo: ${data.riskScore}/100`)
    .text(`Escalabilidad: ${data.scalabilityScore}/100`)
    .text(`Dificultad: ${data.difficulty || "-"}`);

  doc.moveDown();

  doc
    .fontSize(16)
    .text("Resumen Ejecutivo", {
      underline: true
    });

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

  doc
    .fontSize(12)
    .text(summary, {
      align: "left"
    });

  doc.moveDown();

  doc
    .fontSize(16)
    .text("Comité IA", {
      underline: true
    });

  if (
    data.agentAnalysis &&
    data.agentAnalysis.agents
  ) {
    data.agentAnalysis.agents.forEach(agent => {
      doc.moveDown(0.5);

      doc
        .fontSize(13)
        .text(agent.agent);

      doc
        .fontSize(11)
        .text(`Foco: ${agent.focus}`);

      const items =
        agent.recommendations ||
        agent.alerts ||
        agent.strategies ||
        [];

      items.forEach(item => {
        doc
          .fontSize(10)
          .text(`- ${item}`);
      });
    });
  }

  doc.moveDown();

  doc
    .fontSize(10)
    .text("Generado por Oxkio Executive Intelligence Engine", {
      align: "center"
    });

  doc.end();
}

module.exports = {
  generateExecutivePDF
};