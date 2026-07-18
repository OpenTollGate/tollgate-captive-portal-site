import { describe, it, expect } from 'vitest';
import { parseUsageResponse, formatRemaining } from '../usage';

describe('parseUsageResponse', () => {
  it('parses valid used/total', () => {
    const result = parseUsageResponse('12345678/104857600');
    expect(result).toEqual({ used: 12345678, total: 104857600 });
  });

  it('returns null for -1/-1 (expired)', () => {
    expect(parseUsageResponse('-1/-1')).toBeNull();
  });

  it('returns null for invalid format', () => {
    expect(parseUsageResponse('invalid')).toBeNull();
    expect(parseUsageResponse('')).toBeNull();
    expect(parseUsageResponse('123')).toBeNull();
    expect(parseUsageResponse('abc/def')).toBeNull();
  });

  it('handles whitespace', () => {
    const result = parseUsageResponse('  100/200  ');
    expect(result).toEqual({ used: 100, total: 200 });
  });
});

describe('formatRemaining', () => {
  it('formats bytes remaining', () => {
    const result = formatRemaining(12345678, 104857600, '100 MB');
    expect(result).toBe('88.2 MB remaining of 100.0 MB');
  });

  it('formats time remaining', () => {
    const result = formatRemaining(600000, 1800000, '30 min');
    expect(result).toBe('20 min remaining of 30 min');
  });

  it('shows full amount when nothing used', () => {
    const result = formatRemaining(0, 104857600, '100 MB');
    expect(result).toBe('100.0 MB remaining of 100.0 MB');
  });

  it('handles GB range', () => {
    const result = formatRemaining(1073741824, 2147483648, '2 GB');
    expect(result).toBe('1.0 GB remaining of 2.0 GB');
  });

  it('handles hours', () => {
    const result = formatRemaining(3600000, 7200000, '2 hours');
    expect(result).toBe('1 hours remaining of 2 hours');
  });
});
