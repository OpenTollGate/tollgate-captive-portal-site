import { describe, it, expect } from 'vitest';
import { parseUsageResponse, formatRemaining } from '../../src/helpers/usage.js';

// Characterization tests for the uci/usage reply parser and the "remaining"
// formatter. Both are pure; the interesting part is the branch surface, which
// is 0% covered on the baseline.

describe('parseUsageResponse', () => {
  it('parses a used/total pair', () => {
    expect(parseUsageResponse('12/30')).toEqual({ used: 12, total: 30 });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseUsageResponse('  7/9\n')).toEqual({ used: 7, total: 9 });
  });

  it('returns null for a non-string payload', () => {
    expect(parseUsageResponse(null)).toBeNull();
    expect(parseUsageResponse(undefined)).toBeNull();
    expect(parseUsageResponse(42)).toBeNull();
    expect(parseUsageResponse({ used: 1, total: 2 })).toBeNull();
  });

  it('returns null for the module\'s "no data" sentinel', () => {
    expect(parseUsageResponse('-1/-1')).toBeNull();
  });

  it('returns null when the pair is malformed', () => {
    expect(parseUsageResponse('12')).toBeNull();
    expect(parseUsageResponse('1/2/3')).toBeNull();
    expect(parseUsageResponse('')).toBeNull();
  });

  it('returns null on non-numeric or out-of-range values', () => {
    expect(parseUsageResponse('abc/10')).toBeNull();
    expect(parseUsageResponse('5/xyz')).toBeNull();
    expect(parseUsageResponse('-5/10')).toBeNull();
    expect(parseUsageResponse('5/0')).toBeNull();
  });
});

describe('formatRemaining', () => {
  it('formats a byte allocation through the byte units', () => {
    expect(formatRemaining(0, 2048, 'bytes')).toBe('2.0 KB remaining of 2.0 KB');
    expect(formatRemaining(0, 1048576, 'MiB')).toBe('1.0 MB remaining of 1.0 MB');
    expect(formatRemaining(0, 1073741824, 'GiB')).toBe('1.0 GB remaining of 1.0 GB');
    expect(formatRemaining(0, 12, 'B')).toBe('12 B remaining of 12 B');
  });

  it('formats a time allocation through the time units', () => {
    expect(formatRemaining(0, 5000, 'seconds')).toBe('5 sec remaining of 5 sec');
    expect(formatRemaining(0, 600000, 'minutes')).toBe('10 min remaining of 10 min');
    expect(formatRemaining(0, 7200000, 'hours')).toBe('2 hours remaining of 2 hours');
  });

  it('subtracts used from total in every unit system', () => {
    expect(formatRemaining(500, 2048, 'bytes')).toBe('1.5 KB remaining of 2.0 KB');
    expect(formatRemaining(30000, 60000, 'minutes')).toBe('30 sec remaining of 1 min');
  });

  it('falls back to a bare number pair for an unknown allocation string', () => {
    expect(formatRemaining(3, 10, 'steps')).toBe('7 remaining of 10');
  });
});
