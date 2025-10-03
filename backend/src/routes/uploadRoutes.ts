// backend/src/routes/uploadRoutes.ts
import express, { Request, Response } from "express";
import multer from "multer";
// @ts-ignore - pdf-parse não exporta tipos completos por padrão
import pdfParse from "pdf-parse";
import { createHash } from "node:crypto";
import mongoose, { Schema, InferSchemaType } from "mongoose";
import OpenAI, { APIError } from "openai";

const router = express.Router();

// ========== OpenAI SDK ==========
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // organization: process.env.OPENAI_ORG, // opcional
});

// ========== Tipos ==========
type PlanKeys = "supplements" | "fitoterapia" | "dieta" | "exercicios" | "estiloVida";

export interface Plan {
  supplements: string[];
  fitoterapia: string[];
  dieta: string[];
  exercicios: string[];
  estiloVida: string[];
}

interface CachePayload {
  plan: Plan;
  modelUsed: string;
  at: number;
}

// ========== Mongoose Model ==========
const ExamSchema = new Schema(
  {
    filename: String,
    mimetype: String,
    size: Number,
    hash: { type: String, index: true },
    text: String,
    meta: Object,
  },
  { timestamps: true }
);
type ExamDoc = InferSchemaType<typeof ExamSchema> & { _id: mongoose.Types.ObjectId };
const Exam = (mongoose.models.Exam as mongoose.Model<ExamDoc>) || mongoose.model<ExamDoc>("Exam", ExamSchema);

// ========== Multer (memória) ==========
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

// ========== Cache simples em memória ==========
/** key: sha256(text) -> { plan, modelUsed, at } (apenas sucesso da IA) */
const memCache = new Map<string, CachePayload>();

// ========== Utils ==========
function examKey(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
function bufToSha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Prompt 100% dependente do exame, sem heurísticas internas */
function montarPrompt(extractedText: string): string {
  return [
    "Você é um assistente clínico que cria um PLANO ESTRUTURADO e ESTRITAMENTE PERSONALIZADO a partir do texto de um exame laboratorial.",
    "Regra: use SOMENTE as informações presentes no exame fornecido; não invente marcadores que não estejam no texto.",
    "Inclua recomendações APENAS quando houver indícios no exame. Se um marcador estiver dentro da referência, não recomende nada sobre ele.",
    'Formato de saída: JSON VÁLIDO exatamente com as chaves {"supplements":[],"fitoterapia":[],"dieta":[],"exercicios":[],"estiloVida":[]}.',
    "Cada item deve ser uma string curta, prática e específica ao achado do exame.",
    "Se não houver nada a recomendar em alguma seção, retorne um array vazio para aquela chave.",
    "",
    "Exame (texto bruto, use como única fonte):",
    extractedText.slice(0, 18000),
  ].join("\n");
}

/** Tenta JSON direto; sem regras — se não for JSON, tenta capturar listas se o modelo soltou seções. */
function parsePlano(modelOutput: string): Plan {
  // 1) JSON direto
  try {
    const maybe = JSON.parse(modelOutput) as Partial<Record<PlanKeys, unknown>>;
    const shape: Plan = {
      supplements: Array.isArray(maybe?.supplements) ? (maybe.supplements as string[]) : [],
      fitoterapia: Array.isArray(maybe?.fitoterapia) ? (maybe.fitoterapia as string[]) : [],
      dieta: Array.isArray(maybe?.dieta) ? (maybe.dieta as string[]) : [],
      exercicios: Array.isArray(maybe?.exercicios) ? (maybe.exercicios as string[]) : [],
      estiloVida: Array.isArray(maybe?.estiloVida) ? (maybe.estiloVida as string[]) : [],
    };
    return shape;
  } catch {
    // 2) Se não veio JSON, tenta extrair listas por seções rotuladas
    const out: Plan = { supplements: [], fitoterapia: [], dieta: [], exercicios: [], estiloVida: [] };
    const sections: Array<{ key: PlanKeys; rx: RegExp; bodyIndex?: number }> = [
      { key: "supplements", rx: /(suplementos?|supplements?)\s*[:\-]\s*([\s\S]+?)(?:\n\n|$)/i, bodyIndex: 2 },
      { key: "fitoterapia", rx: /(fitoterapia|fitotherap(y|ia))\s*[:\-]\s*([\s\S]+?)(?:\n\n|$)/i, bodyIndex: 2 },
      { key: "dieta", rx: /(dieta|diet)\s*[:\-]\s*([\s\S]+?)(?:\n\n|$)/i, bodyIndex: 2 },
      { key: "exercicios", rx: /(exerc[ií]cios?|exercises?)\s*[:\-]\s*([\s\S]+?)(?:\n\n|$)/i, bodyIndex: 2 },
      { key: "estiloVida", rx: /(estilo\s*de\s*vida|lifestyle)\s*[:\-]\s*([\s\S]+?)(?:\n\n|$)/i, bodyIndex: 2 },
    ];
    for (const s of sections) {
      const m = modelOutput.match(s.rx);
      const body = m?.[s.bodyIndex ?? 2];
      if (body) {
        body
          .split(/\n|•|\-/)
          .map((x: string) => x.trim())
          .filter((x: string) => Boolean(x))
          .forEach((x: string) => out[s.key].push(x));
      }
    }
    return out;
  }
}

/** Chama a IA; distingue 429 quota vs rate-limit; sem fallback de regras */
async function safeSuggest(prompt: string, model = process.env.SUGGEST_MODEL || "gpt-4o-mini"): Promise<
  | { ok: true; data: string; modelUsed: string }
  | { ok: false; kind: "quota" | "rate" | "other"; requestId?: string; retryAfter?: string; message?: string }
> {
  try {
    const r = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      // Se suportado na sua conta, force JSON:
      // response_format: { type: "json_object" } as any,
      messages: [
        { role: "system", content: "Responda SOMENTE com JSON válido." },
        { role: "user", content: prompt },
      ],
    });
    const content = r.choices?.[0]?.message?.content ?? "";
    return { ok: true, data: content, modelUsed: model };
  } catch (err: unknown) {
    // Type guard leve para APIError
    const e = err as Partial<APIError> & {
      status?: number;
      code?: string;
      type?: string;
      requestID?: string;
      error?: { code?: string; type?: string };
      headers?: Headers | { get?(k: string): string | undefined };
      message?: string;
    };

    const status = e?.status;
    const code = e?.error?.code || e?.code;
    const type = e?.error?.type || e?.type;
    const requestId = e?.requestID;

    if (status === 429 && (code === "insufficient_quota" || type === "insufficient_quota")) {
      return { ok: false, kind: "quota", requestId };
    }
    if (status === 429) {
      const retryAfter =
        (typeof e?.headers?.get === "function" && e.headers.get("retry-after")) ||
        (typeof (e?.headers as any)?.["retry-after"] === "string" ? (e as any).headers["retry-after"] : undefined);
      return { ok: false, kind: "rate", requestId, retryAfter };
    }
    return { ok: false, kind: "other", requestId, message: e?.message || "AI error" };
  }
}

// ========== Rota: upload de PDF ==========
router.post("/upload", upload.single("exame"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Selecione um PDF no campo 'exame'." });
    if (req.file.mimetype !== "application/pdf") {
      return res.status(400).json({ error: "Arquivo precisa ser PDF." });
    }

    const fileHash = bufToSha256(req.file.buffer);
    const parsed: any = await pdfParse(req.file.buffer);
    const extractedText: string = (parsed.text || "").trim();

    if (!extractedText) return res.status(422).json({ error: "Não foi possível extrair texto do PDF." });

    // Upsert por hash (evita duplicata)
    const doc = await Exam.findOneAndUpdate(
      { hash: fileHash },
      {
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        hash: fileHash,
        text: extractedText,
        meta: { pages: parsed.numpages, info: parsed.info || null },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return res.json({
      ok: true,
      examId: doc._id,
      hash: fileHash,
      pages: parsed.numpages,
      filename: req.file.originalname,
    });
  } catch (err) {
    console.error("Erro /upload:", err);
    return res.status(500).json({ error: "Falha no upload/análise do PDF." });
  }
});

// ========== Rota: obter exame ==========
router.get("/exam/:id", async (req: Request, res: Response) => {
  try {
    const doc = await Exam.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: "Exame não encontrado." });
    res.json({ ok: true, exam: doc });
  } catch (err) {
    console.error("Erro /exam/:id", err);
    res.status(500).json({ error: "Falha ao buscar exame." });
  }
});

// ========== Rota: suggest (IA obrigatória) ==========
/**
 * Body aceito:
 * - { examId: string }  OU
 * - { extractedText: string }
 *
 * Sem regras internas: se a IA não responder, retorna 503 sem fallback.
 */
router.post("/suggest", async (req: Request, res: Response) => {
  try {
    let extractedText = req.body?.extractedText as string | undefined;

    if (!extractedText && req.body?.examId) {
      const doc = await Exam.findById(req.body.examId as string).lean();
      if (!doc) return res.status(404).json({ error: "Exame não encontrado." });
      extractedText = (doc as any).text as string;
    }
    if (!extractedText) {
      return res.status(400).json({ error: "Forneça 'extractedText' ou 'examId'." });
    }

    const key = examKey(extractedText);

    // Cache apenas de sucesso anterior (IA)
    if (memCache.has(key)) {
      return res.json({ fromCache: true, ...memCache.get(key) });
    }

    const prompt = montarPrompt(extractedText);

    // 1) Modelo principal
    let result = await safeSuggest(prompt, process.env.SUGGEST_MODEL || "gpt-4o-mini");

    // 2) Se cota estourou, tenta fallback de MODELO (continua IA), se configurado
    if (!result.ok && result.kind === "quota" && process.env.SUGGEST_MODEL_FALLBACK) {
      result = await safeSuggest(prompt, process.env.SUGGEST_MODEL_FALLBACK);
    }

    // 3) Sucesso IA → parse + cache
    if (result.ok) {
      const plan = parsePlano(result.data);
      const payload: CachePayload = { plan, modelUsed: result.modelUsed, at: Date.now() };
      memCache.set(key, payload);
      return res.json(payload);
    }

    // 4) Falhou IA → SEM fallback; retorna erro claro
    const motivo =
      !result.ok && result.kind === "quota"
        ? "quota_exceeded"
        : !result.ok && result.kind === "rate"
        ? "rate_limited"
        : "ai_error";

    return res.status(503).json({
      error: "AI temporarily unavailable",
      reason: motivo,
      requestId: !result.ok ? result.requestId : undefined,
      retryAfter: !result.ok ? result.retryAfter : undefined,
      message: !result.ok && result.kind === "other" ? result.message : undefined,
    });
  } catch (err) {
    console.error("Erro /suggest:", err);
    return res.status(500).json({ error: "Falha ao gerar sugestões." });
  }
});

export default router;
