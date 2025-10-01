import { connectDB } from './db/database';
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import uploadRoutes from "./routes/uploadRoutes";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

connectDB();

app.use("/api", uploadRoutes);

app.listen(4000, () => console.log("🚀 Backend rodando na porta 4000"));
