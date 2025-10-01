import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import pdfParse from 'pdf-parse';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
const upload = multer({ dest: 'uploads/' });

app.post('/api/upload/pdf', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

    const pdfBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdfParse(pdfBuffer);
    const text = pdfData.text;

    // Chamada para OpenAI
    const openaiResp = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Você é um especialista em saúde que sugere recomendações naturais, suplementos, dieta, exercícios e meditação baseados em exames de sangue.'
          },
          {
            role: 'user',
            content: `Analise este exame de sangue e forneça sugestões em JSON: ${text}`
          }
        ],
        temperature: 0.7
      },
      { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    const suggestions = openaiResp.data.choices[0].message.content;

    res.json({ suggestions });
    fs.unlinkSync(req.file.path); // Remove o PDF temporário
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no processamento' });
  }
});

app.listen(4000, () => console.log('Backend rodando na porta 4000'));
