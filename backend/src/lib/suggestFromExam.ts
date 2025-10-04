// LLM-based suggestions (sem regras fixas)
import 'dotenv/config';

type Suggestions = {
  supplements: string[];
  fitoterapia: string[];
  dieta: string[];
  exercicios: string[];
  estiloVida: string[];
};

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini"; // ou outro
const OPENAI_URL = process.env.OPENAI_URL || "https://api.openai.com/v1/chat/completions";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "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";

if (!OPENAI_API_KEY) {
  console.warn("[warn] OPENAI_API_KEY ausente. Defina no .env");
}

const jsonSchema = {
  type: "object",
  properties: {
    supplements: { type: "array", items: { type: "string" } },
    fitoterapia: { type: "array", items: { type: "string" } },
    dieta:       { type: "array", items: { type: "string" } },
    exercicios:  { type: "array", items: { type: "string" } },
    estiloVida:  { type: "array", items: { type: "string" } },
  },
  required: ["supplements","fitoterapia","dieta","exercicios","estiloVida"],
  additionalProperties: false
};

export async function suggestFromExam(rawExamText: string, patientName?: string): Promise<Suggestions> {
  const sys = [
    "Você é um assistente clínico que gera sugestões PERSONALIZADAS a partir de exames laboratoriais.",
    "Não invente valores. Baseie-se apenas no texto fornecido.",
    "Adapte a linguagem para leigo, objetiva e acionável. Evite jargões.",
    "Não faça diagnósticos; foque em condutas de suporte, estilo de vida e hipóteses para INVESTIGAR com o médico.",
    "Responda **exclusivamente** no JSON pedido (schema)."
  ].join(" ");

  const user = [
    `Paciente: ${patientName || "—"}`,
    "Exame (texto bruto):",
    "```",
    rawExamText || "(vazio)",
    "```",
    "",
    "Gere recomendações personalizadas em 5 listas: supplements, fitoterapia, dieta, exercicios, estiloVida.",
    "Quando houver marcadores de risco, inclua *investigar com especialista* no estiloVida.",
    "Se alguma categoria não tiver itens, retorne array vazio (não invente)."
  ].join("\n");

  const body = {
    model: MODEL,
    temperature: 0.3,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user }
    ],
    // Preferir saída 100% estruturada:
    // Se sua conta suportar response_format com schema, use:
    // response_format: { type: "json_schema", json_schema: { name: "SuggestionsSchema", schema: jsonSchema } }
    // Caso sua conta não suporte json_schema, manter function abaixo como fallback:
    functions: [{
      name: "return_suggestions",
      description: "Retorna sugestões estruturadas.",
      parameters: jsonSchema
    }],
    function_call: { name: "return_suggestions" },
    // opcional para reduzir variação:
    // seed: 7
  };

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI error ${res.status}: ${text}`);
  }

  const data = await res.json();

  // Compatível com function_call
  const fnArgs = data?.choices?.[0]?.message?.function_call?.arguments;
  if (!fnArgs) {
    // fallback: tentar parsear conteúdo como JSON puro
    const content = data?.choices?.[0]?.message?.content;
    try {
      const parsed = JSON.parse(content);
      return parsed;
    } catch {
      throw new Error("Falha ao ler retorno do modelo.");
    }
  }

  let parsed: Suggestions;
  try {
    parsed = JSON.parse(fnArgs);
  } catch {
    throw new Error("Falha ao parsear function_call.arguments.");
  }

  // Sanitização simples
  const norm = (arr: any) => Array.isArray(arr) ? [...new Set(arr.map(String).filter(Boolean))] : [];
  return {
    supplements: norm(parsed.supplements),
    fitoterapia: norm(parsed.fitoterapia),
    dieta:       norm(parsed.dieta),
    exercicios:  norm(parsed.exercicios),
    estiloVida:  norm(parsed.estiloVida),
  };
}
