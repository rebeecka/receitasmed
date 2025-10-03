// backend/src/routes/suggest.ts
import { Router, Request, Response } from "express";
import { suggestFromExam } from "../lib/suggestFromExam";

const router = Router();

/**
 * POST /suggest-from-exam
 * Body: { rawText?: string }
 */
router.post("/suggest-from-exam", (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    // validação leve: rawText opcional e deve ser string se vier
    if (body.rawText !== undefined && typeof body.rawText !== "string") {
      return res.status(400).json({ error: "invalid_body", detail: "`rawText` must be a string" });
    }

    const rawText = (body.rawText as string) ?? "";
    const plan = suggestFromExam(rawText);
    return res.json(plan);
  } catch (err) {
    console.error("suggest-from-exam error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
