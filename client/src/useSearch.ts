import { useEffect, useState } from "react";
import { ApiError, api } from "./api";
import type { Track } from "./types";

export function useSearch(endpoint: string, query: string) {
  const [items, setItems] = useState<Track[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setItems([]);
      setNextOffset(null);
      setError(null);
      setErrorStatus(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      setErrorStatus(null);
      try {
        const result = await api<{ items: Track[]; nextOffset: number | null }>(`${endpoint}?q=${encodeURIComponent(normalized)}&offset=0`, { signal: controller.signal });
        setItems(result.items);
        setNextOffset(result.nextOffset);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "Suche fehlgeschlagen.");
          setErrorStatus(caught instanceof ApiError ? caught.status : null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [endpoint, query]);

  async function more() {
    if (nextOffset === null || loading) return;
    setLoading(true);
    try {
      const result = await api<{ items: Track[]; nextOffset: number | null }>(`${endpoint}?q=${encodeURIComponent(query.trim())}&offset=${nextOffset}`);
      setItems((current) => [...current, ...result.items.filter((item) => !current.some((old) => old.id === item.id))]);
      setNextOffset(result.nextOffset);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Weitere Ergebnisse konnten nicht geladen werden.");
      setErrorStatus(caught instanceof ApiError ? caught.status : null);
    } finally {
      setLoading(false);
    }
  }

  return { items, nextOffset, loading, error, errorStatus, more };
}
