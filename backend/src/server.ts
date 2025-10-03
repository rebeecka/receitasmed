// backend/src/server.ts
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import uploadRoutes from "./routes/uploadRoutes";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// Mongo
const mongoURI = process.env.MONGO_URI!;
mongoose
  .connect(mongoURI, { dbName: process.env.MONGO_DB || undefined })
  .then(() => console.log("✅ MongoDB conectado"))
  .catch((err) => console.error("❌ Erro Mongo:", err));

// Health
app.get("/", (_req, res) => res.status(200).send("OK"));
app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Health da IA
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
app.get("/health-ia", async (_req, res) => {
  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!hasKey) return res.status(503).json({ ok: false, hasKey, model, error: "OPENAI_API_KEY ausente" });
  try {
    const r = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
    });
    return res.json({ ok: !!r.choices?.length, hasKey, model });
  } catch (e: any) {
    return res.status(502).json({ ok: false, hasKey, model, error: e?.message, code: e?.code, status: e?.status });
  }
});

// API
app.use("/api", uploadRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` }));

// Erros
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: err?.message || "Erro interno" });
});

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Backend rodando na porta ${PORT}`));
