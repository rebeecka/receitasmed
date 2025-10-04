import { PDFDocument, StandardFonts } from 'pdf-lib';

export async function generatePrescriptionFromEdited(
  aiJson: any,
  patientName: string,
  templateBuffer: Buffer
) {
  const pdfDoc = await PDFDocument.load(templateBuffer);
  const pages = pdfDoc.getPages();
  const page = pages[0];
  const { width, height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 11;

  page.drawText(`Paciente: ${patientName}`, { x: 60, y: height - 120, size: fontSize, font });

  const lines = [
    `Impressão: ${aiJson.impression || ''}`,
    `Suplementos: ${(aiJson.supplements || []).map((s: any) => s.name).join('; ')}`,
    `Fitoterapia: ${(aiJson.tcm || []).map((t: any) => t.name).join('; ')}`,
    `Dieta: ${aiJson.diet || ''}`,
    `Exercícios: ${aiJson.exercise || ''}`,
    `Meditação: ${aiJson.meditation || ''}`,
    `Observações: ${aiJson.warnings || ''}`
  ];

  let y = height - 150;
  for (const l of lines) {
    page.drawText(l, { x: 60, y, size: 10, font, maxWidth: width - 120 });
    y -= 16;
  }

  if (aiJson.short_prescription_text) {
    page.drawText(aiJson.short_prescription_text, {
      x: 60, y: y - 8, size: 10, font, maxWidth: width - 120
    });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
