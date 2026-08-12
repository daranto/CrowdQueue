import type { ServerResponse } from "node:http";

export class PartyEvents {
  private readonly listeners = new Map<number, Set<ServerResponse>>();

  subscribe(partyId: number, response: ServerResponse): () => void {
    const set = this.listeners.get(partyId) ?? new Set<ServerResponse>();
    set.add(response);
    this.listeners.set(partyId, set);
    response.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    return () => {
      set.delete(response);
      if (set.size === 0) this.listeners.delete(partyId);
    };
  }

  publish(partyId: number, event = "state"): void {
    for (const response of this.listeners.get(partyId) ?? []) {
      response.write(`event: ${event}\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    }
  }

  heartbeat(): void {
    for (const listeners of this.listeners.values()) {
      for (const response of listeners) response.write(": keepalive\n\n");
    }
  }
}
