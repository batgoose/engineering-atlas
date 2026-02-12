export type GameEvent = {
  event: 'TOUCHDOWN' | 'FIELD_GOAL' | 'FUMBLE' | 'INTERCEPTION';
  team: string;
  score: string;
  message: string;
  timestamp: string;
};

export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'error';
type Listener = (event: GameEvent) => void;
type StatusListener = (status: ConnectionStatus) => void;

class GridStreamStore {
  private socket: WebSocket | null = null;
  private listeners: Set<Listener> = new Set();
  private statusListeners: Set<StatusListener> = new Set();
  private status: ConnectionStatus = 'closed';
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000;

  private setStatus(newStatus: ConnectionStatus) {
    this.status = newStatus;
    this.statusListeners.forEach((fn) => fn(newStatus));
  }

  public connect(url: string) {
    if (this.socket || typeof window === 'undefined') return;

    this.setStatus('connecting');
    this.socket = new WebSocket(url);

    this.socket.onopen = () => {
      this.setStatus('open');
      this.reconnectAttempts = 0;
      console.log('⚡ GridStream: Connected');
    };

    this.socket.onmessage = (msg) => {
      try {
        const data: GameEvent = JSON.parse(msg.data);
        this.listeners.forEach((fn) => fn(data));
      } catch (err) {
        console.error('❌ GridStream: Failed to parse message', err);
      }
    };

    this.socket.onclose = () => {
      this.socket = null;
      this.setStatus('closed');

      // Exponential backoff for reconnection
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
      this.reconnectAttempts++;

      console.log(`🔄 GridStream: Reconnecting in ${delay}ms...`);
      setTimeout(() => this.connect(url), delay);
    };

    this.socket.onerror = () => {
      this.setStatus('error');
    };
  }

  public subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  public onStatusChange(fn: StatusListener) {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  public getStatus() {
    return this.status;
  }
}

// Export a singleton instance
export const gridStream = new GridStreamStore();
