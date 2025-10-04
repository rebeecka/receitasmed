export type SuggestedPlan = {
  supplements: string[];
  fitoterapia: string[];
  dieta: string[];
  exercicios: string[];
  estiloVida: string[];
};
export type SuggestResult = SuggestedPlan & { __fromFallback?: boolean };

const EMPTY: SuggestedPlan = {
  supplements: [],
  fitoterapia: [],
  dieta: [],
  exercicios: [],
  estiloVida: [],
};

// Use URL ABSOLUTA no React Native
const API_BASE = "https://receitamed.onrender.com";

function uniq(arr: string[]) {
  return Array.from(new Set((arr || []).map((s) => String(s).trim()).filter(Boolean)));
}

export async function suggestFromExam(rawExamText: string, patientName?: string): Promise<SuggestResult> {
  const url = `${API_BASE}/api/suggest`;


  try {
    if (!rawExamText?.trim()) {
      console.warn("[suggestFromExam] rawExamText vazio — não há como personalizar.");
      return {
        ...EMPTY,
        __fromFallback: true,
        exercicios: ["Aeróbico 150 min/sem + resistido 2–3×/sem"],
        estiloVida: ["Mindfulness 10–15 min/dia", "Hidratação ~2 L/dia", "Higiene do sono"],
      };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawExamText,
        patientName: patientName || "Paciente",
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn("[suggestFromExam] FAIL", res.status, txt);
      return {
        ...EMPTY,
        __fromFallback: true,
        exercicios: ["Aeróbico 150 min/sem + resistido 2–3×/sem"],
        estiloVida: ["Mindfulness 10–15 min/dia", "Hidratação ~2 L/dia", "Higiene do sono"],
      };
    }

    const { suggestions } = await res.json().catch(() => ({}));
    const plan: SuggestedPlan = {
      supplements: uniq(suggestions?.supplements),
      fitoterapia: uniq(suggestions?.fitoterapia),
      dieta: uniq(suggestions?.dieta),
      exercicios: uniq(suggestions?.exercicios),
      estiloVida: uniq(suggestions?.estiloVida),
    };

    const total =
      plan.supplements.length + plan.fitoterapia.length + plan.dieta.length + plan.exercicios.length + plan.estiloVida.length;
    if (total === 0) {
      console.warn("[suggestFromExam] retorno vazio da IA — verificando extração e backend");
      return { ...plan, __fromFallback: true };
    }

    return plan;
  } catch (e) {
    console.error("[suggestFromExam] erro:", e);
    return {
      ...EMPTY,
      __fromFallback: true,
      exercicios: ["Aeróbico 150 min/sem + resistido 2–3×/sem"],
      estiloVida: ["Mindfulness 10–15 min/dia", "Hidratação ~2 L/dia", "Higiene do sono"],
    };
  }
}
