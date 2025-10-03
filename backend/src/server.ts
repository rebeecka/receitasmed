import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import router from "./routes/uploadRoutes";      // deve expor /analisar-exame, /gerar-receituario, etc (sem /api)
import { suggestRouter } from "./routes/suggest"; // deve expor /suggest (sem /api)
import OpenAI from "openai";

dotenv.config();

const app = express();

// --- Middlewares (ANTES das rotas) ---
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// --- Mongo ---
const mongoURI =
  process.env.MONGO_URI ||
  "mongodb+srv://rebecca:R39716938a@cluster0.mb29cqx.mongodb.net/receitasmed_db?retryWrites=true&w=majority";

mongoose
  .connect(mongoURI)
  .then(() => console.log("✅ MongoDB conectado"))
  .catch((err) => console.error("❌ Erro ao conectar no MongoDB:", err));

// --- Health ---
app.get("/", (_req, res) => res.status(200).send("OK"));
app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// --- Health da IA ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
app.get("/health-ia", async (_req, res) => {
  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  if (!hasKey) {
    return res.status(503).json({ hasKey, model, ok: false, error: "OPENAI_API_KEY ausente" });
  }

  try {
    const r = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
    });
    return res.json({ hasKey, model, ok: !!r.choices?.length });
  } catch (e: any) {
    // Não exponha a chave; retorne um diagnóstico útil
    return res.status(502).json({
      hasKey,
      model,
      ok: false,
      error: e?.message || String(e),
      code: e?.code || null,
      status: e?.status || null,
    });
  }
});


// --- ROTAS PRINCIPAIS (Monte com prefixo /api) ---
app.use("/api", router);         // <- agora /api/analisar-exame, /api/gerar-receituario, etc.
app.use("/api/suggest", suggestRouter);  // <- agora /api/suggest

// --- 404 JSON ---
app.use((req, res) => {
  res.status(404).json({
    error: `Rota não encontrada: ${req.method} ${req.originalUrl}`,
  });
});

// --- Erros ---
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: err?.message || "Erro interno" });
});

// --- Porta ---
const PORT: number = Number(process.env.PORT) || 4000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend rodando na porta ${PORT}`);
});
