// backend/src/lib/suggestFromExam.ts
export type SuggestedPlan = {
  supplements: string[];
  fitoterapia: string[];
  dieta: string[];
  exercicios: string[];
  estiloVida: string[];
};

type Parsed = { label: string; value?: number; unit?: string };

function normalize(s: string) {
  return (s || "")
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function linesNoNoise(text: string) {
  const BAD = new RegExp(
    [
      "observa[cç][oõ]es?\\s*do\\s*exame",
      "assinado\\s+eletronicamente",
      "metodologia|m[eé]todo",
      "material:",
      "valores?\\s*de\\s*refer[êe]ncia|intervalo\\s*de\\s*refer|\\bvr\\b",
      "data\\s*de\\s*(coleta|recebimento|gera[cç][aã]o)",
      "laborat[oó]rio|\\bcrm\\b|\\bcrf\\b",
      "https?://",
    ].join("|"),
    "i"
  );
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !BAD.test(l));
}
function extractPairs(cleanLines: string[]): Parsed[] {
  const rx =
    /^([A-Za-zÀ-ÿ0-9 .,'()\/\-+%]+?)\s*:\s*([+-]?\d+(?:[.,]\d+)?)\s*([A-Za-zµμ%/·°²³^_-]+)?\s*$/;
  const out: Parsed[] = [];
  for (const ln of cleanLines) {
    const m = ln.match(rx);
    if (!m) continue;
    const label = m[1].replace(/\s{2,}/g, " ").trim().toLowerCase();
    const value = Number(m[2].replace(",", "."));
    let unit = (m[3] || "").replace(/μ/g, "µ");
    out.push({ label, value: isFinite(value) ? value : undefined, unit });
  }
  return out;
}
function keyFor(label: string): string {
  const l = label.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  if (/(25 ?oh|25-hidroxivitamina|vitamina d)/.test(l)) return "vitamin_d_25oh";
  if (/hba1c|hemoglobina glicad/.test(l)) return "hba1c";
  if (/\bldl\b/.test(l)) return "ldl";
  if (/\bhdl\b/.test(l)) return "hdl";
  if (/triglicer[íi]deos|triglycer/.test(l)) return "triglycerides";
  if (/colesterol total|cholesterol total/.test(l)) return "chol_total";
  if (/glicose|glucose|jejum/.test(l)) return "glucose";
  if (/\btsh\b/.test(l)) return "tsh";
  if (/ferritina/.test(l)) return "ferritin";
  if (/vitamina b12|b-?12/.test(l)) return "b12";
  return l;
}

function defaultSuggestions(): SuggestedPlan {
  return {
    supplements: [
      "Vitamina D3 2000 UI — 1 cápsula/dia após o almoço",
      "Magnésio quelato 300 mg — 1 cápsula à noite",
      "Ômega-3 TG 1000 mg — 2 cápsulas/dia com refeições",
      "Probiótico multicepas — 1 cápsula/dia em jejum",
    ],
    fitoterapia: [],
    dieta: [
      "Padrão anti-inflamatório; mais vegetais/frutas/proteínas leves",
      "Reduzir alto IG; evitar ultraprocessados e frituras",
      "Incluir cúrcuma, gengibre e chá verde diariamente",
    ],
    exercicios: [
      "Aeróbico: 150 min/semana",
      "Resistido: 2–3×/semana",
    ],
    estiloVida: [
      "Mindfulness 10–15 min/dia",
      "Higiene do sono; reduzir telas à noite",
      "Hidratação ~2 L/dia",
    ],
  };
}

export function suggestFromExam(rawText?: string): SuggestedPlan {
  if (!rawText || !rawText.trim()) return defaultSuggestions();

  const text = normalize(rawText);
  const parsed = extractPairs(linesNoNoise(text)).map((t) => ({
    ...t,
    label: keyFor(t.label),
  }));

  const pick = (k: string) => parsed.find((p) => p.label === k);

  const out: SuggestedPlan = {
    supplements: [],
    fitoterapia: [],
    dieta: [],
    exercicios: [],
    estiloVida: [],
  };

  // Vitamina D
  const vitD = pick("vitamin_d_25oh");
  if (vitD?.value != null) {
    if (vitD.value < 20) out.supplements.push("Vitamina D3 4000 UI — 1 cápsula/dia após o almoço");
    else if (vitD.value < 30) out.supplements.push("Vitamina D3 2000 UI — 1 cápsula/dia após o almoço");
    out.supplements.push("Magnésio quelato 300 mg — 1 cápsula à noite");
  }

  // Perfil lipídico
  const ldl = pick("ldl");
  const tg = pick("triglycerides");
  if ((ldl?.value ?? 0) >= 130 || (tg?.value ?? 0) >= 150) {
    out.supplements.push("Ômega-3 (EPA/DHA) 1000 mg — 2 cápsulas/dia com refeições");
    out.dieta.push("Mais fibras; reduzir ultraprocessados e frituras; priorizar azeite/peixes gordos");
    out.exercicios.push("Aeróbico 150–300 min/sem + resistido 2–3×/sem");
  }

  // Glicemia / HbA1c
  const a1c = pick("hba1c");
  const glu = pick("glucose");
  if ((a1c?.value ?? 0) >= 5.7 || (glu?.value ?? 0) >= 100) {
    out.dieta.push("Baixo índice glicêmico; reduzir farinhas brancas e açúcar");
    out.supplements.push("Probiótico multicepas — 1 cápsula/dia em jejum");
    out.exercicios.push("Caminhada 10–20 min após refeições");
  }

  // Ferritina
  const fer = pick("ferritin");
  if (fer?.value != null && fer.value < 30) {
    out.supplements.push("Vitamina C 500 mg — 1 cápsula/dia (auxilia absorção de ferro)");
    out.dieta.push("Mais fontes de ferro + vitamina C nas refeições");
  }

  // B12
  const b12 = pick("b12");
  if (b12?.value != null && b12.value < 300) {
    out.supplements.push("Vitamina B12 (metilcobalamina) — ajuste conforme protocolo clínico");
  }

  // TSH
  const tsh = pick("tsh");
  if (tsh?.value != null && tsh.value > 4.5) {
    out.estiloVida.push("Sono/estresse: mindfulness 10–15 min/dia; higiene do sono");
    out.dieta.push("Avaliar ingestão proteica adequada e iodo (com orientação clínica)");
  }

  // Defaults de base se algo ficou vazio
  const uniq = (arr: string[]) => Array.from(new Set(arr.filter(Boolean)));
  out.supplements = uniq(out.supplements.length ? out.supplements : defaultSuggestions().supplements);
  out.fitoterapia = uniq(out.fitoterapia);
  out.dieta = uniq(out.dieta.length ? out.dieta : defaultSuggestions().dieta);
  out.exercicios = uniq(out.exercicios.length ? out.exercicios : defaultSuggestions().exercicios);
  out.estiloVida = uniq(out.estiloVida.length ? out.estiloVida : defaultSuggestions().estiloVida);

  return out;
}
