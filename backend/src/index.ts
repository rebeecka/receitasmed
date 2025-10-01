import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import uploadRoutes from "./routes/uploadRoutes";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// --- Conexão com MongoDB ---
const mongoURI = process.env.MONGO_URI || "mongodb://localhost:27017/receituario";

mongoose
  .connect(mongoURI)
  .then(() => console.log("✅ MongoDB conectado"))
  .catch((err) => console.error("❌ Erro ao conectar no MongoDB:", err));

// --- Rotas ---
app.use("/api", uploadRoutes);

// --- Porta ---
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Backend rodando na porta ${PORT}`));
