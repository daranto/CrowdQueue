import { useEffect, useRef, useState } from "react";
import {
  QR_CARD_COUNTS,
  cardGrid,
  qrExportFileBase,
  type QrCardCount,
  type QrPrintLayout,
  type QrPrintTone,
} from "./qrExportOptions";
import { Notice } from "./components";

interface QrExportDialogProps {
  open: boolean;
  partyName: string;
  guestUrl: string;
  qrDataUrl: string;
  onClose: () => void;
}

export function QrExportDialog({ open, partyName, guestUrl, qrDataUrl, onClose }: QrExportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [layout, setLayout] = useState<QrPrintLayout>("poster");
  const [tone, setTone] = useState<QrPrintTone>("color");
  const [cardCount, setCardCount] = useState<QrCardCount>(6);
  const [exporting, setExporting] = useState<"pdf" | "png" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function exportPdf() {
    setExporting("pdf");
    setError(null);
    try {
      const { createQrPdf, downloadBlob } = await import("./qrExport");
      const blob = await createQrPdf({ partyName, guestUrl, layout, tone, cardCount });
      const suffix = layout === "poster" ? "a4-plakat" : `a4-${cardCount}-karten`;
      downloadBlob(blob, `${qrExportFileBase(partyName)}-${suffix}-${tone === "color" ? "farbe" : "laser"}.pdf`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Das PDF konnte nicht erstellt werden.");
    } finally {
      setExporting(null);
    }
  }

  async function exportPng() {
    setExporting("png");
    setError(null);
    try {
      const { createQrPng, downloadBlob } = await import("./qrExport");
      downloadBlob(await createQrPng(guestUrl), `${qrExportFileBase(partyName)}-qr-code.png`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Die PNG-Datei konnte nicht erstellt werden.");
    } finally {
      setExporting(null);
    }
  }

  const grid = cardGrid(cardCount);
  const previewCards = Array.from({ length: cardCount }, (_, index) => (
    <span className="qr-preview-card" key={index}>
      <small>CrowdQueue</small>
      <span className="qr-preview-code"><img src={qrDataUrl} alt="" /></span>
      <strong>Scan &amp; Play</strong>
      <em>Wünschen + voten</em>
    </span>
  ));

  return (
    <dialog
      ref={dialogRef}
      className="qr-export-dialog"
      aria-labelledby="qr-export-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClose={onClose}
    >
      <div className="qr-export-heading">
        <div><span className="section-kicker">Druckstudio</span><h2 id="qr-export-title">QR-Code exportieren</h2></div>
        <button className="dialog-close" type="button" onClick={onClose} aria-label="Exportdialog schließen">×</button>
      </div>
      <p className="qr-export-intro">Vorlage wählen. Herunterladen. Aufhängen.</p>

      <div className="qr-export-layout">
        <div className={`qr-paper-preview qr-paper-preview--${layout} qr-paper-preview--${tone}`} aria-label="Vorschau der gewählten Druckvorlage">
          {layout === "poster" ? (
            <div className="qr-preview-poster">
              <small>CrowdQueue</small>
              <strong>{partyName}</strong>
              <span><img src={qrDataUrl} alt="" /></span>
              <b>Scan &amp; Play</b>
              <em>Song wünschen. Mitvoten.</em>
            </div>
          ) : (
            <div className={`qr-preview-sheet ${cardCount >= 8 ? "qr-preview-sheet--dense" : ""} ${cardCount >= 9 ? "qr-preview-sheet--narrow" : ""} ${cardCount === 12 ? "qr-preview-sheet--very-dense" : ""}`} style={{ gridTemplateColumns: `repeat(${grid.columns}, 1fr)`, gridTemplateRows: `repeat(${grid.rows}, 1fr)` }}>
              {previewCards}
            </div>
          )}
        </div>

        <div className="qr-export-options">
          <fieldset>
            <legend>Vorlage</legend>
            <label htmlFor="qr-layout-poster" className={layout === "poster" ? "choice-card choice-card--active" : "choice-card"}>
              <input id="qr-layout-poster" type="radio" name="qr-layout" checked={layout === "poster"} onChange={() => setLayout("poster")} />
              <strong>A4-Plakat</strong><small>Groß für Eingang oder Wand</small>
            </label>
            <label htmlFor="qr-layout-cards" className={layout === "cards" ? "choice-card choice-card--active" : "choice-card"}>
              <input id="qr-layout-cards" type="radio" name="qr-layout" checked={layout === "cards"} onChange={() => setLayout("cards")} />
              <strong>Kartenbogen</strong><small>Zum Verteilen und Ausschneiden</small>
            </label>
          </fieldset>

          {layout === "cards" && (
            <label className="qr-count-select">
              <span>Anzahl pro A4-Seite</span>
              <select value={cardCount} onChange={(event) => setCardCount(Number(event.target.value) as QrCardCount)}>
                {QR_CARD_COUNTS.map((count) => <option key={count} value={count}>{count} {count === 2 ? "große Karten" : "Karten"}</option>)}
              </select>
            </label>
          )}

          <fieldset>
            <legend>Druckart</legend>
            <label htmlFor="qr-tone-color" className={tone === "color" ? "choice-card choice-card--active" : "choice-card"}>
              <input id="qr-tone-color" type="radio" name="qr-tone" checked={tone === "color"} onChange={() => setTone("color")} />
              <strong>Farbdruck</strong><small>Violett und Orange</small>
            </label>
            <label htmlFor="qr-tone-mono" className={tone === "mono" ? "choice-card choice-card--active" : "choice-card"}>
              <input id="qr-tone-mono" type="radio" name="qr-tone" checked={tone === "mono"} onChange={() => setTone("mono")} />
              <strong>Schwarzweiß / Laser</strong><small>Klarer Kontrast, wenig Toner</small>
            </label>
          </fieldset>
        </div>
      </div>

      {error && <Notice tone="error" live>{error}</Notice>}
      <p className="qr-export-privacy">Wird lokal erstellt. Dein Gast-Link bleibt im Browser.</p>
      <div className="qr-export-actions">
        <button className="secondary-button" type="button" onClick={() => void exportPng()} disabled={Boolean(exporting)}>{exporting === "png" ? "PNG wird erstellt …" : "Nur QR als PNG"}</button>
        <button className="primary-button" type="button" onClick={() => void exportPdf()} disabled={Boolean(exporting)}>{exporting === "pdf" ? "PDF wird erstellt …" : "A4-PDF herunterladen"}</button>
      </div>
    </dialog>
  );
}
