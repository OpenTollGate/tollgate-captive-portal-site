import { describe, it, expect } from 'vitest';
import { allocationError, redistribute, validLightningAddress } from '../../admin/src/lib/profit-share';

const rows = () => [{ identity: 'owner', percent: '80' }, { identity: 'treasury', percent: '20' }];

describe('owner payout allocation', () => {
  it('accepts exactly allocated shares and rejects invalid or missing owner shares', () => {
    expect(allocationError(rows())).toBe('');
    expect(allocationError([{ identity: 'owner', percent: '50' }])).toContain('100%');
    expect(allocationError([{ identity: 'owner', percent: '' }])).toContain('percentage');
    expect(allocationError([{ identity: 'owner', percent: '0' }, { identity: 'treasury', percent: '100' }])).toContain('owner');
    expect(allocationError([{ identity: 'treasury', percent: '100' }])).toContain('owner');
    expect(allocationError([{ identity: 'owner', percent: '50' }, { identity: 'owner', percent: '50' }])).toContain('once');
  });

  it('keeps slider totals exact and leaves the source rows untouched', () => {
    const original = [...rows(), { identity: 'venue', percent: '0' }];
    const changed = redistribute(original, 2, 33.33);
    expect(changed.reduce((sum, row) => sum + Math.round(Number(row.percent) * 100), 0)).toBe(10000);
    expect(changed[2].percent).toBe('33.33');
    expect(Number(changed[0].percent)).toBeGreaterThan(Number(changed[1].percent));
    expect(original).toEqual([...rows(), { identity: 'venue', percent: '0' }]);
  });

  it('keeps a positive owner share when another slider reaches its end', () => {
    const result = redistribute(rows(), 1, 100);
    expect(Number(result[0].percent)).toBeGreaterThan(0);
    expect(allocationError(result)).toBe('');
    expect(redistribute([{ identity: 'owner', percent: '100' }], 0, 10)[0].percent).toBe('100.00');
  });

  it('handles empty remaining weights deterministically', () => {
    const result = redistribute([{ identity: 'owner', percent: '100' }, { identity: 'treasury', percent: '0' }, { identity: 'venue', percent: '0' }], 0, 50);
    expect(result.map(row => row.percent)).toEqual(['50.00', '25.00', '25.00']);
  });

  it('validates Lightning address format without contacting or paying a recipient', () => {
    expect(validLightningAddress('recipient@example.com')).toBe(true);
    for (const value of ['', 'recipient', 'recipient@', 'a@@example.com', 'a b@example.com', 'https://example.com', 'a@example..com']) {
      expect(validLightningAddress(value)).toBe(false);
    }
  });
});
