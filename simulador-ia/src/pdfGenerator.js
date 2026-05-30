const PDFDocument = require("pdfkit");

const path = require("path");

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