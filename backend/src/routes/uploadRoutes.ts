import { Router } from 'express';
import multer from 'multer';
import { handlePdfAndAskAI } from '../services/pdfService';
import { generatePrescriptionFromEdited } from '../services/pdfTemplateService';

const storage = multer.memoryStorage();
const upload = multer({ storage });

const router = Router();

router.post('/pdf', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'PDF required' });
    const patientName = req.body.patientName || 'Paciente';
    const result = await handlePdfAndAskAI(req.file.buffer, patientName);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no processamento do PDF' });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const { aiJson, patientName } = req.body;
    const fs = require('fs');
    const templateBuffer = fs.readFileSync(
      process.env.RECEITUARIO_TEMPLATE_PATH || './templates/receituario.pdf'
    );

    const outBuffer = await generatePrescriptionFromEdited(
      aiJson,
      patientName,
      templateBuffer
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.send(outBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar PDF' });
  }
});

export default router;
