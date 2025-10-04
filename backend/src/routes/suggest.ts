import { Router } from "express";
import { suggestFromExam } from "../lib/suggestFromExam";

export const suggestRouter = Router();

/**
 * POST /api/suggest
 * body: { rawExamText: string, patientName?: string }
 */
suggestRouter.post("/", async (req, res) => {
  try {
    const { rawExamText, patientName } = req.body || {};
    if (!rawExamText || typeof rawExamText !== "string") {
      return res.status(400).json({ error: "rawExamText vazio ou inválido" });
    }
    const suggestions = await suggestFromExam(rawExamText, patientName);
    res.json({ suggestions });
  } catch (e: any) {
    console.error("suggest error:", e);
    res.status(500).json({ error: e?.message || "Erro interno" });
  }
});
