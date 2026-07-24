import { describe, it, expect } from 'vitest';
import { validateToken } from '../cashu';

const i18n = (key, fallback) => fallback || key;

const mockMint = {
  url: 'https://mint.example.com',
  price: 1,
  unit: 'sat',
  metric: 'bytes',
  step_size: 1000,
  min_steps: 1,
};

describe('validateToken', () => {
  it('returns CU100 for empty token', () => {
    const result = validateToken('', mockMint, i18n);
    expect(result.status).toBe(0);
    expect(result.code).toBe('CU100');
  });

  it('returns CU101 for token not starting with cashu', () => {
    const result = validateToken('notcashu', mockMint, i18n);
    expect(result.status).toBe(0);
    expect(result.code).toBe('CU101');
  });

  it('accepts a mint parameter without crashing', () => {
    expect(() => validateToken('cashuBtest', mockMint, i18n)).not.toThrow();
  });

  it('handles null mint without crashing', () => {
    expect(() => validateToken('cashuBtest', null, i18n)).not.toThrow();
  });
});
