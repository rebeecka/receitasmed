import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, ScrollView } from "react-native";
import { suggestByExamId, suggestByText, gerarReceituarioComTemplate, loadTemplateAsset } from "../lib/api";

type Plan = {
  supplements: string[];
  fitoterapia: string[];
  dieta: string[];
  exercicios: string[];
  estiloVida: string[];
};

export default function EditScreen({ route }: any) {
  const [name, setName] = useState<string>("");
  const [crm, setCrm] = useState<string>("");
  const [data, setData] = useState<string>("");
  const [observacoes, setObservacoes] = useState<string>("");

  const [plan, setPlan] = useState<Plan>({
    supplements: [],
    fitoterapia: [],
    dieta: [],
    exercicios: [],
    estiloVida: [],
  });

  const [loadingIA, setLoadingIA] = useState(false);
  const [loadingPDF, setLoadingPDF] = useState(false);

  const examId = route?.params?.examId as string | undefined;
  const initialText = route?.params?.extractedText as string | undefined;

  async function gerarPlano() {
    try {
      setLoadingIA(true);
      const r = examId ? await suggestByExamId(examId) : await suggestByText(initialText || "");
      setPlan(r.plan);
    } catch (e: any) {
      Alert.alert("Erro", e?.message || "Falha ao gerar plano.");
    } finally {
      setLoadingIA(false);
    }
  }

  async function gerarPDF() {
    try {
      setLoadingPDF(true);
      const localUri = await loadTemplateAsset(require("../assets/receituario.pdf"));
      await gerarReceituarioComTemplate({
        paciente: name,
        crm,
        data,
        observacoes,
        plano: plan,
        templateLocalUri: localUri,
      });
    } catch (e: any) {
      Alert.alert("Erro", e?.message || "Falha ao gerar PDF com template.");
    } finally {
      setLoadingPDF(false);
    }
  }

  function renderListEditor(title: string, key: keyof Plan) {
    const arr = plan[key] || [];
    const set = (newArr: string[]) => setPlan((p) => ({ ...p, [key]: newArr }));
    return (
      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontWeight: "bold", fontSize: 16, marginBottom: 6 }}>{title}</Text>
        {arr.map((item, idx) => (
          <TextInput
            key={`${key}-${idx}`}
            value={item}
            onChangeText={(t) => {
              const clone = [...arr];
              clone[idx] = t;
              set(clone);
            }}
            placeholder="• recomendação"
            style={{
              borderWidth: 1,
              borderColor: "#ccc",
              borderRadius: 8,
              padding: 10,
              marginBottom: 8,
              backgroundColor: "#fff",
            }}
          />
        ))}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity
            onPress={() => set([...arr, ""])}
            style={{ backgroundColor: "#111", padding: 10, borderRadius: 8, marginRight: 8 }}
          >
            <Text style={{ color: "#fff" }}>+ adicionar</Text>
          </TouchableOpacity>
          {arr.length > 0 && (
            <TouchableOpacity
              onPress={() => set(arr.slice(0, -1))}
              style={{ backgroundColor: "#c00", padding: 10, borderRadius: 8 }}
            >
              <Text style={{ color: "#fff" }}>remover último</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: "bold" }}>Dados do paciente</Text>

      <TextInput placeholder="Nome do paciente" value={name} onChangeText={setName}
        style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, backgroundColor: "#fff" }} />
      <TextInput placeholder="CRM" value={crm} onChangeText={setCrm}
        style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, backgroundColor: "#fff" }} />
      <TextInput placeholder="Data (dd/mm/aaaa)" value={data} onChangeText={setData}
        style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, backgroundColor: "#fff" }} />
      <TextInput placeholder="Observações" value={observacoes} onChangeText={setObservacoes} multiline
        style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, minHeight: 80, backgroundColor: "#fff" }} />

      <View style={{ flexDirection: "row", gap: 8, marginVertical: 8 }}>
        <TouchableOpacity onPress={gerarPlano} disabled={loadingIA}
          style={{ backgroundColor: "#111", padding: 12, borderRadius: 10, alignItems: "center", flex: 1 }}>
          {loadingIA ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff" }}>Gerar plano da IA</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={gerarPDF} disabled={loadingPDF}
          style={{ backgroundColor: "#0a7", padding: 12, borderRadius: 10, alignItems: "center", flex: 1 }}>
          {loadingPDF ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff" }}>Gerar PDF no template</Text>}
        </TouchableOpacity>
      </View>

      <Text style={{ fontSize: 18, fontWeight: "bold", marginTop: 8 }}>Plano (editável por categoria)</Text>
      {renderListEditor("Suplementos", "supplements")}
      {renderListEditor("Fitoterapia", "fitoterapia")}
      {renderListEditor("Dieta", "dieta")}
      {renderListEditor("Exercícios", "exercicios")}
      {renderListEditor("Estilo de vida", "estiloVida")}
    </ScrollView>
  );
}
