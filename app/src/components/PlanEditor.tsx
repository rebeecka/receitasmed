// app/src/components/PlanEditor.tsx
import React from "react";
import { View, Text, TextInput, TouchableOpacity } from "react-native";

export type Plan = {
  supplements: string[];
  fitoterapia: string[];
  dieta: string[];
  exercicios: string[];
  estiloVida: string[];
};

type SectionKey = keyof Plan;

const SECTION_LABELS: Record<SectionKey, string> = {
  supplements: "Suplementos",
  fitoterapia: "Fitoterapia",
  dieta: "Dieta",
  exercicios: "Exercícios",
  estiloVida: "Estilo de vida",
};

export function emptyPlan(): Plan {
  return { supplements: [], fitoterapia: [], dieta: [], exercicios: [], estiloVida: [] };
}
export function normalizePlan(p: any): Plan {
  return {
    supplements: Array.isArray(p?.supplements) ? p.supplements : [],
    fitoterapia: Array.isArray(p?.fitoterapia) ? p.fitoterapia : [],
    dieta: Array.isArray(p?.dieta) ? p.dieta : [],
    exercicios: Array.isArray(p?.exercicios) ? p.exercicios : [],
    estiloVida: Array.isArray(p?.estiloVida) ? p.estiloVida : [],
  };
}

export default function PlanEditor({
  value,
  onChange,
}: {
  value: Plan;
  onChange: (next: Plan) => void;
}) {
  function addItem(section: SectionKey) {
    onChange({ ...value, [section]: [...value[section], ""] });
  }
  function updateItem(section: SectionKey, index: number, text: string) {
    const arr = [...value[section]];
    arr[index] = text;
    onChange({ ...value, [section]: arr });
  }
  function removeItem(section: SectionKey, index: number) {
    const arr = [...value[section]];
    arr.splice(index, 1);
    onChange({ ...value, [section]: arr });
  }

  return (
    <View style={{ gap: 16 }}>
      {(Object.keys(SECTION_LABELS) as SectionKey[]).map((key) => (
        <View key={key} style={{ borderWidth: 1, borderRadius: 10, padding: 12 }}>
          <Text style={{ fontWeight: "700", marginBottom: 10 }}>{SECTION_LABELS[key]}</Text>

          {value[key].length === 0 && <Text style={{ color: "#666", marginBottom: 8 }}>Nenhum item. + Adicionar</Text>}

          {value[key].map((item, idx) => (
            <View key={idx} style={{ flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <Text style={{ marginRight: 6 }}>{idx + 1}.</Text>
              <TextInput
                value={item}
                onChangeText={(t) => updateItem(key, idx, t)}
                placeholder="Escreva a recomendação"
                style={{ flex: 1, borderWidth: 1, borderRadius: 8, padding: 10 }}
              />
              <TouchableOpacity onPress={() => removeItem(key, idx)} style={{ borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 }}>
                <Text>Remover</Text>
              </TouchableOpacity>
            </View>
          ))}

          <TouchableOpacity onPress={() => addItem(key)} style={{ alignSelf: "flex-start", borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 }}>
            <Text>+ Adicionar</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}
