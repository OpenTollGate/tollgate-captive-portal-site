import { describe, it, expect } from 'vitest';
import { formatTimeInSeconds, formatDataSize, calculateAllocation } from '../../src/helpers/tollgate.js';

describe('formatTimeInSeconds', () => {
  it('formats seconds under 60 as seconds', () => {
    const result = formatTimeInSeconds(30000, true, (k) => k);
    expect(result.value).toBe(30);
    expect(result.unit).toBe('second_abbreviation');
  });

  it('formats seconds between 60-3600 as minutes', () => {
    const result = formatTimeInSeconds(600000, true, (k) => k);
    expect(result.value).toBe(10);
    expect(result.unit).toBe('minute_abbreviation');
  });

  it('formats seconds >= 3600 as hours', () => {
    const result = formatTimeInSeconds(7200000, true, (k) => k);
    expect(result.value).toBe(2);
    expect(result.unit).toBe('hour_abbreviation');
  });
});

describe('formatDataSize', () => {
  it('formats bytes under 1 KiB as B', () => {
    const result = formatDataSize(512, (k) => k);
    expect(result.value).toBe(512);
  });

  it('formats bytes >= 1 MiB as MiB', () => {
    const result = formatDataSize(2097152, (k) => k);
    expect(result.value).toBe('2.00');
  });
});

describe('calculateAllocation', () => {
  it('calculates millisecond allocation from amount and mint', () => {
    const mint = {
      metric: 'milliseconds',
      step_size: 600000,
      price: 210,
      unit: 'sat',
      min_steps: 1,
    };
    const result = calculateAllocation(420, mint, (k) => k);
    expect(result).toBeTruthy();
    expect(result.unit).toBe('minute_plural');
  });
});
