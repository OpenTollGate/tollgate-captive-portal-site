// helpers/balance.js
//
// Thin "internet balance" layer for the captive portal.
//
// IMPORTANT: this does NOT fabricate a balance backend. A user's "internet
// balance" is the time/bytes a given Cashu token grants against the selected
// mint, computed with the SAME validation + allocation helpers the purchase
// flow uses. This keeps the balance page truthful — it only ever reports
// values derived from a real token and the tollgate's real pricing event.

// helpers (real implementations)
import { validateToken } from './cashu';
import { calculateAllocation } from './tollgate';

// Compute the internet balance a Cashu token represents for a given mint.
//
// @param {string}  token - a cashu token string
// @param {object}  mint  - a mint/access-option object (from getAccessOptions)
// @param {function} i18n - translation function
// @returns {object} { status: 1, value: { amount, unit, allocation: {value, unit} } }
//                    or { status: 0, code, label, message } when the token is invalid
export const getInternetBalance = (token, mint, i18n) => {
  // validate the token first (format, decode, proof sum, mint match)
  const validation = validateToken(token, mint, i18n);
  if (!validation.status) {
    return validation;
  }

  // derive the internet balance (time/bytes) the token grants
  return {
    status: 1,
    value: {
      amount: validation.value.amount,
      unit: validation.value.unit,
      allocation: calculateAllocation(validation.value.amount, mint, i18n),
    },
  };
};

// Format an allocation object ({ value, unit }) into a single readable string,
// e.g. { value: 10, unit: 'min' } -> "10 min".
export const formatBalance = (allocation) => {
  if (!allocation || allocation.value == null) {
    return '';
  }
  return `${allocation.value} ${allocation.unit}`;
};
