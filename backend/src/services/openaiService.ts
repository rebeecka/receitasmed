import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const OPENAI_KEY = process.env.OPENAI_API_KEY;

export async function callOpenAI(systemPrompt: string, userPrompt: string) {
  if (!OPENAI_KEY) {
    throw new Error("OPENAI_API_KEY não encontrada no .env");
  }

  const payload = {
    model: 'gpt-4o-mini', // você pode trocar por "gpt-4o" se quiser algo mais robusto
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.2,
    max_tokens: 1200
  };

  const resp = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    payload,
    { headers: { Authorization: `Bearer ${OPENAI_KEY}` } }
  );

  const text: string = resp.data.choices?.[0]?.message?.content ?? '';

  // Tenta fazer parse em JSON — se falhar, devolve string bruta
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
