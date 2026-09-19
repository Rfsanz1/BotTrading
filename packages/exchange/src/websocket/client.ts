import WebSocket from 'ws';
import EventEmitter from 'eventemitter3';

export class WSClient extends EventEmitter {
  protected ws?: WebSocket;
  constructor(protected url: string) { super(); }
  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.on('open', () => this.emit('open'));
    this.ws.on('message', (m) => this.emit('message', m.toString()));
    this.ws.on('close', () => this.emit('close'));
    this.ws.on('error', (e) => this.emit('error', e));
  }
  send(data: any) { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(typeof data === 'string' ? data : JSON.stringify(data)); }
  close() { if (this.ws) this.ws.close(); }
}

export default WSClient;
