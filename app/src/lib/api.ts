import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Asset } from "expo-asset";

export const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "http://localhost:4000";

export async function uploadExame(fileUri: string) {
  const form = new FormData();
  // @ts-ignore RN FormData
  form.append("exame", { uri: fileUri, name: "exame.pdf", type: "application/pdf" });

  const r = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: form as any });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error || `Falha no upload (${r.status})`);
  return j as { ok: boolean; examId: string; textPreview: string; textLength: number };
}

export async function getExamText(examId: string) {
  const r = await fetch(`${API_BASE}/api/exam/${examId}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error || `Erro ao buscar exame (${r.status})`);
  return (j?.exam?.text as string) ?? "";
}

export async function suggestByExamId(examId: string) {
  const r = await fetch(`${API_BASE}/api/suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ examId }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.reason || j?.error || `Erro IA (${r.status})`);
  return j as { plan: any; modelUsed: string; at: number; fromCache?: boolean };
}

export async function suggestByText(extractedText: string) {
  const r = await fetch(`${API_BASE}/api/suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ extractedText }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.reason || j?.error || `Erro IA (${r.status})`);
  return j as { plan: any; modelUsed: string; at: number; fromCache?: boolean };
}

export async function loadTemplateAsset(pathInProject: any) {
  const asset = Asset.fromModule(pathInProject);
  if (!asset.localUri) await asset.downloadAsync();
  return asset.localUri!;
}

function getCacheDir(): string {
  const anyFS: any = FileSystem as any;
  return anyFS?.cacheDirectory || anyFS?.documentDirectory || "file:///tmp/";
}

async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function gerarReceituarioComTemplate(args: {
  paciente?: string;
  crm?: string;
  data?: string;
  observacoes?: string;
  plano: {
    supplements: string[];
    fitoterapia: string[];
    dieta: string[];
    exercicios: string[];
    estiloVida: string[];
  };
  templateLocalUri: string; // file://...
}) {
  const pdfTemplateBase64 = await FileSystem.readAsStringAsync(args.templateLocalUri, {
    encoding: "base64" as any,
  });

  const r = await fetch(`${API_BASE}/api/receituario/pdf-template`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pdfTemplateBase64,
      paciente: args.paciente,
      crm: args.crm,
      data: args.data,
      observacoes: args.observacoes,
      plano: args.plano,
    }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j?.error || `Erro ao gerar PDF (${r.status})`);
  }

  const blob = await r.blob();
  const base64 = await blobToBase64(blob);
  const fileUri = `${getCacheDir()}receituario_template.pdf`;
  await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: "base64" as any });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, { mimeType: "application/pdf", dialogTitle: "Receituário" });
  }
  return fileUri;
}
