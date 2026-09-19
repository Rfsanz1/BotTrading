import { withRetry, withTimeout, parseSSELine, extractJsonBlock, clamp, truncate } from '../utils';

// ─── withRetry ────────────────────────────────────────────────────────────────

describe('withRetry()', () => {
  it('resolves immediately on success', async () => {
    const fn = jest.fn().mockResolvedValue(42);
    const result = await withRetry(fn, { retries: 2, delayMs: 0 });
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, { retries: 2, delayMs: 0 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'));
    await expect(withRetry(fn, { retries: 2, delayMs: 0 })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('calls onRetry callback', async () => {
    const onRetry = jest.fn();
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('e'))
      .mockResolvedValue('done');
    await withRetry(fn, { retries: 1, delayMs: 0, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });

  it('aborts early when shouldAbort returns true', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fatal'));
    await expect(
      withRetry(fn, { retries: 3, delayMs: 0, shouldAbort: () => true }),
    ).rejects.toThrow('fatal');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ─── withTimeout ─────────────────────────────────────────────────────────────

describe('withTimeout()', () => {
  it('resolves before timeout', async () => {
    const result = await withTimeout(() => Promise.resolve('fast'), 500);
    expect(result).toBe('fast');
  });

  it('rejects when operation exceeds timeout', async () => {
    const slow = () => new Promise<never>((_, reject) => setTimeout(() => reject(new Error('never')), 200));
    await expect(withTimeout(slow, 50)).rejects.toThrow(/timed out/i);
  });
});

// ─── parseSSELine ─────────────────────────────────────────────────────────────

describe('parseSSELine()', () => {
  it('parses a valid data line', () => {
    const chunk = parseSSELine<{ id: string }>('data: {"id":"abc"}');
    expect(chunk).toEqual({ id: 'abc' });
  });

  it('returns null for [DONE]', () => {
    expect(parseSSELine('data: [DONE]')).toBeNull();
  });

  it('returns null for empty line', () => {
    expect(parseSSELine('')).toBeNull();
  });

  it('returns null for non-data lines', () => {
    expect(parseSSELine('event: ping')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseSSELine('data: {broken json')).toBeNull();
  });
});

// ─── extractJsonBlock ─────────────────────────────────────────────────────────

describe('extractJsonBlock()', () => {
  it('extracts JSON from markdown fence', () => {
    const raw = '```json\n{"key":"val"}\n```';
    expect(extractJsonBlock(raw)).toBe('{"key":"val"}');
  });

  it('extracts raw JSON when no fence', () => {
    const raw = 'Here is the result: {"score":90}';
    expect(extractJsonBlock(raw)).toBe('{"score":90}');
  });
});

// ─── clamp ───────────────────────────────────────────────────────────────────

describe('clamp()', () => {
  it('clamps below min', () => expect(clamp(-5, 0, 100)).toBe(0));
  it('clamps above max', () => expect(clamp(150, 0, 100)).toBe(100));
  it('passes through value within range', () => expect(clamp(50, 0, 100)).toBe(50));
});

// ─── truncate ─────────────────────────────────────────────────────────────────

describe('truncate()', () => {
  it('returns string unchanged if within limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });
  it('truncates and appends ellipsis', () => {
    expect(truncate('hello world', 8)).toBe('hello w…');
  });
});
