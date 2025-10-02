// src/routes/uploadRoutes.ts
import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import axios from "axios";
// Se seu tsconfig NÃO tem "esModuleInterop": true, troque a linha acima de multer por:
// import * as multer from "multer";
import multer from "multer";

import DocumentModel from "../models/Document";
import PrescriptionModel from "../models/Prescription";
// import Patient from "../models/Patient"; // use se realmente precisar

const router = Router();

/** Multer configurado com limites e filtro de PDF */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads"),
  filename: (req, file, cb) => {
    const ts = Date.now();
    const ext = path.extname(file.originalname || ".pdf") || ".pdf";
    cb(null, `${ts}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const multerUpload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Apenas PDFs são aceitos"));
    }
    cb(null, true);
  },
});

// Tipos mínimos para resposta da OpenAI que usamos
type ChatChoice = { message?: { content?: string } };
type OpenAIChatResp = { choices?: ChatChoice[] };

// Utilitário: apagar arquivo com segurança
function safeUnlink(filePath?: string) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch { /* noop */ }
}

router.post(
  "/upload",
  // o campo do FormData precisa ser "file"
  multerUpload.single("file"),
  async (req: Request, res: Response) => {
    let tmpPath: string | undefined;

    try {
      // Garantia de req.file (multer preenche)
      if (!req.file) {
        return res.status(400).json({ error: "Nenhum arquivo enviado" });
      }
      tmpPath = req.file.path;

      const { patientId } = req.body as { patientId?: string };
      if (!patientId) {
        safeUnlink(tmpPath);
        return res.status(400).json({ error: "Paciente obrigatório" });
      }

      // Ler PDF e extrair texto
      const pdfBuffer = fs.readFileSync(req.file.path);
      const pdfData = await pdfParse(pdfBuffer);
      const text = pdfData.text || "";

      console.log("📄 Texto extraído do PDF:", text.slice(0, 200));

      // Persistir documento
      const newDoc = await DocumentModel.create({
        patientId,
        fileName: req.file.originalname,
        filePath: req.file.path,
        textExtracted: text,
      });

      // Verificação de API key
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        safeUnlink(tmpPath);
        return res.status(500).json({ error: "OPENAI_API_KEY não configurada" });
      }

      // Chamada à OpenAI com timeout
      let aiSuggestions = "";
      try {
        const openaiResp = await axios.post<OpenAIChatResp>(
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
                content: `Analise este exame de sangue e forneça sugestões em JSON: ${text}`,
              },
            ],
            temperature: 0.7,
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            timeout: 60_000,
          }
        );

        aiSuggestions = openaiResp.data.choices?.[0]?.message?.content ?? "";
        if (!aiSuggestions) {
          safeUnlink(tmpPath);
          return res.status(502).json({ error: "Resposta vazia da IA" });
        }
      } catch (err: any) {
        console.error("❌ Erro ao chamar OpenAI:", err?.response?.data || err?.message || err);
        safeUnlink(tmpPath);
        return res.status(500).json({ error: "Erro ao processar com IA" });
      }

      // Parse do JSON retornado
      let parsedResult: unknown;
      try {
        parsedResult = JSON.parse(aiSuggestions);
      } catch {
        console.error("❌ JSON inválido da IA. Retorno foi:", aiSuggestions);
        safeUnlink(tmpPath);
        return res.status(500).json({ error: "Resposta da IA inválida", raw: aiSuggestions });
      }

      // Salvar prescrição
      const newPrescription = await PrescriptionModel.create({
        patientId,
        documentId: newDoc._id,
        aiResult: parsedResult,
      });

      // Limpar tmp
      safeUnlink(tmpPath);

      // Responder
      return res.json({
        message: "Exame processado com sucesso",
        document: newDoc,
        prescription: newPrescription,
      });
    } catch (err: any) {
      console.error("❌ Erro geral no upload:", err?.message || err);
      safeUnlink(tmpPath);
      return res.status(500).json({ error: "Erro ao processar PDF" });
    }
  }
);

export default router;
