"use client";

import {
  connectWsUrl,
  parseConnectServerMessage,
  type ConnectClientMessage,
  type ConnectServerMessage,
} from "@/lib/connectProtocol";

const REQUEST_TIMEOUT_MS = 10_000;
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15_000];

const FATAL_CLOSE_MESSAGES: Record<number, string> = {
  4401: "Connect-Verbindung abgelehnt (4401): Sitzung abgelaufen oder nicht angemeldet.",
  4403: "Connect-Verbindung abgelehnt (4403): Konto ist nicht freigeschaltet.",
  4409: "Dieses Gerät wurde durch eine neuere Verbindung ersetzt (4409).",
};

export interface ConnectSocketCallbacks {
  buildRegister: () => Extract<ConnectClientMessage, { type: "register" }>;
  onOpen?: () => void;
  onMessage: (message: ConnectServerMessage) => void;
  onStatusChange: (status: "connecting" | "connected" | "reconnecting" | "error", error: string | null) => void;
}

interface PendingRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: number;
  targetDeviceId?: string;
}

/**
 * Resilient WebSocket client for `/api/connect/ws`.
 * - Sends `register` immediately on open.
 * - Responds to server `ping` with `pong` and sends periodic `ping` heartbeats.
 * - Tracks `request_id` responses (`command_result` / `error`) so failed remote
 *   commands and transfers always reject loudly.
 * - Stops reconnecting on fatal auth/conflict close codes (4401/4403/4409).
 */
export class ConnectSocket {
  private ws: WebSocket | null = null;
  private disposed = false;
  private attempt = 0;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private pending = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private callbacks: ConnectSocketCallbacks;

  constructor(callbacks: ConnectSocketCallbacks) {
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.disposed) return;
    this.open();
  }

  reconnectNow(): void {
    if (this.disposed) return;
    this.attempt = 0;
    this.clearTimers();
    this.closeSocket();
    this.open();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    this.rejectAllPending(new Error("Connect-Verbindung wurde geschlossen."));
    this.closeSocket();
  }

  isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  send(message: ConnectClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Connect-WebSocket ist nicht verbunden.");
    }
    this.ws.send(JSON.stringify(message));
  }

  sendWithAck(
    build: (requestId: string) => ConnectClientMessage,
    actionLabel: string,
  ): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`${actionLabel}: Connect-WebSocket ist nicht verbunden.`));
    }
    const requestId = `req-${Date.now()}-${++this.requestCounter}`;
    const payload = build(requestId);
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${actionLabel}: Zeitüberschreitung – keine Antwort vom Zielgerät.`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.send(payload);
      } catch (cause) {
        window.clearTimeout(timer);
        this.pending.delete(requestId);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
  }

  private open(): void {
    if (this.disposed) return;
    this.clearTimers();
    this.callbacks.onStatusChange(this.attempt === 0 ? "connecting" : "reconnecting", null);

    let socket: WebSocket;
    try {
      socket = new WebSocket(connectWsUrl(window.location.origin));
    } catch (cause) {
      const message = `Connect-WebSocket konnte nicht geöffnet werden: ${cause instanceof Error ? cause.message : String(cause)}`;
      this.callbacks.onStatusChange("error", message);
      return;
    }

    this.ws = socket;
    let sawWelcome = false;

    socket.onopen = () => {
      if (this.ws !== socket || this.disposed) return;
      this.callbacks.onOpen?.();
      try {
        const reg = this.callbacks.buildRegister();
        socket.send(JSON.stringify(reg));
      } catch (cause) {
        const message = `Connect-Registrierung fehlgeschlagen: ${cause instanceof Error ? cause.message : String(cause)}`;
        this.callbacks.onStatusChange("error", message);
        socket.close(1011, "register failed");
      }
    };

    socket.onmessage = (event: MessageEvent) => {
      if (this.ws !== socket || this.disposed) return;
      if (typeof event.data !== "string") {
        const message = "Connect-WS lieferte eine nicht-textuelle Nachricht.";
        this.callbacks.onStatusChange("error", message);
        socket.close(1003, "expected text frame");
        return;
      }
      let parsed: ConnectServerMessage;
      try {
        parsed = parseConnectServerMessage(event.data);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        this.callbacks.onStatusChange("error", message);
        socket.close(1007, "invalid frame");
        return;
      }

      if (parsed.type === "ping") {
        try {
          this.send({ type: "pong" });
        } catch {
          // Socket already closing; onclose will handle recovery.
        }
        return;
      }
      if (parsed.type === "pong") return;

      if (parsed.type === "welcome") {
        sawWelcome = true;
        this.attempt = 0;
        this.callbacks.onStatusChange("connected", null);
        this.startHeartbeat(parsed.heartbeat_interval_sec);
      } else if (parsed.type === "state") {
        this.resolvePendingTransfers(parsed.state.active_device_id);
      } else if (parsed.type === "command_result") {
        if (parsed.request_id) {
          const entry = this.pending.get(parsed.request_id);
          if (entry) {
            window.clearTimeout(entry.timer);
            this.pending.delete(parsed.request_id);
            if (parsed.ok) entry.resolve();
            else entry.reject(new Error(parsed.error || "Befehl auf dem Zielgerät fehlgeschlagen."));
          }
        }
      } else if (parsed.type === "error" && parsed.request_id) {
        const entry = this.pending.get(parsed.request_id);
        if (entry) {
          window.clearTimeout(entry.timer);
          this.pending.delete(parsed.request_id);
          entry.reject(new Error(`${parsed.detail} (${parsed.code})`));
        }
      }

      this.callbacks.onMessage(parsed);
    };

    socket.onclose = (event: CloseEvent) => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.clearHeartbeat();
      if (this.disposed) return;

      this.rejectAllPending(
        new Error(`Connect-Verbindung getrennt (Code ${event.code}${event.reason ? `: ${event.reason}` : ""}).`),
      );

      const fatal = FATAL_CLOSE_MESSAGES[event.code];
      if (fatal) {
        this.callbacks.onStatusChange("error", fatal);
        return;
      }

      const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)];
      this.attempt += 1;
      const reason = event.reason ? ` (${event.reason})` : "";
      const detail = sawWelcome
        ? `Connect-Verbindung unterbrochen (Code ${event.code}${reason}) – verbinde erneut…`
        : `Connect-Verbindung fehlgeschlagen (Code ${event.code}${reason}) – erneuter Versuch…`;
      this.callbacks.onStatusChange("reconnecting", detail);
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this.open();
      }, delay);
    };
  }

  private resolvePendingTransfers(activeDeviceId: string | null): void {
    if (!activeDeviceId) return;
    for (const [key, entry] of this.pending.entries()) {
      if (entry.targetDeviceId !== undefined && entry.targetDeviceId === activeDeviceId) {
        window.clearTimeout(entry.timer);
        this.pending.delete(key);
        entry.resolve();
      }
    }
  }

  sendTransfer(targetDeviceId: string, play?: boolean): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Gerätewechsel fehlgeschlagen: Connect-WebSocket ist nicht verbunden."));
    }
    const requestId = `transfer-${Date.now()}-${++this.requestCounter}`;
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Gerätewechsel: Zeitüberschreitung – Server hat nicht geantwortet."));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer, targetDeviceId });
      try {
        this.send({
          type: "transfer",
          target_device_id: targetDeviceId,
          ...(play !== undefined ? { play } : {}),
          request_id: requestId,
        });
      } catch (cause) {
        window.clearTimeout(timer);
        this.pending.delete(requestId);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
  }

  private startHeartbeat(intervalSec: number): void {
    this.clearHeartbeat();
    const ms = Math.max(5, intervalSec) * 1000;
    this.heartbeatTimer = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, ms);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeSocket(): void {
    const socket = this.ws;
    this.ws = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close(1000, "client dispose");
    }
  }

  private rejectAllPending(error: Error): void {
    for (const entry of this.pending.values()) {
      window.clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
}
