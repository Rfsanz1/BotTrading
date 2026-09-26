import { DataQualityService } from '../services/data-quality.service';

describe('DataQualityService', () => {
  const service = new DataQualityService();

  it('distinguishes fresh, stale, and missing data', () => {
    expect(service.evaluate({ now: 10_000, observedAt: 9_900, maxAgeMs: 500 }).state).toBe('HEALTHY');
    expect(service.evaluate({ now: 10_000, observedAt: 9_000, maxAgeMs: 500 }).state).toBe('DEGRADED');
    expect(service.evaluate({ now: 10_000, maxAgeMs: 500 }).state).toBe('INVALID');
  });

  it('invalidates sequence and clock failures', () => {
    const result = service.evaluate({
      now: 10_000,
      observedAt: 9_900,
      maxAgeMs: 500,
      sequenceHealthy: false,
      clockSkewMs: 2_000,
      maxClockSkewMs: 500,
    });
    expect(result.state).toBe('INVALID');
    expect(result.reasons).toEqual(expect.arrayContaining(['SEQUENCE_INVALID', 'CLOCK_SKEW']));
  });
});
