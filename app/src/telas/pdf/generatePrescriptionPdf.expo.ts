// app/src/telas/pdf/generatePrescriptionPdf.expo.ts
import * as FSNew from "expo-file-system";            // API nova (se existir)
import * as FSLegacy from "expo-file-system/legacy";  // Fallback API clássica
import { Asset } from "expo-asset";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type TemplateBox = {
  marginLeft?: number;
  marginRight?: number;
  bottomMargin?: number;
  topFirst?: number;      // início da área branca na 1ª página (medido a partir do topo do papel)
  topOthers?: number;     // idem nas demais páginas
  fontSize?: number;
  lineGap?: number;
};

/** Salva Base64 como PDF usando API nova (se existir) ou legacy (fallback). */
async function saveBase64Pdf(base64: string, fileName: string) {
  const Dir: any = (FSNew as any).Directory;
  if (Dir && typeof Dir.documents === "function") {
    const dir = await Dir.documents();
    const file = dir.file(fileName);
    await file.write(base64, { encoding: "base64" });
    return file.uri as string;
  }
  const dir =
    (FSLegacy.documentDirectory as string | null) ??
    (FSLegacy.cacheDirectory as string | null) ??
    "";
  const fileUri = `${dir}${fileName}`;
  await FSLegacy.writeAsStringAsync(fileUri, base64, {
    encoding: FSLegacy.EncodingType.Base64,
  });
  return fileUri;
}

/**
 * Gera PDF escrevendo APENAS na "parte branca" do seu modelo (PDF de template).
 * Usa a 1ª página do PDF de template como fundo em TODAS as páginas do resultado.
 */
export async function generatePrescriptionFromTemplateExpo(opts: {
  text: string;                 // texto final (ex.: buildPrescription(...))
  templateModule: number;       // require(".../SeuModelo.pdf")
  fileName?: string;
  box?: TemplateBox;            // margens/posições da área branca
}) {
  const {
    text,
    templateModule,
    fileName = "Receituario.pdf",
    box = {},
  } = opts;

  // 1) Carrega PDF de template dos assets
  const asset = Asset.fromModule(templateModule);
  await asset.downloadAsync(); // garante localUri
  if (!asset.localUri) throw new Error("Falha ao carregar o PDF de template.");

  const res = await fetch(asset.localUri);
  const templateBytes = new Uint8Array(await res.arrayBuffer());
  const templatePdf = await PDFDocument.load(templateBytes);

  // 2) Cria novo doc e copia a 1ª página do template
  const pdfDoc = await PDFDocument.create();
  const [tplPage] = await pdfDoc.copyPages(templatePdf, [0]);

  const pageWidth = tplPage.getWidth();
  const pageHeight = tplPage.getHeight();

  // 3) Área branca configurável (ajuste fino aqui)
  const marginLeft   = box.marginLeft  ?? 200;
  const marginRight  = box.marginRight ?? 48;
  const bottomMargin = box.bottomMargin ?? 200;
  const topFirst     = box.topFirst   ?? 200;  // 1ª página
  const topOthers    = box.topOthers  ?? 200;  // demais páginas
  const fontSize     = box.fontSize   ?? 11;
  const lineGap      = box.lineGap    ?? 4;

  const helv  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helvB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const writableWidth = pageWidth - marginLeft - marginRight;

  // quebra de linha respeitando a largura útil
  const wrap = (p: string, font = helv, size = fontSize) => {
    const words = p.replace(/\r/g, "").split(/\s+/);
    const out: string[] = [];
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      const ww = font.widthOfTextAtSize(test, size);
      if (ww > writableWidth && line) {
        out.push(line);
        line = w;
      } else line = test;
    }
    if (line) out.push(line);
    if (!out.length) out.push("");
    return out;
  };

  // 4) Render: duplica o template quando acaba o espaço e continua na área branca
  const paragraphs = text.replace(/\r/g, "").split("\n");

  let page = pdfDoc.addPage(tplPage);
  let y = pageHeight - topFirst; // começa logo abaixo do cabeçalho da sua 1ª página

  for (const p of paragraphs) {
    const isHeader = /:$/.test(p.trim()) && p.length < 50;
    const font = isHeader ? helvB : helv;
    const size = isHeader ? fontSize + 1 : fontSize;
    const lines = wrap(p, font, size);
    const lineHeight = size + lineGap;

    for (const ln of lines) {
      if (y - lineHeight < bottomMargin) {
        const [copy] = await pdfDoc.copyPages(templatePdf, [0]);
        page = pdfDoc.addPage(copy);
        y = pageHeight - topOthers;
      }
      page.drawText(ln, { x: marginLeft, y, size, font, color: rgb(0,0,0) });
      y -= lineHeight;
    }
    if (!isHeader) y -= 2;
  }

  // 5) Salvar (sem Buffer) e gravar em arquivo (compat SDK antigo/novo)
  const base64 = await pdfDoc.saveAsBase64({ dataUri: false });
  return await saveBase64Pdf(base64, fileName);
}
