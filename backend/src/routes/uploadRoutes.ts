import { Router } from "express";
import multer from "multer";
import fs from "fs";
import pdfParse from "pdf-parse";
import axios from "axios";
import DocumentModel from "../models/Document";
import PrescriptionModel from "../models/Prescription";
import Patient from "../models/Patient";

const router = Router();
const upload = multer({ dest: "uploads/" });

// 📌 Upload e processamento do PDF
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const { patientId } = req.body;
    if (!patientId) {
      return res.status(400).json({ error: "Paciente obrigatório" });
    }

    // 📂 Lê o PDF e extrai texto
    const pdfBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdfParse(pdfBuffer);
    const text = pdfData.text;

    console.log("📄 Texto extraído do PDF:", text.slice(0, 200));

    // 📌 Salva no MongoDB (documents)
    const newDoc = await DocumentModel.create({
      patientId,
      fileName: req.file.originalname,
      filePath: req.file.path,
      textExtracted: text,
    });

    // 📌 Chamada para OpenAI
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY não configurada" });
    }

    let aiSuggestions: string;

    try {
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
              content: `Analise este exame de sangue e forneça sugestões em JSON: ${text}`,
            },
          ],
          temperature: 0.7,
        },
        { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
      );

      aiSuggestions = openaiResp.data.choices[0].message.content;
    } catch (err: any) {
      console.error("❌ Erro ao chamar OpenAI:", err.response?.data || err.message || err);
      return res.status(500).json({ error: "Erro ao processar com IA" });
    }

    // 📌 Parse do JSON da IA
    let parsedResult;
    try {
      parsedResult = JSON.parse(aiSuggestions);
    } catch (err: any) {
      console.error("❌ Erro no JSON da IA. Retorno foi:", aiSuggestions);
      return res.status(500).json({
        error: "Resposta da IA inválida",
        raw: aiSuggestions,
      });
    }

    // 📌 Salva no MongoDB (prescriptions)
    const newPrescription = await PrescriptionModel.create({
      patientId,
      documentId: newDoc._id,
      aiResult: parsedResult,
    });

    // 📂 Remove arquivo temporário
    fs.unlinkSync(req.file.path);

    // 📌 Resposta final
    return res.json({
      message: "Exame processado com sucesso",
      document: newDoc,
      prescription: newPrescription,
    });
  } catch (err: any) {
    console.error("❌ Erro geral no upload:", err.message || err);
    return res.status(500).json({ error: "Erro ao processar PDF" });
  }
});

export default router;
