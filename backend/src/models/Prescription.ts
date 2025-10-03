// app/src/lib/prescription.ts

export type ExamData = {
  // Texto bruto opcional (colado do PDF/OCR)
  rawText?: string;

  // Metadados da prescrição
  patientName?: string;
  dateISO?: string;

  // Blocos customizáveis
  supplements?: string[];
  fitoterapia?: string[];
  dieta?: string[];
  exercicios?: string[];
  estiloVida?: string[];

  // Controle do resumo do exame no receituário
  includeExamSummary?: boolean;        // default: false
  examSummaryMode?: "tests" | "raw";   // "tests" = só resultados estruturados; "raw" = texto limpo
};

type ParsedTest = { label: string; value?: string; unit?: string };

// ========== 1) Normalização e limpeza ==========
function normalizeText(s: string) {
  return s
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ")                // nbsp
    .replace(/[ \t]+/g, " ")                // espaços repetidos
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripNoiseLines(text: string) {
  // Elimina linhas inequivocamente “ruins”
  const BAD_LINE = new RegExp(
    [
      // cabeçalhos, métodos, assinaturas, refs
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
      // bibliografia, doi, ano; páginas
      "\\b20\\d{2}\\b.*(?:supplement|doi|ed\\.|vol\\.|pages?)",
      "wintrobe",
      "greer,",
      // URLs
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
      // Linha muito longa e “textão” — provavelmente não é resultado
      if (t.length > 180 && !/:/.test(t)) return false;
      return true;
    })
    .join("\n");
}

// ========== 2) Extração estruturada de testes ==========
/**
 * Extrai linhas no formato:
 *   "Glicose: 102 mg/dL"
 *   "Hemoglobina Glicada (HbA1c): 6,2 %"
 *   "TSH: 2.1 mUI/L"
 * Ignora faixas de referência, métodos, bibliografia, etc.
 */
function extractLabResults(cleanText: string): ParsedTest[] {
  const lines = cleanText.split("\n");
  const results: ParsedTest[] = [];

  // label : value (unit)
  // - label: letras, acentos, números, espaços e pontuação leve
  // - value: número com vírgula ou ponto (opcional sinal)
  // - unit: letras + símbolos % / µ L dL mL ng mg g UI U etc.
  const rx =
    /^\s*([A-Za-zÀ-ÿ0-9 .,'()\/\-+%]+?)\s*:\s*([+-]?\d+(?:[.,]\d+)?)\s*([A-Za-zµμ%/·°²³^_-]+)?\s*$/;

  for (const raw of lines) {
    const ln = raw.trim();
    if (!ln) continue;

    // evita linhas “somente texto” com dois pontos e sem número
    if (!/\d/.test(ln)) continue;

    const m = ln.match(rx);
    if (m) {
      let [, label, value, unit] = m;
      label = label.replace(/\s{2,}/g, " ").trim();
      // normaliza unidade µ -> µ
      if (unit) unit = unit.replace(/μ/g, "µ");
      results.push({ label, value, unit });
    }
  }

  // de-duplica por label+value+unit
  const key = (t: ParsedTest) => `${t.label}::${t.value ?? ""}::${t.unit ?? ""}`;
  const seen = new Set<string>();
  return results.filter((t) => {
    const k = key(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ========== 3) Formatação do resumo do exame ==========
function formatExamSummary(
  mode: "tests" | "raw",
  cleanText: string,
  tests: ParsedTest[]
): string[] {
  if (mode === "tests") {
    if (!tests.length) return [];
    const rows = tests.map((t) =>
      `• ${t.label}${t.value ? `: ${t.value}` : ""}${t.unit ? ` ${t.unit}` : ""}`
    );
    return ["Resumo do exame (estruturado):", ...rows, ""];
  } else {
    if (!cleanText.trim()) return [];
    return ["Resumo do exame (limpo):", cleanText.trim(), ""];
  }
}

// ========== 4) Blocos padrão ==========
function defaults() {
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

// ========== 5) Builder principal com FLAGS ==========
export function buildPrescription(input: ExamData) {
  const dflt = defaults();

  const patientName = input.patientName ?? "Paciente";
  const date = input.dateISO
    ? new Date(input.dateISO).toLocaleDateString("pt-BR")
    : new Date().toLocaleDateString("pt-BR");

  const supplements = input.supplements?.length ? input.supplements : dflt.supplements;
  const fitoterapia = input.fitoterapia?.length ? input.fitoterapia : dflt.fitoterapia;
  const dieta = input.dieta?.length ? input.dieta : dflt.dieta;
  const exercicios = input.exercicios?.length ? input.exercicios : dflt.exercicios;
  const estiloVida = input.estiloVida?.length ? input.estiloVida : dflt.estiloVida;

  // ————— Resumo do exame (opcional) —————
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
    ...examSection, // aparece no topo, se habilitado
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
    "— Conteúdo de apoio gerado por IA; revisar antes de prescrever —",
  ];

  return lines.join("\n");
}
