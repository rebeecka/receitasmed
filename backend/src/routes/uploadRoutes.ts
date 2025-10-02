// src/routes/uploadRoutes.ts
import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import axios from "axios";
import multer from "multer";
import DocumentModel from "../models/Document";
import PrescriptionModel from "../models/Prescription";

const router = Router();

// 1) garantir pasta uploads
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  console.log("📁 Criada pasta:", UPLOAD_DIR);
}

// 2) multer
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const ext = path.extname(file.originalname || ".pdf") || ".pdf";
    cb(null, `${ts}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Apenas PDFs são aceitos"));
    }
    cb(null, true);
  },
});

// util
function safeUnlink(p?: string) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}

router.post(
  "/upload",
  upload.single("file"), // <== o campo do FormData TEM que ser 'file'
  async (req: Request, res: Response) => {
    let tmp: string | undefined;

    try {
      console.log("➡️  /api/upload recebida. body keys:", Object.keys(req.body), "file:", !!req.file);

      if (!req.file) {
        return res.status(400).json({ error: "Nenhum arquivo enviado" });
      }
      tmp = req.file.path;

      const { patientId } = req.body as { patientId?: string };
      if (!patientId) {
        safeUnlink(tmp);
        return res.status(400).json({ error: "Paciente obrigatório (patientId)" });
      }

      // Salva documento + extrai texto
      const buffer = fs.readFileSync(req.file.path);
      const pdfData = await pdfParse(buffer);
      const text = pdfData.text || "";

      const doc = await DocumentModel.create({
        patientId,
        fileName: req.file.originalname,
        filePath: req.file.path,
        textExtracted: text,
        createdAt: new Date(),
      });

      console.log("📄 Documento salvo:", doc._id);

      // 3) chamar IA
      const apiKey = process.env.OPENAI_API_KEY;
      let aiJsonText = "";

      if (!apiKey) {
        console.warn("⚠️  OPENAI_API_KEY ausente — usando fallback mock");
        aiJsonText = JSON.stringify({
          suplementos: [{ nome: "Vitamina D3", dose: "2000 UI/dia" }],
          fitoterapiaChinesa: [],
          dieta: ["Priorize comida de verdade"],
          exercicios: ["150–300 min/semana aeróbico", "2–3x força"],
          meditacao: ["10–15 min/dia mindfulness"],
          disclaimer: "Conteúdo educativo. Requer revisão profissional.",
        });
      } else {
        const openaiResp = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "Você é um especialista em saúde que sugere recomendações naturais, suplementos, dieta, exercícios e meditação baseados em exames de sangue. Responda SOMENTE em JSON válido.",
              },
              {
                role: "user",
                content: `Analise este exame de sangue (trecho): ${text.slice(0, 6000)}`,
              },
            ],
            temperature: 0.4,
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            timeout: 60_000,
          }
        );

        aiJsonText = openaiResp.data?.choices?.[0]?.message?.content || "";
      }

      if (!aiJsonText) {
        safeUnlink(tmp);
        return res.status(502).json({ error: "Resposta vazia da IA" });
      }

      let aiResult: any;
      try {
        aiResult = JSON.parse(aiJsonText);
      } catch {
        console.error("❌ JSON inválido da IA:", aiJsonText);
        safeUnlink(tmp);
        return res.status(500).json({ error: "Resposta da IA inválida", raw: aiJsonText });
      }

      // 4) salva prescrição
      const prescription = await PrescriptionModel.create({
        patientId,
        documentId: doc._id,
        aiResult,
        createdAt: new Date(),
      });

      console.log("📝 Prescrição salva:", prescription._id);

      // se quiser deletar o arquivo físico, descomente:
      // safeUnlink(tmp);

      return res.json({
        message: "Exame processado com sucesso",
        document: doc,
        prescription,
      });
    } catch (e: any) {
      console.error("💥 Erro upload:", e?.response?.data || e?.message || e);
      safeUnlink(tmp);
      return res.status(500).json({ error: "Erro ao processar PDF" });
    }
  }
);

export default router;
