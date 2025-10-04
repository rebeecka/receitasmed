/// <reference types="node" />

import express, { Request, Response } from "express";
import multer from "multer";
import _pdfParse from "pdf-parse";
import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import PDFDocument from "pdfkit";
import { createWorker } from "tesseract.js";

const execFileAsync = promisify(execFile);
const router = express.Router();

/** pdf-parse compat CJS/ESM */
const pdfParse: (data: Buffer) => Promise<{ text: string; numpages: number; info: any }> =
  // @ts-ignore
  (_pdfParse as any)?.default ?? (_pdfParse as any);

/** Upload (memória) */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/** Utils */
const bufToSha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

async function writeTempFile(buffer: Buffer, ext = ".pdf") {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rxmed-"));
  const filePath = path.join(tmpDir, `in${ext}`);
  await fs.writeFile(filePath, buffer);
  return { tmpDir, filePath };
}

/** PDF → imagens (.jpg) via Poppler (pdftoppm) */
async function pdfToImages(pdfPath: string, dpi = 200): Promise<string[]> {
  const outPrefix = path.join(path.dirname(pdfPath), "page");
  await execFileAsync("pdftoppm", ["-jpeg", "-r", String(dpi), pdfPath, outPrefix]);
  const dir = path.dirname(pdfPath);
  const files = await fs.readdir(dir);
  const jpgs = files
    .filter((f) => /^page-\d+\.jpg$/.test(f))
    .map((f) => path.join(dir, f))
    .sort((a, b) => {
      const an = parseInt(a.match(/page-(\d+)\.jpg$/)![1], 10);
      const bn = parseInt(b.match(/page-(\d+)\.jpg$/)![1], 10);
      return an - bn;
    });
  return jpgs;
}

/** OCR com tesseract.js (tipagem atual: reinitialize(lang)) */
async function ocrImages(imagePaths: string[], lang = "por+eng"): Promise<string> {
  // 1º arg de createWorker é 'langs' (string[] | Lang[]), 2º são 'options'
  const worker = await createWorker(undefined as any, { logger: () => {} } as any);

  await worker.load();
  await worker.reinitialize(lang); // <- sua tipagem expõe reinitialize(lang)

  let out = "";
  for (const img of imagePaths) {
    const { data } = await worker.recognize(img);
    out += (data?.text || "") + "\n";
  }

  await worker.terminate();
  return out.trim();
}

/** Extração com pdf-parse e fallback de OCR */
async function extractTextFromPdfBuffer(pdfBuffer: Buffer, lang = "por+eng") {
  // 1) Texto nativo
  let text = "";
  let pages = 0;
  let info: any = null;
  try {
    const parsed = await pdfParse(pdfBuffer);
    text = (parsed?.text || "").trim();
    pages = parsed?.numpages || 0;
    info = (parsed as any)?.info || null;
  } catch {}

  if (text && text.length >= 50) {
    return { text, pages, info, usedOCR: false };
  }

  // 2) OCR fallback
  const { tmpDir, filePath } = await writeTempFile(pdfBuffer, ".pdf");
  try {
    const images = await pdfToImages(filePath, 200); // aumente p/ 300 se precisar
    if (!images.length) return { text, pages, info, usedOCR: false };
    const ocrText = await ocrImages(images, lang);
    const merged = [text, ocrText].filter(Boolean).join("\n").trim();
    return { text: merged, pages, info, usedOCR: true };
  } finally {
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/** Handler central (aceita buffer) */
async function handleUploadBuffer(
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  res: Response,
  lang?: string
) {
  const { text, pages, info, usedOCR } = await extractTextFromPdfBuffer(file.buffer, lang);
  if (!text) {
    return res.status(422).json({
      ok: false,
      error: "PDF sem texto extraível.",
      hint: "Peça ao laboratório um PDF exportado com texto ou use OCR.",
    });
  }

  const fileHash = bufToSha256(file.buffer);
  return res.json({
    ok: true,
    hash: fileHash,
    pages,
    filename: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    rawExamText: text,              // 👈 compatível com o front
    textPreview: text.slice(0, 4000),
    textLength: text.length,
    usedOCR,
    meta: { info },
  });
}

/** ===================== ROTAS ===================== */

/**
 * POST /api/upload
 * - aceita multipart (campo "exame") OU JSON { exameBase64, fileName?, mimeType?, lang? }
 */
router.post("/upload", upload.single("exame"), async (req: Request, res: Response) => {
  try {
    const lang = (req.body?.lang as string) || "por+eng";

    // multipart
    if (req.file?.buffer) {
      return await handleUploadBuffer(
        {
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
          buffer: req.file.buffer,
        },
        res,
        lang
      );
    }

    // JSON base64
    if (req.body?.exameBase64) {
      const buffer = Buffer.from(String(req.body.exameBase64), "base64");
      if (!buffer.length) return res.status(400).json({ error: "exameBase64 inválido." });
      return await handleUploadBuffer(
        {
          originalname: req.body.fileName || "exame.pdf",
          mimetype: req.body.mimeType || "application/pdf",
          size: buffer.length,
          buffer,
        },
        res,
        lang
      );
    }

    return res.status(400).json({ error: "Envie multipart 'exame' ou JSON { exameBase64 }." });
  } catch (err) {
    console.error("Erro /upload:", err);
    return res.status(500).json({ error: "Falha no upload/análise do PDF." });
  }
});

/** Aliases compatíveis com versões antigas */
router.post("/analisar-exame", upload.single("exame"), async (req, res) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: "Selecione um PDF no campo 'exame'." });
    return await handleUploadBuffer(
      {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        buffer: req.file.buffer,
      },
      res,
      "por+eng"
    );
  } catch (err) {
    console.error("Erro /analisar-exame:", err);
    return res.status(500).json({ error: "Falha no upload/análise do PDF." });
  }
});

router.post("/analisarexame", upload.single("exame"), async (req, res) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: "Selecione um PDF no campo 'exame'." });
    return await handleUploadBuffer(
      {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        buffer: req.file.buffer,
      },
      res,
      "por+eng"
    );
  } catch (err) {
    console.error("Erro /analisarexame:", err);
    return res.status(500).json({ error: "Falha no upload/análise do PDF." });
  }
});

/** JSON (base64) legado */
router.post("/analisar-exame-json", async (req: Request, res: Response) => {
  try {
    const { pdfBase64, filename = "exame.pdf", mimetype = "application/pdf", lang = "por+eng" } = req.body || {};
    if (!pdfBase64) return res.status(400).json({ error: "Envie 'pdfBase64' no corpo." });
    const buffer = Buffer.from(pdfBase64, "base64");
    if (!buffer.length) return res.status(400).json({ error: "pdfBase64 inválido." });
    return await handleUploadBuffer(
      { originalname: filename, mimetype, size: buffer.length, buffer },
      res,
      lang
    );
  } catch (err) {
    console.error("Erro /analisar-exame-json:", err);
    return res.status(500).json({ error: "Falha ao analisar PDF (JSON)." });
  }
});

/** (Opcional) PDF simples (pdfkit) – útil para testes rápidos */
router.post("/receituario/pdf", async (req: Request<{}, {}, {
  paciente?: string; crm?: string; data?: string; observacoes?: string;
  plano: { supplements?: string[]; fitoterapia?: string[]; dieta?: string[]; exercicios?: string[]; estiloVida?: string[]; }
}>, res: Response) => {
  try {
    const { paciente, crm, data, observacoes, plano } = req.body || {};
    if (!plano) return res.status(400).json({ error: "Envie 'plano' no corpo." });

    const normalized = {
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

    const sections: Array<{ key: keyof typeof normalized; title: string }> = [
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

export default router;
