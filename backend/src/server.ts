import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import router from "./routes/uploadRoutes";
import OpenAI from "openai";
import suggestRouter from "./routes/suggest";
dotenv.config();

const app = express();

// --- Middlewares básicos ---
app.use(cors()); // se quiser, restrinja com { origin: ["seu-app://", "https://..."] }
app.use(express.json());
app.use(express.json({ limit: "1mb" }));

// --- Conexão com MongoDB ---
const mongoURI =
  process.env.MONGO_URI ||
  "mongodb+srv://rebecca:R39716938a@cluster0.mb29cqx.mongodb.net/receitasmed_db?retryWrites=true&w=majority";

 mongoose
    .connect(mongoURI)
    .then(() => console.log("✅ MongoDB conectado"))
    .catch((err) => console.error("❌ Erro ao conectar no MongoDB:", err));

// --- Health básicos ---
app.get("/", (_req, res) => res.status(200).send("OK"));
app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// --- Health da IA: confirma chave e modelo funcionando ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
app.get("/health-ia", async (_req, res) => {
  try {
    const hasKey = !!process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    let ok = false;

    if (hasKey) {
      const r = await openai.chat.completions.create({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      });
      ok = !!r.choices?.length;
    }

    res.json({ hasKey, model, ok });
  } catch (e: any) {
    res.status(500).json({
      hasKey: !!process.env.OPENAI_API_KEY,
      error: e?.message || String(e),
    });
  }
});

// --- Rotas principais (IA + PDF)
//  - /analisar-exame  e  /analisar-exame-universal
//  - /gerar-receituario  e  /gerar-receituario-universal
app.use("/", router);
app.use(suggestRouter);
// --- 404 sempre em JSON (evita HTML no Render/Express) ---
app.use((req, res) => {
  res.status(404).json({
    error: `Rota não encontrada: ${req.method} ${req.originalUrl}`,
  });
});

// --- Handler de erros em JSON ---
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: err?.message || "Erro interno" });
});

// --- Porta ---
const PORT: number = Number(process.env.PORT) || 4000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend rodando na porta ${PORT}`);
});