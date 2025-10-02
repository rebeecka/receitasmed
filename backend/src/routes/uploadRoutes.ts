import { Router, Request, Response } from "express";
import multer from "multer";
import pdfParse from "pdf-parse";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";

// ---------- Config IA ----------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- Upload ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ---------- Regex & utils de parsing ----------
const NUM_UNIT = /([+-]?\d+(?:[.,]\d+)?)(?:\s*)([%a-zA-Z/µμ]+)?/;
const MANY_SPACES = /\s{2,}/;
const normDec = (s: string) => s.replace(/,/g, ".");

// ---------- Helpers gerais ----------
async function resolveTemplatePath(): Promise<string> {
  // Tenta em várias localizações — inclusive variável de ambiente
  const fromEnv = process.env.TEMPLATE_PATH;
  const candidates = [
    fromEnv,
    path.join(process.cwd(), "dist", "assets", "Receituario_Fernando_Fernandes.pdf"),
    path.join(process.cwd(), "dist", "assets", "receituario.pdf"),
    path.join(process.cwd(), "assets", "Receituario_Fernando_Fernandes.pdf"),
    path.join(process.cwd(), "assets", "receituario.pdf"),
    path.join(__dirname, "..", "..", "assets", "Receituario_Fernando_Fernandes.pdf"),
    path.join(__dirname, "..", "..", "assets", "receituario.pdf"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      const buf = await fs.readFile(p);
      if (buf.slice(0, 4).toString() === "%PDF") {
        console.log("[template] usando:", p, "size:", buf.length);
        return p;
      }
    } catch {}
  }
  throw new Error(
    "Template PDF não encontrado. Configure TEMPLATE_PATH ou copie assets para dist/assets."
  );
}

function wrapText(text: string, maxChars = 110) {
  const parts: string[] = [];
  let line = "";
  for (const w of (text || "").split(" ")) {
    const cand = line ? `${line} ${w}` : w;
    if (cand.length > maxChars) {
      if (line) parts.push(line);
      line = w;
    } else {
      line = cand;
    }
  }
  if (line) parts.push(line);
  return parts;
}

// ---------- Parsing do texto ----------
function parseKeyValues(lines: string[]) {
  const out: Array<{ label: string; value?: number; unit?: string; raw: string }> = [];
  for (const line of lines) {
    const m = line.match(/^\s*([^:：]+?)\s*[:：]\s*(.+?)\s*$/);
    if (!m) continue;
    const label = m[1].trim();
    const rhs = m[2].trim();
    const mu = rhs.match(NUM_UNIT);
    if (mu) {
      const value = parseFloat(normDec(mu[1]));
      const unit = mu[2]?.trim();
      if (!Number.isNaN(value)) out.push({ label, value, unit, raw: line });
    } else {
      out.push({ label, raw: line });
    }
  }
  return out;
}

function parseTables(lines: string[]) {
  const tables: Array<{ headers: string[]; rows: string[][]; raw: string[] }> = [];
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length >= 2) {
      const hdr = buffer[0].split(MANY_SPACES).map((s) => s.trim());
      const rows = buffer.slice(1).map((r) => r.split(MANY_SPACES).map((s) => s.trim()));
      tables.push({ headers: hdr, rows, raw: [...buffer] });
    }
    buffer = [];
  };

  for (const line of lines) {
    if (MANY_SPACES.test(line)) buffer.push(line);
    else flush();
  }
  flush();
  return tables;
}

function tablesToTests(tables: Array<{ headers: string[]; rows: string[][] }>) {
  const tests: Array<any> = [];
  for (const t of tables) {
    const H = t.headers.map((h) => h.toLowerCase());
    const colIdx = {
      test: H.findIndex((h) => /(exame|teste|analyte|analito|parametro|item|nome)/.test(h)),
      result: H.findIndex((h) => /(resultado|result|valor|value)/.test(h)),
      unit: H.findIndex((h) => /(unidade|unit)/.test(h)),
      ref: H.findIndex((h) => /(ref|refer|intervalo|range)/.test(h)),
      flag: H.findIndex((h) => /(flag|obs|interpreta|class)/.test(h)),
    };
    for (const row of t.rows) {
      const label = row[colIdx.test] ?? row[0] ?? "";
      const resultStr = row[colIdx.result] ?? "";
      const mu = resultStr.match(NUM_UNIT);
      const value = mu ? parseFloat(normDec(mu[1])) : undefined;
      const unit = mu?.[2];
      const ref = row[colIdx.ref];
      const flag = row[colIdx.flag];
      if (label) {
        tests.push({
          label,
          value: Number.isFinite(value as number) ? value : undefined,
          unit,
          refRange: ref,
          flag,
          rowText: row.join(" | "),
          source: "table",
          confidence: 0.85,
        });
      }
    }
  }
  return tests;
}

function guessMeta(text: string) {
  const meta: Record<string, string> = {};
  const name = text.match(/Paciente\s*[:：]\s*(.+)/i);
  const date = text.match(
    /(Coleta|Emissão|Emitido|Data)\s*[:：]\s*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})/i
  );
  const lab = text.match(/Laborat[oó]rio\s*[:：]\s*(.+)/i);
  if (name) meta.paciente = name[1].trim();
  if (date) meta.data = date[2].trim();
  if (lab) meta.laboratorio = lab[1].trim();
  return meta;
}

// ---------- IA: gera sugestões para as 5 seções ----------
async function aiPlanFromTests(
  tests: Array<{ label: string; value?: number; unit?: string }>,
  opts?: { meta?: any; rawText?: string }
): Promise<{
  suplementos: string[];
  fitoterapia_chinesa: string[];
  dieta: string[];
  exercicios: string[];
  meditacao: string[];
  observacoes: string[];
}> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY ausente");
  }

  const system = [
    "Você é um assistente clínico que gera sugestões EM PORTUGUÊS (Brasil) para um rascunho de receituário.",
    "Não diagnostique, nem prescreva controlados; apenas sugestões educativas com segurança.",
    "Use bullet points curtos e práticos; cite faixas comuns e escreva 'ajuste conforme acompanhamento' quando aplicável."
  ].join(" ");

  const instruction = [
    "Com base nos exames (tests) a seguir, gere um JSON com as chaves:",
    "suplementos, fitoterapia_chinesa, dieta, exercicios, meditacao, observacoes.",
    "Cada chave deve ser um array de strings (bullets).",
    "Se alguma área não tiver nada específico, devolva bullets genéricos seguros.",
    "FORMATO ESTRITO: {\"suplementos\":[],\"fitoterapia_chinesa\":[],\"dieta\":[],\"exercicios\":[],\"meditacao\":[],\"observacoes\":[]}"
  ].join(" ");

  const input = {
    tests,
    meta: opts?.meta ?? null,
    rawTextSnippet: opts?.rawText?.slice(0, 6000) ?? null,
  };

  const resp = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: instruction },
      { role: "user", content: JSON.stringify(input) },
    ],
  });

  const content = resp.choices[0]?.message?.content || "{}";
  let parsed: any = {};
  try { parsed = JSON.parse(content); } catch {}

  const ensureArr = (x: any) => (Array.isArray(x) ? x.map((s) => String(s)) : []);
  return {
    suplementos: ensureArr(parsed.suplementos),
    fitoterapia_chinesa: ensureArr(parsed.fitoterapia_chinesa),
    dieta: ensureArr(parsed.dieta),
    exercicios: ensureArr(parsed.exercicios),
    meditacao: ensureArr(parsed.meditacao),
    observacoes: ensureArr(parsed.observacoes),
  };
}

// ---------- Router ----------
const router = Router();

// Handler de análise (compartilhado)
const analisarHandler = async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Arquivo não enviado (campo 'exame')." });

    const parsed = await pdfParse(req.file.buffer);
    const text = (parsed.text || "").replace(/\r/g, "");
    const lines = text.split("\n").map((s: string) => s.trim()).filter(Boolean);

    const meta = guessMeta(text);
    const kv = parseKeyValues(lines).map((k) => ({
      ...k,
      confidence: 0.7,
      source: "key:value",
    }));
    const tables = parseTables(lines);
    const tableTests = tablesToTests(tables);

    const tests = [
      ...tableTests,
      ...kv.map((k) => ({
        label: k.label,
        value: k.value,
        unit: k.unit,
        rowText: k.raw,
        source: k.source,
        confidence: k.confidence,
      })),
    ];

    const maybeScanned = text.trim().length < 50;

    return res.json({
      ok: true,
      meta,
      maybeScanned,
      textSnippet: text.slice(0, 1500),
      tests,
      tablesRaw: tables,
    });
  } catch (e: any) {
    console.error("Erro /analisar-exame:", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
};

// Handler de geração (compartilhado)
const gerarHandler = async (req: Request, res: Response) => {
  try {
    // a) Pega tests do cliente (se vierem)
    let testsFromClient: Array<{ label: string; value?: number; unit?: string }> | null = null;
    if (req.body?.tests) {
      try {
        testsFromClient = JSON.parse(String(req.body.tests));
      } catch {
        return res.status(400).json({ error: "Formato inválido de 'tests' (JSON)." });
      }
    }

    // b) Se não vier tests, tenta extrair rapidamente do PDF
    let rawText = "";
    if (!testsFromClient && req.file) {
      const parsed = await pdfParse(req.file.buffer);
      rawText = (parsed.text || "").replace(/\r/g, "");
      const lines = rawText.split("\n").map((s: string) => s.trim()).filter(Boolean);
      const kv = parseKeyValues(lines).map((k) => ({
        label: k.label,
        value: k.value,
        unit: k.unit,
      }));
      const tables = parseTables(lines);
      const tableTests = tablesToTests(tables);
      testsFromClient = [...tableTests, ...kv];
    }

    if (!testsFromClient) {
      return res.status(400).json({ error: "Envie 'tests' (JSON) ou o arquivo do exame." });
    }

    // c) IA (opcional)
    let ai: {
      suplementos: string[];
      fitoterapia_chinesa: string[];
      dieta: string[];
      exercicios: string[];
      meditacao: string[];
      observacoes: string[];
    } | null = null;

    const useAI = String(req.query.useAI || "").trim() === "1" || !!process.env.OPENAI_API_KEY;

    if (useAI && process.env.OPENAI_API_KEY) {
      try {
        ai = await aiPlanFromTests(
          testsFromClient.map((t) => ({ label: t.label, value: t.value, unit: t.unit })),
          { rawText }
        );
      } catch (err) {
        console.error("Falha IA:", err);
        ai = null;
      }
    }

    // d) Carrega template
    const tplPath = await resolveTemplatePath();
    const tplBytes = await fs.readFile(tplPath);
    const pdfDoc = await PDFDocument.load(tplBytes);
    const page = pdfDoc.getPages()[0];
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // e) Escreve conteúdo
    let x = 40,
      y = page.getHeight() - 110;
    const draw = (txt: string, f = font, size = 10) => {
      page.drawText(txt, { x, y, size, font: f, color: rgb(0, 0, 0) });
      y -= size + 3;
    };

    draw("Condutas (rascunho automático) — revisar antes de prescrever", bold, 12);
    y -= 3;

    // Resumo dos tests
    draw("Observações do exame:", bold, 11);
    const summarizable = testsFromClient
      .slice(0, 18)
      .map((t) => `• ${t.label}${t.value != null ? `: ${t.value}` : ""}${t.unit ? ` ${t.unit}` : ""}`)
      .join("  |  ");
    for (const line of wrapText(summarizable || "• Sem itens estruturados.", 110)) draw(line);

    const S =
      ai || {
        suplementos: ["(preencha conforme avaliação clínica)"],
        fitoterapia_chinesa: ["(preencha conforme avaliação)"],
        dieta: ["Padrão anti-inflamatório básico.", "Baixo IG; reduzir ultraprocessados."],
        exercicios: ["Aeróbico 150 min/semana.", "Resistido 2–3x/semana."],
        meditacao: ["Mindfulness 10–15 min/dia.", "Higiene do sono."],
        observacoes: [],
      };

    function drawSection(title: string, items: string[]) {
      y -= 6;
      draw(`${title}:`, bold, 11);
      const list = items?.length ? items : ["(sem sugestões no momento)"];
      for (const it of list) for (const line of wrapText(`• ${it}`, 110)) draw(line);
    }

    drawSection("Suplementos", S.suplementos);
    drawSection("Fitoterapia Chinesa", S.fitoterapia_chinesa);
    drawSection("Dieta", S.dieta);
    drawSection("Exercícios", S.exercicios);
    drawSection("Meditação", S.meditacao);

    if (S.observacoes?.length) drawSection("Observações", S.observacoes);

    y -= 8;
    for (const line of wrapText(
      "Nota: conteúdo gerado por IA para apoio, não substitui avaliação e prescrição médica.",
      110
    )) {
      page.drawText(line, { x, y, size: 9, font });
      y -= 12;
    }

    const out = await pdfDoc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Receituario_${Date.now()}.pdf"`);
    return res.status(200).send(Buffer.from(out));
  } catch (e: any) {
    console.error("Erro /gerar-receituario:", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
};

// ---------- Rotas (com aliases p/ compatibilidade) ----------
// análise
router.post("/analisar-exame", upload.single("exame"), analisarHandler);
router.post("/analisar-exame-universal", upload.single("exame"), analisarHandler);

// geração
router.post("/gerar-receituario", upload.single("exame"), gerarHandler);
router.post("/gerar-receituario-universal", upload.single("exame"), gerarHandler);

export default router;
