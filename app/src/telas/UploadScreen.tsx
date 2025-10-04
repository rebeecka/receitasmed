// app/src/telas/UploadScreen.tsx
import React, { useState } from "react";
import { View, Text, Pressable, ActivityIndicator, Alert, Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

type TestItem = { label: string; value?: number; unit?: string; confidence?: number };

type RootStackParamList = {
  Upload: undefined;
  Edit: {
    rawExamText?: string;
    patientName?: string;
    tests?: TestItem[];
  };
};

type Props = NativeStackScreenProps<RootStackParamList, "Upload">;

const API_BASE = "https://receitamed.onrender.com";

export default function UploadScreen({ navigation }: Props) {
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function pickPdf() {
    setMsg(null);
    const res = await DocumentPicker.getDocumentAsync({
      type: "application/pdf",
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;

    const asset = res.assets?.[0];
    if (!asset) return;
    if (asset.mimeType && asset.mimeType !== "application/pdf") {
      Alert.alert("Selecione um PDF");
      return;
    }
    setFile(asset);
  }

  async function onSubmit() {
    if (!file) {
      Alert.alert("Selecione um PDF");
      return;
    }
    setLoading(true);
    setMsg(null);

    try {
      // Monta o FormData (compatível com Expo)
      const form = new FormData();
      form.append("exame", {
        // Em Expo, 'uri' é obrigatório; 'type' ajuda o servidor
        uri: file.uri,
        name: file.name ?? "exame.pdf",
        type:
          file.mimeType ??
          (Platform.OS === "ios" ? "application/pdf" : "application/pdf"),
      } as any);

      const url = `${API_BASE}/api/analisar-exame`;

      const r = await fetch(url, {
        method: "POST",
        body: form,
        // Não setar manualmente Content-Type aqui; o fetch define o boundary do multipart
      });

      const raw = await r.text();
      if (!r.ok) {
        setMsg(`HTTP ${r.status}: ${raw.slice(0, 200)}`);
        // Abre edição mesmo sem IA
        navigation.navigate("Edit", { rawExamText: "", patientName: "Paciente", tests: [] });
        return;
      }

      let json: any;
      try {
        json = JSON.parse(raw);
      } catch {
        setMsg("Resposta não é JSON: " + raw.slice(0, 200));
        navigation.navigate("Edit", { rawExamText: "", patientName: "Paciente", tests: [] });
        return;
      }

      // Extrai dados úteis para a próxima tela
      const rawText: string = (json?.rawText || "").toString();
      const patientName: string = (json?.meta?.paciente || "").trim() || "Paciente";
      const tests: TestItem[] = Array.isArray(json?.tests)
        ? json.tests.map((t: any) => ({
            label: String(t.label ?? "").trim(),
            value: t.value != null ? Number(t.value) : undefined,
            unit: t.unit ? String(t.unit) : undefined,
            confidence: t.confidence != null ? Number(t.confidence) : undefined,
          }))
        : [];

      // Logs de depuração (veja no Metro/console do app)
      console.log("[UploadScreen] rawText length:", rawText.length, "tests:", tests.length);

      // Navega para a Edit com TUDO que a IA precisa
      navigation.navigate("Edit", {
        rawExamText: rawText,   // IA usa este texto quando disponível
        patientName,            // opcional, mas bom para preencher o nome
        tests,                  // plano B para IA quando rawText estiver vazio
      });
    } catch (e: any) {
      setMsg(e?.message || String(e));
      navigation.navigate("Edit", { rawExamText: "", patientName: "Paciente", tests: [] });
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 16, gap: 12, justifyContent: "center" }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Enviar exame (PDF)</Text>

      <Pressable
        onPress={pickPdf}
        style={{ padding: 12, borderWidth: 1, borderRadius: 10, alignItems: "center" }}
      >
        <Text>{file ? `Selecionado: ${file.name}` : "Selecionar PDF"}</Text>
      </Pressable>

      <Pressable
        onPress={onSubmit}
        disabled={!file || loading}
        style={{
          padding: 12,
          borderRadius: 10,
          alignItems: "center",
          backgroundColor: loading ? "#888" : "black",
        }}
      >
        {loading ? <ActivityIndicator /> : <Text style={{ color: "white", fontWeight: "600" }}>Analisar</Text>}
      </Pressable>

      {msg && (
        <View style={{ marginTop: 10 }}>
          <Text style={{ color: "crimson" }}>{msg}</Text>
        </View>
      )}
    </View>
  );
}
