import pdfParse from 'pdf-parse';
import { callOpenAI } from './openaiService';
import { generatePrescriptionFromEdited } from './pdfTemplateService';

export async function handlePdfAndAskAI(fileBuffer: Buffer, patientName: string) {
  const data = await pdfParse(fileBuffer);
  const text = data.text || '';

  const labs = extractLabValues(text);

  const systemPrompt = `Você é um assistente clínico que analisa exames de sangue. Responda em português. Retorne apenas JSON seguindo o schema definido. Inclua contraindicações.`;
  const userPrompt = buildPrompt(patientName, labs, text);

  const aiJson = await callOpenAI(systemPrompt, userPrompt);

  return { labs, ai: aiJson, rawTextPreview: text.slice(0, 200) };
}

function extractLabValues(text: string) {
  const get = (rx: RegExp) => {
    const m = text.match(rx);
    return m ? m[1].trim() : null;
  };

  return {
    hemoglobina: get(/Hemoglobina\s*([\d.,]+)/i),
    tsh: get(/TSH[\s\S]*?([\d.,]+)\s*µUI\/mL/i),
    vitaminaD: get(/25 OH Vitamina D\s*([\d.,]+)/i),
    ferro: get(/Ferro\s*([\d.,]+)/i),
    ferritina: get(/Ferritina\s*([\d.,]+)/i),
    hdl: get(/HDL\s*-\s*Colesterol\s*([\d.,]+)/i),
    ldl: get(/LDL\s*-\s*Colesterol\s*([\d.,]+)/i),
    triglicerides: get(/Triglic[eí]rides\s*([\d.,]+)/i),
  };
}


function buildPrompt(patientName: string, labsObj: any, fullText: string) {
  return `Analise os resultados do paciente "${patientName}" e retorne em JSON:
{
  "impression": "...",
  "supplements": [{ "name": "", "dose": "", "frequency": "", "notes": "" }],
  "tcm": [{ "name": "", "usage": "", "contraindications": "" }],
  "diet": "...",
  "exercise": "...",
  "meditation": "...",
  "warnings": "...",
  "short_prescription_text": "..."
}
Valores detectados: ${JSON.stringify(labsObj)}.
Texto completo do exame:
${fullText}`;
}
