import { Router, Request, Response } from "express";
import multer from "multer";
import pdfParse from "pdf-parse";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "node:fs/promises";
import path from "node:path";

// ---------- Utilidades ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const NUM_UNIT = /([+-]?\d+(?:[.,]\d+)?)(?:\s*)([%a-zA-Z/µμ]+)?/; // número + unidade (genérico)
const MANY_SPACES = /\s{2,}/;

// Normaliza decimal pt-BR -> “.”
const normDec = (s: string) => s.replace(/,/g, ".");

// Extrai pares chave:valor em linhas soltas
function parseKeyValues(lines: string[]) {
  const out: Array<{ label: string; value?: number; unit?: string; raw: string }> = [];
  for (const line of lines) {
    const m = line.match(/^\s*([^:：]+?)\s*[:：]\s*(.+?)\s*$/); // aceita ":" e "：" (wide)
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

// Extrai "tabela" baseada em colunas separadas por muitos espaços
function parseTables(lines: string[]) {
  const tables: Array<{ headers: string[]; rows: string[][]; raw: string[] }> = [];
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length >= 2) {
      const hdr = buffer[0].split(MANY_SPACES).map(s => s.trim());
      const rows = buffer.slice(1).map(r => r.split(MANY_SPACES).map(s => s.trim()));
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

// Converte tabelas em testes genéricos quando parecer “Exame | Resultado | Unidade | Ref.”
function tablesToTests(tables: Array<{ headers: string[]; rows: string[][] }>) {
  const tests: Array<any> = [];
  for (const t of tables) {
    const H = t.headers.map(h => h.toLowerCase());
    const colIdx = {
      test: H.findIndex(h => /(exame|teste|analyte|analito|parametro|item|nome)/.test(h)),
      result: H.findIndex(h => /(resultado|result|valor|value)/.test(h)),
      unit: H.findIndex(h => /(unidade|unit)/.test(h)),
      ref: H.findIndex(h => /(ref|refer|intervalo|range)/.test(h)),
      flag: H.findIndex(h => /(flag|obs|interpreta|class)/.test(h)),
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
          confidence: 0.85, // heurística básica
        });
      }
    }
  }
  return tests;
}

// Heurística para meta (paciente, data, laboratório) – melhor quando o PDF traz cabeçalho
function guessMeta(text: string) {
  const meta: Record<string, string> = {};
  const name = text.match(/Paciente\s*[:：]\s*(.+)/i);
  const date = text.match(/(Coleta|Emissão|Emitido|Data)\s*[:：]\s*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})/i);
  const lab = text.match(/Laborat[oó]rio\s*[:：]\s*(.+)/i);
  if (name) meta.paciente = name[1].trim();
  if (date) meta.data = date[2].trim();
  if (lab) meta.laboratorio = lab[1].trim();
  return meta;
}

// ---------- Router ----------
const router = Router();

// 1) Universal: analisar e devolver estrutura genérica (sem listas fixas)
router.post("/analisar-exame", upload.single("exame"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Arquivo não enviado (campo 'exame')." });

    // (A) Extrair texto
    const parsed = await pdfParse(req.file.buffer);
    let text = (parsed.text || "").replace(/\r/g, "");
    const lines = text.split("\n").map((s: string) => s.trim()).filter(Boolean);

    // (B) Estruturar
    const meta = guessMeta(text);
    const kv = parseKeyValues(lines).map(k => ({ 
      ...k, 
      confidence: 0.7, 
      source: "key:value" 
    }));
    const tables = parseTables(lines);
    const tableTests = tablesToTests(tables);

    // (C) Consolidar “tests” genéricos sem dicionário
    const tests = [
      ...tableTests,
      ...kv.map(k => ({ 
        label: k.label, value: k.value, unit: k.unit, rowText: k.raw, source: k.source, confidence: k.confidence 
      }))
    ];

    // (D) Sinalizar se provavelmente é PDF escaneado (quase sem texto)
    const maybeScanned = text.trim().length < 50;

    return res.json({
      ok: true,
      meta,
      maybeScanned,
      textSnippet: text.slice(0, 1500),
      tests,            // <- lista aberta, serve para qualquer exame
      tablesRaw: tables // <- se quiser renderizar tabelas no front
    });
  } catch (e: any) {
    console.error("Erro /analisar-exame-universal:", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

// 2) Gerar receituário em cima do template – recebe tests genéricos do cliente
router.post("/gerar-receituario", upload.single("exame"), async (req: Request, res: Response) => {
  try {
    // a) “tests” podem vir do front (editados/confirmados) em JSON
    let testsFromClient: Array<{ label: string; value?: number; unit?: string }> | null = null;
    if (req.body?.tests) {
      try {
        testsFromClient = JSON.parse(String(req.body.tests));
      } catch {
        return res.status(400).json({ error: "Formato inválido de 'tests' (JSON)." });
      }
    }

    // b) Se não vier “tests”, tentamos extrair rápido (como no analisar)
    if (!testsFromClient && req.file) {
      const parsed = await pdfParse(req.file.buffer);
      const text = (parsed.text || "").replace(/\r/g, "");
      const lines = text.split("\n").map((s: string) => s.trim()).filter(Boolean);
      const kv = parseKeyValues(lines).map(k => ({ label: k.label, value: k.value, unit: k.unit }));
      const tables = parseTables(lines);
      const tableTests = tablesToTests(tables);
      testsFromClient = [...tableTests, ...kv];
    }

    if (!testsFromClient) {
      return res.status(400).json({ error: "Envie 'tests' (JSON) ou o arquivo do exame." });
    }

    // c) Carregar template e escrever as 5 seções
    const tplPath = path.join(process.cwd(), "assets", "receituario.pdf");
    const tplBytes = await fs.readFile(tplPath);
    const pdfDoc = await PDFDocument.load(tplBytes);
    const page = pdfDoc.getPages()[0];
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Posicionamento (ajuste fino conforme seu layout)
    let x = 40, y = page.getHeight() - 110;
    const draw = (txt: string, f = font, size = 10) => { page.drawText(txt, { x, y, size, font: f, color: rgb(0,0,0) }); y -= size + 3; };

    // Cabeçalho
    draw("Condutas (rascunho automático) — revisar antes de prescrever", bold, 12); y -= 3;

    // Resumo genérico dos “tests” (sem supor marcadores)
    draw("Observações do exame:", bold, 11);
    const summarizable = testsFromClient
      .slice(0, 18) // evita exagero na primeira página
      .map(t => `• ${t.label}${t.value != null ? `: ${t.value}` : ""}${t.unit ? ` ${t.unit}` : ""}`)
      .join("  |  ");
    for (const line of wrapText(summarizable, 110)) draw(line);

    // Seções pedidas (aqui você injeta suas regras/IA se quiser automatizar conteúdo)
    y -= 6; draw("Suplementos:", bold, 11);
    for (const line of wrapText("• (preencha conforme a avaliação do caso — campo aberto)", 110)) draw(line);

    y -= 4; draw("Fitoterapia Chinesa:", bold, 11);
    for (const line of wrapText("• (campo aberto)", 110)) draw(line);

    y -= 4; draw("Dieta:", bold, 11);
    for (const line of wrapText("• (campo aberto)", 110)) draw(line);

    y -= 4; draw("Exercícios:", bold, 11);
    for (const line of wrapText("• (campo aberto)", 110)) draw(line);

    y -= 4; draw("Meditação:", bold, 11);
    for (const line of wrapText("• (campo aberto)", 110)) draw(line);

    const out = await pdfDoc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Receituario_${Date.now()}.pdf"`);
    return res.status(200).send(Buffer.from(out));
  } catch (e: any) {
    console.error("Erro /gerar-receituario-universal:", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

// helper local
function wrapText(text: string, maxChars = 110) {
  const parts: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
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

export default router;
