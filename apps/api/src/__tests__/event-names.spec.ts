import { EVENT_NAMES } from '../domain/events/event-names';

describe('critical event names', () => {
  it('uses the canonical trading namespace', () => {
    expect(Object.values(EVENT_NAMES).every((name) => name.startsWith('trading.'))).toBe(true);
    expect(new Set(Object.values(EVENT_NAMES)).size).toBe(Object.values(EVENT_NAMES).length);
  });
});
