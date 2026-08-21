import { useEffect, useRef, type PointerEvent } from "react";
import { Artwork, TrackMeta } from "./components";
import type { Track } from "./types";

interface SpotifyQueueDialogProps {
  open: boolean;
  tracks: Track[];
  onClose: () => void;
}

export function SpotifyQueueDialog({ open, tracks, onClose }: SpotifyQueueDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const closeFromBackdrop = (event: PointerEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="spotify-queue-dialog"
      aria-labelledby="spotify-queue-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClose={onClose}
      onPointerDown={closeFromBackdrop}
    >
      <div className="spotify-queue-dialog__heading">
        <div>
          <span className="section-kicker">Schreibgeschützt</span>
          <h2 id="spotify-queue-title">Spotify Warteschlange</h2>
        </div>
        <button className="dialog-close" type="button" onClick={onClose} aria-label="Spotify Warteschlange schließen">×</button>
      </div>
      <p className="spotify-queue-dialog__intro">Direkt in Spotify vorgemerkte Titel. Hier kannst du sie nur ansehen.</p>
      <div className="spotify-queue-dialog__meta">
        <span>{tracks.length} Titel</span>
        <span>Nur Anzeige</span>
      </div>
      {tracks.length > 0 ? (
        <ol className="spotify-queue-dialog__list">
          {tracks.map((track, index) => (
            <li key={`${track.id}-${index}`}>
              <span className="spotify-queue-dialog__position">{String(index + 1).padStart(2, "0")}</span>
              <Artwork track={track} size="small" />
              <TrackMeta track={track} compact />
            </li>
          ))}
        </ol>
      ) : (
        <div className="spotify-queue-dialog__empty">
          <span aria-hidden="true">♫</span>
          <strong>Noch keine weiteren Titel</strong>
          <p>Neue Spotify-Titel erscheinen automatisch hier.</p>
        </div>
      )}
    </dialog>
  );
}
