export interface ShareDraft { identity: string; percent: string; originalFactor?: number; originalPercent?: string }

export function validLightningAddress(value: string): boolean {
  if (!value || value.length > 254 || /\s/.test(value)) return false;
  const parts = value.split('@');
  return parts.length === 2 && /^[A-Za-z0-9._+-]+$/.test(parts[0]) &&
    parts[1].includes('.') && parts[1].split('.').every(label =>
      /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}

export function allocationError(rows: ShareDraft[]): string {
  if (new Set(rows.map(row => row.identity)).size !== rows.length) return 'Each recipient may appear only once.';
  if (rows.some(row => row.percent.trim() === '' || !Number.isFinite(Number(row.percent)) || Number(row.percent) < 0 || Number(row.percent) > 100)) return 'Enter a percentage between 0 and 100 for every recipient.';
  if (!rows.some(row => row.identity === 'owner' && Number(row.percent) > 0)) return 'The owner must have a positive share for payouts to work.';
  if (Math.abs(rows.reduce((sum, row) => sum + Number(row.percent), 0) - 100) > 0.000001) return 'Shares must total 100%.';
  return '';
}

// Sliders redistribute the remainder in integer hundredths of a percent.
// Largest-remainder rounding is deterministic and never loses percentage points.
export function redistribute(rows: ShareDraft[], index: number, percent: number): ShareDraft[] {
  if (rows.length === 1) return rows.map(row => ({ ...row, percent: '100.00' }));
  const desired = Math.min(rows[index].identity === 'owner' ? 10000 : 9999,
    Math.max(rows[index].identity === 'owner' ? 1 : 0, Math.round(percent * 100)));
  const remainder = 10000 - desired;
  const others = rows.map((row, i) => ({ i, weight: Math.max(0, Number(row.percent) || 0) })).filter(row => row.i !== index);
  const weight = others.reduce((sum, row) => sum + row.weight, 0);
  const amounts = others.map(row => {
    const exact = remainder * (weight ? row.weight / weight : 1 / others.length);
    return { ...row, units: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let left = remainder - amounts.reduce((sum, row) => sum + row.units, 0);
  for (const row of [...amounts].sort((a, b) => b.fraction - a.fraction || a.i - b.i)) {
    if (left-- > 0) row.units++;
  }
  const owner = amounts.find(row => rows[row.i].identity === 'owner');
  if (owner && owner.units === 0) {
    const donor = [...amounts].sort((a, b) => b.units - a.units).find(row => row !== owner && row.units > 0);
    if (donor) { donor.units--; owner.units++; }
    else owner.units = 1;
  }
  return rows.map((row, i) => ({ ...row, percent: ((i === index ? desired : amounts.find(entry => entry.i === i)!.units) / 100).toFixed(2) }));
}
