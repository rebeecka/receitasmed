// app/src/lib/prescription.ts

export type ExamData = {
  // Texto bruto do exame (opcional, só se quiser usar o resumo)
  rawText?: string;

  // Metadados
  patientName?: string;
  dateISO?: string; // ex.: "2025-10-02"

  // Blocos editáveis
  supplements?: string[];
  fitoterapia?: string[];
  dieta?: string[];
  exercicios?: string[];
  estiloVida?: string[];

  // Controle do resumo do exame no receituário
  includeExamSummary?: boolean;        // default: false (recomendado)
  examSummaryMode?: "tests" | "raw";   // "tests" = só resultados estruturados; "raw" = texto limpo
};

/** Sugestões padrão para preencher a tela (fallback quando a IA não mandar nada). */
export function defaultSuggestions() {
  return {
    supplements: [
      "Vitamina D3 2000 UI — 1 cápsula/dia após o almoço",
      "Magnésio quelato 300 mg — 1 cápsula à noite",
      "Ômega-3 TG 1000 mg — 2 cápsulas/dia com refeições",
      "Probiótico multicepas — 1 cápsula/dia em jejum",
    ],
    fitoterapia: [
      "Xiao Yao San — 1 dose, 2×/dia",
      "Huang Qi (Astragalus) 500 mg — 2×/dia",
      "Bai Shao (Paeoniae) 400 mg — 2×/dia",
    ],
    dieta: [
      "Padrão anti-inflamatório; mais vegetais/frutas/proteínas leves",
      "Reduzir alto IG; evitar ultraprocessados e frituras",
      "Incluir cúrcuma, gengibre e chá verde diariamente",
    ],
    exercicios: [
      "Aeróbico: 150 min/semana (caminhada/bike/corrida leve)",
      "Resistido: 2–3×/semana (musculação/funcional)",
      "Alongamento diário: 10 minutos",
    ],
    estiloVida: [
      "Mindfulness 10–15 min/dia",
      "Higiene do sono (rotina, menos telas à noite)",
      "Hidratação ~2 L/dia",
    ],
  };
}

/* ============================ PARSER DO EXAME (opcional) ============================ */

type ParsedTest = { label: string; value?: string; unit?: string };

function normalizeText(s: string) {
  return (s || "")
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripNoiseLines(text: string) {
  const BAD_LINE = new RegExp(
    [
      "observa[cç][oõ]es?\\s*do\\s*exame",
      "data\\s*de\\s*(coleta|recebimento|gera[cç][aã]o)",
      "assinado\\s+eletronicamente",
      "laborat[oó]rio",
      "\\b(?:crm|crf)[-:/ ]?\\w+",
      "\\(m[eé]todo",
      "\\bmetodologia\\b",
      "\\bmaterial:\\b",
      "\\brefer[êe]ncia\\b|\\bintervalo\\s*de\\s*refer[êe]ncia\\b|\\bvalores?\\s*de\\s*refer[êe]ncia\\b|\\bvr\\b",
      "\\bnormal\\b\\s*:\\s*\\d",
      "\\brisco\\b|\\bdiabetes\\b(?:\\s*mellitus)?",
      "\\bassinatura\\b",
      "\\bresultado\\s*:\\b\\s*$",
      "\\b20\\d{2}\\b.*(?:supplement|doi|ed\\.|vol\\.|pages?)",
      "wintrobe",
      "greer,",
      "https?://",
    ].join("|"),
    "i"
  );

  return text
    .split("\n")
    .filter((ln) => {
      const t = ln.trim();
      if (!t) return false;
      if (BAD_LINE.test(t)) return false;
      if (t.length > 180 && !/:/.test(t)) return false;
      return true;
    })
    .join("\n");
}

/** Extrai resultados no formato "Label: 12,3 mg/dL" e ignora o resto. */
function extractLabResults(cleanText: string): ParsedTest[] {
  const lines = cleanText.split("\n");
  const rx =
    /^\s*([A-Za-zÀ-ÿ0-9 .,'()\/\-+%]+?)\s*:\s*([+-]?\d+(?:[.,]\d+)?)\s*([A-Za-zµμ%/·°²³^_-]+)?\s*$/;
  const out: ParsedTest[] = [];

  for (const raw of lines) {
    const ln = raw.trim();
    if (!ln || !/\d/.test(ln)) continue;
    const m = ln.match(rx);
    if (m) {
      let [, label, value, unit] = m;
      label = label.replace(/\s{2,}/g, " ").trim();
      if (unit) unit = unit.replace(/μ/g, "µ");
      out.push({ label, value, unit });
    }
  }

  const seen = new Set<string>();
  return out.filter((t) => {
    const k = `${t.label}::${t.value ?? ""}::${t.unit ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function formatExamSummary(
  mode: "tests" | "raw",
  cleanText: string,
  tests: ParsedTest[]
): string[] {
  if (mode === "tests") {
    if (!tests.length) return [];
    return [
      "Resumo do exame (estruturado):",
      ...tests.map(
        (t) => `• ${t.label}${t.value ? `: ${t.value}` : ""}${t.unit ? ` ${t.unit}` : ""}`
      ),
      "",
    ];
  } else {
    const t = cleanText.trim();
    return t ? ["Resumo do exame (limpo):", t, ""] : [];
  }
}

/* ============================ BUILDER DO RECEITUÁRIO ============================ */

export function buildPrescription(input: ExamData) {
  const dflt = defaultSuggestions();

  const patientName = input.patientName ?? "Paciente";
  const date = input.dateISO
    ? new Date(input.dateISO).toLocaleDateString("pt-BR")
    : new Date().toLocaleDateString("pt-BR");

  const supplements = input.supplements?.length ? input.supplements : dflt.supplements;
  const fitoterapia = input.fitoterapia?.length ? input.fitoterapia : dflt.fitoterapia;
  const dieta = input.dieta?.length ? input.dieta : dflt.dieta;
  const exercicios = input.exercicios?.length ? input.exercicios : dflt.exercicios;
  const estiloVida = input.estiloVida?.length ? input.estiloVida : dflt.estiloVida;

  // Resumo do exame — desligado por padrão (includeExamSummary = false)
  const include = input.includeExamSummary ?? false;
  const mode: "tests" | "raw" = input.examSummaryMode ?? "tests";
  let examSection: string[] = [];

  if (include && input.rawText) {
    const normalized = normalizeText(input.rawText);
    const cleaned = stripNoiseLines(normalized);
    const parsed = extractLabResults(cleaned);
    examSection = formatExamSummary(mode, cleaned, parsed);
  }

  const lines = [
    ...examSection, // só aparece se includeExamSummary = true
    `PACIENTE: ${patientName}`,
    `DATA: ${date}`,
    "",
    "Condutas:",
    "• Acupuntura geral",
    "• Acupuntura no pós-operatório de cirurgia plástica",
    "• Fitoterapia chinesa e dietética chinesa – Suplementos",
    "• Gerenciamento de estresse – Mindfulness / Biofeedback",
    "• Saúde quântica – Biorressonância e florais frequenciais",
    "• Atendimento online",
    "",
    "Suplementos:",
    ...supplements.map((s) => `• ${s}`),
    "",
    "Fitoterapia Chinesa:",
    ...fitoterapia.map((s) => `• ${s}`),
    "",
    "Dieta:",
    ...dieta.map((s) => `• ${s}`),
    "",
    "Exercícios:",
    ...exercicios.map((s) => `• ${s}`),
    "",
    "Meditação e Estilo de Vida:",
    ...estiloVida.map((s) => `• ${s}`),
    "",
   
  ];

  return lines.join("\n");
}
