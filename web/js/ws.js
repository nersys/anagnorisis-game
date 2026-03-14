/**
 * WebSocket service for Anagnorisis
 * Handles connection, message sending, and event dispatching
 */
export class GameWebSocket {
  constructor() {
    this._ws = null;
    this._handlers = {};
    this._url = '';
    this._heartbeatInterval = null;
    this._reconnectAttempts = 0;
    this.connected = false;
    this.onConnect = null;
    this.onDisconnect = null;
  }

  connect(url) {
    this._url = url;
    return new Promise((resolve, reject) => {
      try {
        this._ws = new WebSocket(url);

        this._ws.onopen = () => {
          this.connected = true;
          this._reconnectAttempts = 0;
          this._startHeartbeat();
          if (this.onConnect) this.onConnect();
          resolve();
        };

        this._ws.onclose = () => {
          this.connected = false;
          this._stopHeartbeat();
          if (this.onDisconnect) this.onDisconnect();
        };

        this._ws.onerror = (err) => {
          reject(new Error('Connection failed'));
        };

        this._ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            this._dispatch(msg);
          } catch (e) {
            console.error('Failed to parse message:', e);
          }
        };

        // Timeout if connection hangs
        const timer = setTimeout(() => reject(new Error('Connection timed out')), 8000);
        this._ws.addEventListener('open', () => clearTimeout(timer));
      } catch (e) {
        reject(e);
      }
    });
  }

  send(type, payload = {}) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return false;
    this._ws.send(JSON.stringify({ type, payload }));
    return true;
  }

  on(type, handler) {
    if (!this._handlers[type]) this._handlers[type] = [];
    this._handlers[type].push(handler);
  }

  off(type, handler) {
    if (!this._handlers[type]) return;
    this._handlers[type] = this._handlers[type].filter(h => h !== handler);
  }

  disconnect() {
    this._stopHeartbeat();
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this.connected = false;
  }

  _dispatch(msg) {
    const type = msg.type;
    // Call specific type handlers
    if (this._handlers[type]) {
      this._handlers[type].forEach(h => h(msg));
    }
    // Call wildcard handlers
    if (this._handlers['*']) {
      this._handlers['*'].forEach(h => h(msg));
    }
  }

  _startHeartbeat() {
    this._heartbeatInterval = setInterval(() => {
      this.send('HEARTBEAT', {});
    }, 25000);
  }

  _stopHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
  }
}
