export const QR_CARD_COUNTS = [2, 4, 6, 8, 9, 12] as const;

export type QrCardCount = (typeof QR_CARD_COUNTS)[number];
export type QrPrintLayout = "poster" | "cards";
export type QrPrintTone = "color" | "mono";

export interface QrExportOptions {
  partyName: string;
  guestUrl: string;
  layout: QrPrintLayout;
  tone: QrPrintTone;
  cardCount: QrCardCount;
  language: Language;
}

export interface CardGrid {
  columns: number;
  rows: number;
}

export function cardGrid(count: QrCardCount): CardGrid {
  if (count === 2) return { columns: 1, rows: 2 };
  if (count === 9 || count === 12) return { columns: 3, rows: count / 3 };
  return { columns: 2, rows: count / 2 };
}

export function qrExportFileBase(partyName: string): string {
  const normalized = partyName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/gi, "ss")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `crowdqueue-${normalized || "party"}`;
}
import type { Language } from "./locales";
