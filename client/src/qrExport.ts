import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { cardGrid, type QrExportOptions } from "./qrExportOptions";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const LIME = [201, 241, 58] as const;
const BLACK = [16, 16, 15] as const;
const MUTED = [96, 98, 91] as const;

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

function drawBrand(doc: jsPDF, x: number, y: number, scale: number, accent: PdfColor = LIME): void {
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
  doc.text("Party-Playlist", x + 8.3 * scale, y + 5.15 * scale);
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
  setFillColor(doc, color ? BLACK : [255, 255, 255]);
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, "F");

  if (color) {
    setFillColor(doc, LIME);
    doc.rect(0, 0, PAGE_WIDTH, 5, "F");
    doc.circle(194, 29, 27, "F");
    setFillColor(doc, BLACK);
    doc.circle(194, 29, 18, "F");
  } else {
    setDrawColor(doc, BLACK);
    doc.setLineWidth(0.8);
    doc.rect(10, 10, PAGE_WIDTH - 20, PAGE_HEIGHT - 20);
  }

  drawBrand(doc, 16, 17, 1.25, color ? LIME : BLACK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  setTextColor(doc, color ? LIME : BLACK);
  doc.text("DEINE PARTY. DEINE MUSIK.", 16, 42);

  setTextColor(doc, color ? [255, 255, 255] : BLACK);
  doc.setFont("helvetica", "bold");
  const titleLines = partyTitleLines(doc, options.partyName, 174, 2, 30, 20);
  const titleY = 55;
  titleLines.forEach((line, index) => doc.text(line, 16, titleY + index * 11));

  const panelY = titleLines.length > 1 ? 84 : 75;
  const panelHeight = titleLines.length > 1 ? 171 : 180;
  doc.setFillColor(255, 255, 255);
  setDrawColor(doc, color ? LIME : BLACK);
  doc.setLineWidth(color ? 0 : 0.55);
  doc.roundedRect(25, panelY, 160, panelHeight, 4, 4, color ? "F" : "FD");

  const qrSize = 116;
  const qrY = panelY + 10;
  doc.addImage(qrDataUrl, "PNG", (PAGE_WIDTH - qrSize) / 2, qrY, qrSize, qrSize, undefined, "FAST");

  setTextColor(doc, BLACK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16.5);
  doc.text("Musikwünsche abgeben & Favoriten wählen", PAGE_WIDTH / 2, qrY + qrSize + 17, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.text("Songs wünschen - Queue sehen - Favoriten voten", PAGE_WIDTH / 2, qrY + qrSize + 26, { align: "center" });
  doc.setFontSize(8.5);
  setTextColor(doc, MUTED);
  doc.text("Ohne Anmeldung. Einfach Kamera öffnen und QR-Code scannen.", PAGE_WIDTH / 2, qrY + qrSize + 36, { align: "center" });

  setTextColor(doc, color ? [230, 232, 224] : BLACK);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(ellipsize(doc, options.guestUrl, 172), PAGE_WIDTH / 2, 274, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("Musik läuft über Spotify Connect", PAGE_WIDTH / 2, 282, { align: "center" });
}

function drawCard(doc: jsPDF, options: QrExportOptions, qrDataUrl: string, x: number, y: number, width: number, height: number): void {
  const color = options.tone === "color";
  const compact = options.cardCount >= 6;
  const inset = compact ? 4 : 6;

  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, width, height, "F");
  if (color) {
    doc.setFillColor(...LIME);
    doc.rect(x, y, width, compact ? 2.4 : 3.2, "F");
  }

  const brandScale = compact ? 0.56 : 0.75;
  drawBrand(doc, x + inset, y + (compact ? 4.2 : 6), brandScale, color ? LIME : BLACK);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(compact ? 6.8 : 9);
  doc.setTextColor(...BLACK);
  const partyLabelY = y + (compact ? 13 : 18);
  doc.text(ellipsize(doc, options.partyName, width - inset * 2), x + width / 2, partyLabelY, { align: "center" });

  const footerHeight = compact ? 10 : 16;
  const qrTop = partyLabelY + (compact ? 2.5 : 4);
  const qrSize = Math.min(
    compact ? 50 : 72,
    width - inset * 2,
    height - (qrTop - y) - footerHeight - 2,
  );
  doc.addImage(qrDataUrl, "PNG", x + (width - qrSize) / 2, qrTop, qrSize, qrSize, undefined, "FAST");

  const footerY = y + height - (compact ? 5 : 8);
  doc.setTextColor(...BLACK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(compact ? 5.9 : 8.8);
  if (compact) {
    doc.text(["MUSIKWÜNSCHE ABGEBEN", "& FAVORITEN WÄHLEN"], x + width / 2, footerY - 2.4, { align: "center", lineHeightFactor: 1.05 });
  } else {
    doc.text("Musikwünsche abgeben & Favoriten wählen", x + width / 2, footerY, { align: "center" });
  }
  if (!compact) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text("Keine Anmeldung nötig", x + width / 2, footerY + 5, { align: "center" });
  }
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
    subject: "QR-Code für den CrowdQueue Gastzugang",
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
