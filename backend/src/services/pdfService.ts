import pdf from 'pdf-parse';

export async function processPdfWithAI(fileBuffer: Buffer, patientName: string) {
  // Usa pdf-parse diretamente no buffer
  const data = await pdf(fileBuffer);

  // Texto extraído do PDF
  const text = data.text;

  // Aqui você pode mandar o texto para a IA processar
  // Exemplo simples só retornando texto + paciente
  return {
    patient: patientName,
    extractedText: text,
  };
}
