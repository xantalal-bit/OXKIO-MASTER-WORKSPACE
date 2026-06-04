const PDFDocument = require("pdfkit");
const path = require("path");

function generateComparisonPDF(res, data) {
  const doc = new PDFDocument({
    margin: 50
  });

  const logoPath = path.join(
    __dirname,
    "../../app/favicon.png"
  );

  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": "attachment; filename=oxkio-comparison-report.pdf"
  });

  doc.pipe(res);

  doc.image(logoPath, 50, 45, {
    width: 55
  });

  doc
    .fontSize(23)
    .fillColor("#0f172a")
    .text("OXKIO COMPARATIVE EXECUTIVE REPORT", {
      align: "center"
    });

  doc
    .moveDown(0.5)
    .fontSize(11)
    .fillColor("#475569")
    .text("Confidential Investment Committee Analysis", {
      align: "center"
    });

  doc.moveDown();

  doc
    .fontSize(11)
    .fillColor("#334155")
    .text(`Fecha: ${new Date().toLocaleString()}`);

  doc.moveDown();

  doc
    .fontSize(16)
    .fillColor("#0f172a")
    .text("Comparativa Ejecutiva", {
      underline: true
    });

  doc.moveDown(0.5);

  doc
    .fontSize(11)
    .fillColor("#334155")
    .text(`Proyecto A: ${data.projectA.project}`)
    .text(`Proyecto B: ${data.projectB.project}`);

  doc.moveDown();

  doc
    .fontSize(16)
    .fillColor("#0f172a")
    .text("Indicadores lado a lado", {
      underline: true
    });

  doc.moveDown(0.5);

  doc
    .fontSize(11)
    .fillColor("#334155")
    .text(`Viabilidad A: ${data.projectA.viabilityScore}/100`)
    .text(`Viabilidad B: ${data.projectB.viabilityScore}/100`)
    .moveDown(0.3)
    .text(`Riesgo A: ${data.projectA.riskScore}/100`)
    .text(`Riesgo B: ${data.projectB.riskScore}/100`)
    .moveDown(0.3)
    .text(`Escalabilidad A: ${data.projectA.scalabilityScore}/100`)
    .text(`Escalabilidad B: ${data.projectB.scalabilityScore}/100`);

  doc.moveDown();

  doc
    .fontSize(16)
    .fillColor("#0f172a")
    .text("Ranking Ejecutivo", {
      underline: true
    });

  doc.moveDown(0.5);

  doc
    .fontSize(11)
    .fillColor("#334155")
    .text(`Puntuación Proyecto A: ${data.scoreA}`)
    .text(`Puntuación Proyecto B: ${data.scoreB}`)
    .text(`Ganador global: ${data.globalWinner}`);

  doc.moveDown();

  doc
    .fontSize(16)
    .fillColor("#0f172a")
    .text("Ganadores por categoría", {
      underline: true
    });

  doc.moveDown(0.5);

  doc
    .fontSize(11)
    .fillColor("#334155")
    .text(`Viabilidad: ${data.viabilityWinner}`)
    .text(`Menor riesgo: ${data.riskWinner}`)
    .text(`Escalabilidad: ${data.scalabilityWinner}`);

  doc.addPage();

  doc.image(logoPath, 50, 35, {
    width: 35
  });

  doc
    .fontSize(20)
    .fillColor("#0f172a")
    .text("EXECUTIVE ADVISOR GPT", {
      align: "center"
    });

  doc
    .moveDown()
    .fontSize(11)
    .fillColor("#334155")
    .text(data.decision || "No hay decisión ejecutiva disponible.", {
      align: "left"
    });

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
  generateComparisonPDF
};
