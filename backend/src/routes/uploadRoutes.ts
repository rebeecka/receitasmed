/// <reference types="node" />

import express, { Request, Response } from "express";
import multer from "multer";
import _pdfParse from "pdf-parse";
import { createHash } from "crypto";
import mongoose, { Schema, InferSchemaType } from "mongoose";
import OpenAI from "openai";
import PDFDocument from "pdfkit";

const router = express.Router();

/** OpenAI */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** pdf-parse compat CJS/ESM */
const pdfParse: (data: Buffer) => Promise<{ text: string; numpages: number; info: any }> =

  (_pdfParse as any)?.default ?? (_pdfParse as any);

/** Tipos */
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
type SuggestOk = { ok: true; data: string; modelUsed: string };
type SuggestErrKind = "quota" | "rate" | "other";
type SuggestErr = {
  ok: false;
  kind: SuggestErrKind;
  requestId?: string;
  retryAfter?: string;
  message?: string;
};
type SuggestResult = SuggestOk | SuggestErr;
function isSuggestErr(r: SuggestResult): r is SuggestErr { return r.ok === false; }

/** Mongoose */
const ExamSchema = new Schema(
  {
    filename: String,
    mimetype: String,
    size: Number,
    hash: { type: String, index: true },
    text: String,
    meta: Object
  },
  { timestamps: true }
);
type ExamDoc = InferSchemaType<typeof ExamSchema> & { _id: mongoose.Types.ObjectId };
const Exam = (mongoose.models.Exam as mongoose.Model<ExamDoc>) || mongoose.model<ExamDoc>("Exam", ExamSchema);

/** Multer memória */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/** Cache */
const memCache = new Map<string, CachePayload>();

/** Utils */
const examKey = (text: string) => createHash("sha256").update(text).digest("hex");
const bufToSha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

/** Prompt IA – SEM regras determinísticas, 100% personalizado por exame */
function montarPrompt(extractedText: string): string {
  return [
    "Gere recomendações PERSONALIZADAS estritamente a partir do exame abaixo.",
    'Responda SOMENTE com JSON VÁLIDO no formato: {"supplements":[],"fitoterapia":[],"dieta":[],"exercicios":[],"estiloVida":[]}.',
    "Regras:",
    "- Use apenas o que está no texto (sem inventar marcadores).",
    "- Frases curtas e práticas, específicas ao achado.",
    "- Se alguma categoria não tiver nada, devolva [].",
    "",
    "Exame (texto bruto):",
    extractedText.slice(0, 18000),
  ].join("\n");
}
function parsePlano(modelOutput: string): Plan {
  try {
    const maybe = JSON.parse(modelOutput) as Partial<Record<PlanKeys, unknown>>;
    return {
      supplements: Array.isArray(maybe?.supplements) ? (maybe.supplements as string[]) : [],
      fitoterapia: Array.isArray(maybe?.fitoterapia) ? (maybe.fitoterapia as string[]) : [],
      dieta: Array.isArray(maybe?.dieta) ? (maybe.dieta as string[]) : [],
      exercicios: Array.isArray(maybe?.exercicios) ? (maybe.exercicios as string[]) : [],
      estiloVida: Array.isArray(maybe?.estiloVida) ? (maybe.estiloVida as string[]) : [],
    };
  } catch {
    // fallback leve: tenta raspar blocos
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
          .filter(Boolean)
          .forEach((x: string) => (out[s.key] as string[]).push(x));
      }
    }
    return out;
  }
}
async function safeSuggest(prompt: string, model = process.env.SUGGEST_MODEL || "gpt-4o-mini"): Promise<SuggestResult> {
  try {
    const r = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: "Responda SOMENTE com JSON válido." },
        { role: "user", content: prompt },
      ],
    });
    const content = r.choices?.[0]?.message?.content ?? "";
    return { ok: true, data: content, modelUsed: model };
  } catch (err: unknown) {
    const e = err as {
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

/** Upload handler */
async function handleUploadBuffer(
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  res: Response
) {
  const parsed = await pdfParse(file.buffer);
  const extractedText: string = (parsed?.text || "").trim();
  if (!extractedText) {
    return res.status(422).json({
      error: "PDF sem texto extraível.",
      hint: "Peça ao laboratório um PDF exportado com texto ou use OCR."
    });
  }
  const fileHash = bufToSha256(file.buffer);
  const doc = await Exam.findOneAndUpdate(
    { hash: fileHash },
    {
      filename: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      hash: fileHash,
      text: extractedText,
      meta: { pages: parsed?.numpages, info: (parsed as any)?.info || null },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return res.json({
    ok: true,
    examId: doc._id,
    hash: fileHash,
    pages: parsed?.numpages,
    filename: file.originalname,
    textPreview: extractedText.slice(0, 4000),
    textLength: extractedText.length,
  });
}

/** Rotas de upload */
router.post("/upload", upload.single("exame"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Selecione um PDF no campo 'exame'." });
    if (!req.file.buffer || !Buffer.isBuffer(req.file.buffer)) {
      return res.status(400).json({ error: "Arquivo inválido (sem buffer)." });
    }
    return await handleUploadBuffer(
      {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        buffer: req.file.buffer,
      },
      res
    );
  } catch (err) {
    console.error("Erro /upload:", err);
    return res.status(500).json({ error: "Falha no upload/análise do PDF." });
  }
});
// Alias: /analisar-exame
router.post("/analisar-exame", upload.single("exame"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Selecione um PDF no campo 'exame'." });
    if (!req.file.buffer || !Buffer.isBuffer(req.file.buffer)) {
      return res.status(400).json({ error: "Arquivo inválido (sem buffer)." });
    }
    return await handleUploadBuffer(
      {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        buffer: req.file.buffer,
      },
      res
    );
  } catch (err) {
    console.error("Erro /analisar-exame:", err);
    return res.status(500).json({ error: "Falha no upload/análise do PDF." });
  }
});

// Alias: /analisarexame
router.post("/analisarexame", upload.single("exame"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Selecione um PDF no campo 'exame'." });
    if (!req.file.buffer || !Buffer.isBuffer(req.file.buffer)) {
      return res.status(400).json({ error: "Arquivo inválido (sem buffer)." });
    }
    return await handleUploadBuffer(
      {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        buffer: req.file.buffer,
      },
      res
    );
  } catch (err) {
    console.error("Erro /analisarexame:", err);
    return res.status(500).json({ error: "Falha no upload/análise do PDF." });
  }
});

/** Upload via JSON (base64) */
router.post("/analisar-exame-json", async (req: Request, res: Response) => {
  try {
    const { pdfBase64, filename = "exame.pdf", mimetype = "application/pdf" } = req.body || {};
    if (!pdfBase64) return res.status(400).json({ error: "Envie 'pdfBase64' no corpo." });
    const buffer = Buffer.from(pdfBase64, "base64");
    if (!buffer.length) return res.status(400).json({ error: "pdfBase64 inválido." });
    return await handleUploadBuffer(
      { originalname: filename, mimetype, size: buffer.length, buffer },
      res
    );
  } catch (err) {
    console.error("Erro /analisar-exame-json:", err);
    return res.status(500).json({ error: "Falha ao analisar PDF (JSON)." });
  }
});

/** GET exame */
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

/** IA: sugestão por categorias (sem regras fixas, 100% exame) */
router.post("/suggest", async (req: Request, res: Response) => {
  try {
    let extractedText = req.body?.extractedText as string | undefined;
    if (!extractedText && req.body?.examId) {
      const doc = await Exam.findById(req.body.examId as string).lean();
      if (!doc) return res.status(404).json({ error: "Exame não encontrado." });
      extractedText = (doc as any).text as string;
    }
    if (!extractedText) return res.status(400).json({ error: "Forneça 'extractedText' ou 'examId'." });

    const key = examKey(extractedText);
    const cached = memCache.get(key);
    if (cached) return res.json({ fromCache: true, ...cached });

    const prompt = montarPrompt(extractedText);

    let result = await safeSuggest(prompt, process.env.SUGGEST_MODEL || "gpt-4o-mini");
    if (isSuggestErr(result) && result.kind === "quota" && process.env.SUGGEST_MODEL_FALLBACK) {
      result = await safeSuggest(prompt, process.env.SUGGEST_MODEL_FALLBACK);
    }

    if (!isSuggestErr(result)) {
      const plan = parsePlano(result.data);
      const payload: CachePayload = { plan, modelUsed: result.modelUsed, at: Date.now() };
      memCache.set(key, payload);
      return res.json(payload);
    }

    return res.status(503).json({
      error: "AI temporarily unavailable",
      reason: result.kind,
      requestId: result.requestId,
      retryAfter: result.retryAfter,
      message: result.message,
    });
  } catch (err) {
    console.error("Erro /suggest:", err);
    return res.status(500).json({ error: "Falha ao gerar sugestões." });
  }
});

/** PDF: receituário simples (pdfkit) – mantém para compatibilidade */
router.post("/receituario/pdf", async (req: Request<{}, {}, { paciente?: string; crm?: string; data?: string; observacoes?: string; plano: Plan }>, res: Response) => {
  try {
    const { paciente, crm, data, observacoes, plano } = req.body || {};
    if (!plano) return res.status(400).json({ error: "Envie 'plano' no corpo." });

    const normalized: Plan = {
      supplements: Array.isArray(plano?.supplements) ? plano.supplements : [],
      fitoterapia: Array.isArray(plano?.fitoterapia) ? plano.fitoterapia : [],
      dieta: Array.isArray(plano?.dieta) ? plano.dieta : [],
      exercicios: Array.isArray(plano?.exercicios) ? plano.exercicios : [],
      estiloVida: Array.isArray(plano?.estiloVida) ? plano.estiloVida : [],
    };

    res.setHeader("Content-Type", "application/pdf");
    const filename = `receituario_${(paciente || "paciente").replace(/\s+/g, "_")}.pdf`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    doc.fontSize(18).text("Receituário", { align: "center" }).moveDown(0.5);
    doc.fontSize(10).text(`Paciente: ${paciente || "-"}`);
    doc.text(`CRM: ${crm || "-"}`);
    doc.text(`Data: ${data || new Date().toLocaleDateString("pt-BR")}`);
    doc.moveDown();

    const sections: Array<{ key: PlanKeys; title: string }> = [
      { key: "supplements", title: "Suplementos" },
      { key: "fitoterapia", title: "Fitoterapia" },
      { key: "dieta", title: "Dieta" },
      { key: "exercicios", title: "Exercícios" },
      { key: "estiloVida", title: "Estilo de vida" },
    ];

    doc.fontSize(12);
    for (const s of sections) {
      doc.font("Helvetica-Bold").text(s.title);
      doc.moveDown(0.2);
      doc.font("Helvetica");
      const arr = normalized[s.key] as string[];
      if (!arr?.length) {
        doc.text("—", { indent: 12 }).moveDown(0.5);
      } else {
        for (const item of arr) doc.text(`• ${item}`, { indent: 12 });
        doc.moveDown(0.8);
      }
    }

    if (observacoes) {
      doc.moveDown().font("Helvetica-Bold").text("Observações");
      doc.font("Helvetica").text(observacoes, { indent: 12 });
    }

    doc.end();
  } catch (err) {
    console.error("Erro /receituario/pdf:", err);
    res.status(500).json({ error: "Falha ao gerar PDF do receituário." });
  }
});

/** PDF no SEU TEMPLATE (AcroForm) – como estava antes */
router.post("/receituario/pdf-template", async (req: Request, res: Response) => {
  try {
    const { pdfTemplateBase64, paciente, crm, data, observacoes, plano } = req.body || {};
    if (!pdfTemplateBase64) return res.status(400).json({ error: "Envie 'pdfTemplateBase64' no corpo." });
    if (!plano) return res.status(400).json({ error: "Envie 'plano' no corpo." });

    const normalized: Plan = {
      supplements: Array.isArray(plano?.supplements) ? plano.supplements : [],
      fitoterapia: Array.isArray(plano?.fitoterapia) ? plano.fitoterapia : [],
      dieta: Array.isArray(plano?.dieta) ? plano.dieta : [],
      exercicios: Array.isArray(plano?.exercicios) ? plano.exercicios : [],
      estiloVida: Array.isArray(plano?.estiloVida) ? plano.estiloVida : [],
    };

    const { PDFDocument } = await import("pdf-lib");
    const templateBytes = Buffer.from(pdfTemplateBase64, "base64");
    const pdfDoc = await PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    const joinList = (arr: string[]) => (arr || []).map((s) => `• ${s}`).join("\n");
    const setIfExists = (name: string, value: string) => {
      try { form.getTextField(name).setText(value ?? ""); } catch {}
    };

    setIfExists("paciente", paciente ?? "");
    setIfExists("crm", crm ?? "");
    setIfExists("data", data ?? new Date().toLocaleDateString("pt-BR"));
    setIfExists("observacoes", observacoes ?? "");
    setIfExists("supplements", joinList(normalized.supplements));
    setIfExists("fitoterapia", joinList(normalized.fitoterapia));
    setIfExists("dieta", joinList(normalized.dieta));
    setIfExists("exercicios", joinList(normalized.exercicios));
    setIfExists("estiloVida", joinList(normalized.estiloVida));

    // mantenho editável como antes: NÃO flatten
    // form.flatten(); // <- se quiser tornar não editável, descomente

    const out = await pdfDoc.save();
    res.setHeader("Content-Type", "application/pdf");
    const filename = `receituario_template_${(paciente || "paciente").replace(/\s+/g, "_")}.pdf`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(Buffer.from(out));
  } catch (err) {
    console.error("Erro /receituario/pdf-template:", err);
    return res.status(500).json({ error: "Falha ao gerar PDF do receituário a partir do template." });
  }
});

export default router;
