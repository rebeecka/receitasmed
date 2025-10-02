import { Router, Request, Response } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";

// pdf-parse não tem typings oficiais estáveis em todos os ambientes.
// Com esModuleInterop: true funciona como default import.
// Se der problema, troque por: const pdfParse = require("pdf-parse");
import pdfParse from "pdf-parse";

const uploadRouter = Router();

// se você quiser salvar em disco, troque para diskStorage.
// aqui uso memória para funcionar em qualquer host:
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || /\.pdf$/i.test(file.originalname)) cb(null, true);
    else cb(new Error("Apenas PDF"));
  },
});

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

async function ensureUploadsDir() {
  try { await fs.mkdir(UPLOADS_DIR, { recursive: true }); } catch {}
}

uploadRouter.post("/upload", upload.single("exame"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Arquivo não enviado (campo 'exame')." });

    const buffer = req.file.buffer; // veio da memória
    // Lê o PDF em memória
    const parsed = await pdfParse(buffer);
    const textSnippet = (parsed.text || "").slice(0, 600);

    // Tenta salvar em disco (opcional). Pula se falhar.
    let savedAs: string | null = null;
    try {
      await ensureUploadsDir();
      const safeName = `${Date.now()}-${(req.file.originalname || "exame.pdf").replace(/[^\w.\-]/g, "_")}`;
      const dest = path.join(UPLOADS_DIR, safeName);
      await fs.writeFile(dest, buffer);
      savedAs = safeName;
    } catch {
      // ambiente sem FS persistente (ok)
    }

    return res.status(201).json({
      ok: true,
      pages: parsed.numpages,
      savedAs,
      textSnippet,
    });
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// **Adicione default export** para casar com o import atual do server.ts
export default uploadRouter;
// (Opcional) export nomeado também, se quiser:
// export { uploadRouter };
