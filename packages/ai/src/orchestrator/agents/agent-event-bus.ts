import { EventEmitter } from 'eventemitter3';
import type { AgentEvents } from './agent-types';

export class AgentEventBus {
  private emitter = new EventEmitter<AgentEvents>();

  subscribe<K extends keyof AgentEvents>(event: K, listener: (payload: AgentEvents[K]) => void) {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }

  publish<K extends keyof AgentEvents>(event: K, payload: AgentEvents[K]) {
    this.emitter.emit(event, payload);
  }
}

export type AgentEventType = keyof AgentEvents;
