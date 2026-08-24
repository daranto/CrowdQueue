import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { translate } from "./locales";
import { cardGrid, type QrExportOptions } from "./qrExportOptions";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const VIOLET = [104, 72, 238] as const;
const ORANGE = [255, 111, 75] as const;
const BLACK = [23, 21, 47] as const;
const MUTED = [105, 98, 122] as const;

type PdfColor = readonly [number, number, number];

function setFillColor(doc: jsPDF, color: PdfColor): void {
  doc.setFillColor(color[0], color[1], color[2]);
}

function setDrawColor(doc: jsPDF, color: PdfColor): void {
  doc.setDrawColor(color[0], color[1], color[2]);
}

function setTextColor(doc: jsPDF, color: PdfColor): void {
  doc.setTextColor(color[0], color[1], color[2]);
}

function pdfText(value: string): string {
  return value
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "");
}

function ellipsize(doc: jsPDF, value: string, maxWidth: number): string {
  const text = pdfText(value).trim();
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && doc.getTextWidth(`${shortened}...`) > maxWidth) shortened = shortened.slice(0, -1);
  return `${shortened.trimEnd()}...`;
}

async function makeQrDataUrl(guestUrl: string, width: number): Promise<string> {
  return QRCode.toDataURL(guestUrl, {
    width,
    margin: 4,
    errorCorrectionLevel: "H",
    color: { dark: "#000000", light: "#ffffff" },
  });
}

function dataUrlBlob(dataUrl: string): Blob {
  const [metadata, payload] = dataUrl.split(",", 2);
  const mime = metadata.match(/^data:([^;]+)/)?.[1] ?? "application/octet-stream";
  const bytes = Uint8Array.from(atob(payload), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

function drawBrand(doc: jsPDF, x: number, y: number, scale: number, accent: PdfColor = VIOLET): void {
  const darkAccent = accent[0] < 80 && accent[1] < 80 && accent[2] < 80;
  setFillColor(doc, accent);
  doc.circle(x + 3.2 * scale, y + 3.2 * scale, 3.2 * scale, "F");
  setDrawColor(doc, darkAccent ? [255, 255, 255] : BLACK);
  doc.setLineWidth(0.55 * scale);
  doc.line(x + 1.45 * scale, y + 2.45 * scale, x + 4.95 * scale, y + 2.15 * scale);
  doc.line(x + 1.75 * scale, y + 3.35 * scale, x + 4.55 * scale, y + 3.12 * scale);
  doc.line(x + 2.05 * scale, y + 4.2 * scale, x + 4.05 * scale, y + 4.05 * scale);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9 * scale);
  setTextColor(doc, accent);
  doc.text("CrowdQueue", x + 8.3 * scale, y + 5.15 * scale);
}

function partyTitleLines(doc: jsPDF, partyName: string, maxWidth: number, maxLines: number, initialSize: number, minimumSize: number): string[] {
  const name = pdfText(partyName).trim() || "Party";
  for (let size = initialSize; size >= minimumSize; size -= 1) {
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(name, maxWidth) as string[];
    if (lines.length <= maxLines) return lines;
  }
  doc.setFontSize(minimumSize);
  const lines = doc.splitTextToSize(name, maxWidth) as string[];
  return lines.slice(0, maxLines).map((line, index) => index === maxLines - 1 ? ellipsize(doc, line, maxWidth) : line);
}

function drawPoster(doc: jsPDF, options: QrExportOptions, qrDataUrl: string): void {
  const color = options.tone === "color";
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, "F");

  if (color) {
    setFillColor(doc, VIOLET);
    doc.rect(0, 0, PAGE_WIDTH, 5, "F");
    setFillColor(doc, ORANGE);
    doc.rect(PAGE_WIDTH - 42, 0, 42, 5, "F");
  } else {
    setDrawColor(doc, BLACK);
    doc.setLineWidth(0.8);
    doc.rect(10, 10, PAGE_WIDTH - 20, PAGE_HEIGHT - 20);
  }

  drawBrand(doc, 16, 17, 1.25, color ? VIOLET : BLACK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  setTextColor(doc, color ? VIOLET : BLACK);
  doc.text(pdfText(translate(options.language, "DEINE PARTY. DEINE MUSIK.")), 16, 42);

  setTextColor(doc, BLACK);
  doc.setFont("helvetica", "bold");
  const titleLines = partyTitleLines(doc, options.partyName, 174, 2, 30, 20);
  const titleY = 55;
  titleLines.forEach((line, index) => doc.text(line, 16, titleY + index * 11));

  const panelY = titleLines.length > 1 ? 84 : 75;
  const qrSize = 116;
  const qrX = (PAGE_WIDTH - qrSize) / 2;
  const qrY = panelY + 8;
  setDrawColor(doc, color ? VIOLET : BLACK);
  doc.setLineWidth(color ? 1.25 : 0.55);
  doc.roundedRect(qrX - 3.5, qrY - 3.5, qrSize + 7, qrSize + 7, 3, 3);
  doc.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize, undefined, "FAST");

  setTextColor(doc, BLACK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  doc.text("SCAN & PLAY", PAGE_WIDTH / 2, qrY + qrSize + 18, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(pdfText(translate(options.language, "Song wünschen. Mitvoten.")), PAGE_WIDTH / 2, qrY + qrSize + 27, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setTextColor(doc, MUTED);
  doc.text(pdfText(translate(options.language, "KEINE APP. KEIN LOGIN.")), PAGE_WIDTH / 2, qrY + qrSize + 36, { align: "center" });

  setTextColor(doc, color ? MUTED : BLACK);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(ellipsize(doc, options.guestUrl, 172), PAGE_WIDTH / 2, 274, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text(pdfText(translate(options.language, "Musik läuft über Spotify Connect")), PAGE_WIDTH / 2, 282, { align: "center" });
}

function drawCard(doc: jsPDF, options: QrExportOptions, qrDataUrl: string, x: number, y: number, width: number, height: number): void {
  const color = options.tone === "color";
  const compact = height < 105 || width < 105;
  const micro = height < 75 || width < 70;
  const inset = micro ? 3.2 : compact ? 4 : 6;

  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, width, height, "F");
  if (color) {
    doc.setFillColor(...VIOLET);
    doc.rect(x, y, width, micro ? 2.1 : compact ? 2.6 : 3.2, "F");
    doc.setFillColor(...ORANGE);
    doc.rect(x + width - Math.min(width * 0.22, 18), y, Math.min(width * 0.22, 18), micro ? 2.1 : compact ? 2.6 : 3.2, "F");
  }

  const brandScale = micro ? 0.47 : compact ? 0.56 : 0.75;
  drawBrand(doc, x + inset, y + (micro ? 3.3 : compact ? 4.2 : 6), brandScale, color ? VIOLET : BLACK);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(micro ? 5.8 : compact ? 6.8 : 9);
  doc.setTextColor(...BLACK);
  const partyLabelY = y + (micro ? 10.5 : compact ? 13 : 18);
  doc.text(ellipsize(doc, options.partyName, width - inset * 2), x + width / 2, partyLabelY, { align: "center" });

  const footerHeight = micro ? 11.5 : compact ? 13 : 18;
  const qrTop = partyLabelY + (micro ? 3.5 : compact ? 3.2 : 4);
  const qrSize = Math.min(
    micro ? 48 : compact ? 58 : 78,
    width - inset * 2,
    height - (qrTop - y) - footerHeight - (micro ? 1 : 2),
  );
  if (color) {
    setDrawColor(doc, VIOLET);
    doc.setLineWidth(micro ? 0.45 : 0.65);
    doc.roundedRect(x + (width - qrSize) / 2 - 1.3, qrTop - 1.3, qrSize + 2.6, qrSize + 2.6, 1.4, 1.4);
  }
  doc.addImage(qrDataUrl, "PNG", x + (width - qrSize) / 2, qrTop, qrSize, qrSize, undefined, "FAST");

  const ctaY = y + height - (micro ? 6.2 : compact ? 7.2 : 10.5);
  doc.setTextColor(...BLACK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(micro ? 6.8 : compact ? 8 : 11.5);
  doc.text("SCAN & PLAY", x + width / 2, ctaY, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(micro ? 4.2 : compact ? 5.3 : 7);
  doc.setTextColor(...MUTED);
  doc.text(pdfText(translate(options.language, "WÜNSCHEN + VOTEN")), x + width / 2, ctaY + (micro ? 3.5 : compact ? 4.2 : 5.5), { align: "center" });
}

function drawCutLines(doc: jsPDF, columns: number, rows: number, margin: number, cellWidth: number, cellHeight: number): void {
  doc.setDrawColor(120, 120, 116);
  doc.setLineWidth(0.22);
  doc.setLineDashPattern([1.7, 1.2], 0);
  doc.rect(margin, margin, cellWidth * columns, cellHeight * rows);
  for (let column = 1; column < columns; column += 1) {
    const x = margin + cellWidth * column;
    doc.line(x, margin - 3, x, PAGE_HEIGHT - margin + 3);
  }
  for (let row = 1; row < rows; row += 1) {
    const y = margin + cellHeight * row;
    doc.line(margin - 3, y, PAGE_WIDTH - margin + 3, y);
  }
  doc.setLineDashPattern([], 0);
}

function drawCards(doc: jsPDF, options: QrExportOptions, qrDataUrl: string): void {
  const { columns, rows } = cardGrid(options.cardCount);
  const margin = 10;
  const cellWidth = (PAGE_WIDTH - margin * 2) / columns;
  const cellHeight = (PAGE_HEIGHT - margin * 2) / rows;

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, "F");
  for (let index = 0; index < options.cardCount; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    drawCard(doc, options, qrDataUrl, margin + column * cellWidth, margin + row * cellHeight, cellWidth, cellHeight);
  }
  drawCutLines(doc, columns, rows, margin, cellWidth, cellHeight);
}

export async function createQrPdf(options: QrExportOptions): Promise<Blob> {
  const qrDataUrl = await makeQrDataUrl(options.guestUrl, 1600);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
  doc.setProperties({
    title: `CrowdQueue - ${pdfText(options.partyName)}`,
    subject: translate(options.language, "QR-Code für den CrowdQueue Gastzugang"),
    author: "CrowdQueue",
    creator: "CrowdQueue",
  });
  if (options.layout === "poster") drawPoster(doc, options, qrDataUrl);
  else drawCards(doc, options, qrDataUrl);
  return doc.output("blob");
}

export async function createQrPng(guestUrl: string): Promise<Blob> {
  return dataUrlBlob(await makeQrDataUrl(guestUrl, 2000));
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
