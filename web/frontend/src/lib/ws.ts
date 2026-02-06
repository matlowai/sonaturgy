import type { WSMessage } from './types';

type WSHandler = (msg: WSMessage) => void;

export class WSClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Set<WSHandler> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;

  constructor(url?: string) {
    if (url) {
      this.url = url;
    } else if (typeof window !== 'undefined') {
      // WebSocket must connect directly to the backend (port 8000),
      // not through Next.js proxy which doesn't support WS upgrades.
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const hostname = window.location.hostname;
      this.url = `${protocol}//${hostname}:8000/api/ws`;
    } else {
      this.url = 'ws://localhost:8000/api/ws';
    }
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onmessage = (e) => {
        try {
          const msg: WSMessage = JSON.parse(e.data);
          this.handlers.forEach((h) => h(msg));
        } catch {
          // ignore malformed messages
        }
      };
      this.ws.onclose = () => {
        if (this.shouldReconnect) {
          this.reconnectTimer = setTimeout(() => this.connect(), 3000);
        }
      };
      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch {
      // ignore connection errors
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  subscribe(taskId: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', task_id: taskId }));
    }
  }

  onMessage(handler: WSHandler) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
