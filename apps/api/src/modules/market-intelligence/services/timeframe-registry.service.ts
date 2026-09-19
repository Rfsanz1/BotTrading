import { Injectable } from '@nestjs/common';
import { TimeframeRegistry, TimeframeRegistryEntry } from '../interfaces/timeframe-registry.interface';

@Injectable()
export class TimeframeRegistryService implements TimeframeRegistry {
  private readonly entries: TimeframeRegistryEntry[] = [
    { id: '1m', code: '1m', seconds: 60, description: 'One minute', enabled: true },
    { id: '3m', code: '3m', seconds: 180, description: 'Three minutes', enabled: true },
    { id: '5m', code: '5m', seconds: 300, description: 'Five minutes', enabled: true },
    { id: '15m', code: '15m', seconds: 900, description: 'Fifteen minutes', enabled: true },
    { id: '30m', code: '30m', seconds: 1800, description: 'Thirty minutes', enabled: true },
    { id: '1H', code: '1H', seconds: 3600, description: 'One hour', enabled: true },
    { id: '4H', code: '4H', seconds: 14400, description: 'Four hours', enabled: true },
    { id: '1D', code: '1D', seconds: 86400, description: 'One day', enabled: true },
    { id: '1W', code: '1W', seconds: 604800, description: 'One week', enabled: true },
  ];

  async list(): Promise<TimeframeRegistryEntry[]> {
    return this.entries;
  }

  async get(code: string): Promise<TimeframeRegistryEntry | null> {
    return this.entries.find((entry) => entry.code === code) || null;
  }
}
