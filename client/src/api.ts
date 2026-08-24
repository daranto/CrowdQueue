import { detectLanguage, translateServerMessage } from "./locales";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter: number | null = null,
    readonly reason: string | null = null,
    readonly until: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const language = detectLanguage();
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      "Accept-Language": language,
      ...init?.headers,
    },
  });
  const payload = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    throw new ApiError(
      translateServerMessage(language, payload?.error ?? `Anfrage fehlgeschlagen (${response.status}).`),
      response.status,
      typeof payload?.retryAfter === "number" ? payload.retryAfter : null,
      typeof payload?.reason === "string" ? payload.reason : null,
      typeof payload?.until === "string" ? payload.until : null,
    );
  }
  return payload as T;
}

export function formatTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
