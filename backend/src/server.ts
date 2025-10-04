/// <reference types="node" />

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import OpenAI from "openai";

dotenv.config();

const app = express();

/* Middlewares */
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

/* Mongo */
const mongoURI =
  process.env.MONGO_URI ||
  "mongodb+srv://rebecca:R39716938a@cluster0.mb29cqx.mongodb.net/receitasmed_db?retryWrites=true&w=majority";

mongoose
  .connect(mongoURI, { dbName: process.env.MONGO_DB || undefined })
  .then(() => console.log("✅ MongoDB conectado"))
  .catch((err) => console.error("❌ Erro Mongo:", err));

/* Health */
app.get("/", (_req: Request, res: Response) => res.status(200).send("OK"));
app.get("/health", (_req: Request, res: Response) =>
  res.json({ ok: true, ts: new Date().toISOString() })
);

/* Health IA (opcional) */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
app.get("/health-ia", async (_req: Request, res: Response) => {
  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  const model = process.env.SUGGEST_MODEL || "gpt-4o-mini";
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

/* ===== Import do router (ESM exige extensão .js no import relativo emitido) ===== */
const { default: uploadRoutes } = await import("./routes/uploadRoutes.js");

/* Rotas principais */
app.use("/api", uploadRoutes);
app.use("/", uploadRoutes);

/* 404 */
app.all("*", (req: Request, res: Response) =>
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` })
);

/* Handler de erros */
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: err?.message || "Erro interno" });
});

/* Porta */
const PORT: number = Number(process.env.PORT) || 4000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Backend rodando na porta ${PORT}`));
