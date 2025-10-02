import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import router from "./routes/uploadRoutes";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// --- Conexão com MongoDB ---
const mongoURI =
  process.env.MONGO_URI ||
  "mongodb+srv://rebecca:R39716938a@cluster0.mb29cqx.mongodb.net/receitasmed_db?retryWrites=true&w=majority";

mongoose
  .connect(mongoURI)
  .then(() => console.log("✅ MongoDB conectado"))
  .catch((err) => console.error("❌ Erro ao conectar no MongoDB:", err));

// --- Rotas ---
app.get("/", (_req, res) => res.status(200).send("OK"));
app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use("/", router); // <--- aqui ficam /analisar-exame-universal e /gerar-receituario-universal


const PORT: number = Number(process.env.PORT) || 4000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Backend rodando na porta ${PORT}`)
);
