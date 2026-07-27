export interface TimeframeRegistryEntry {
  id: string;
  code: string;
  seconds: number;
  description: string;
  enabled: boolean;
}

export interface TimeframeRegistry {
  list(): Promise<TimeframeRegistryEntry[]>;
  get(code: string): Promise<TimeframeRegistryEntry | null>;
}
