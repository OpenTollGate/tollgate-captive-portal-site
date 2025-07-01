import { getDecodedToken } from '@cashu/cashu-ts';

// Safely extract proofs from a decoded token
export const extractProofsFromToken = (decodedToken) => {
  const proofs = [];
  
  try {
    // Handle token array format
    if (decodedToken.token && Array.isArray(decodedToken.token)) {
      decodedToken.token.forEach(t => {
        if (t.proofs && Array.isArray(t.proofs)) {
          proofs.push(...t.proofs);
        }
      });
    }
    // Handle single token format
    else if (decodedToken.token && decodedToken.token.proofs) {
      proofs.push(...decodedToken.token.proofs);
    }
    // Handle direct token structure
    else if (decodedToken.proofs && Array.isArray(decodedToken.proofs)) {
      proofs.push(...decodedToken.proofs);
    }
    // Handle token with tokens array
    else if (decodedToken.tokens && Array.isArray(decodedToken.tokens)) {
      decodedToken.tokens.forEach(t => {
        if (t.proofs && Array.isArray(t.proofs)) {
          proofs.push(...t.proofs);
        }
      });
    }
  } catch (error) {
    console.error('Error extracting proofs:', error);
  }
  
  return proofs;
};

// When token is pasted, extract proofs and calculate total value
export const validateToken = (token = '') => {
  try {
    if (!token.trim()) {
      return {
        status: 0,
        code: 'CU01',
        label: 'Token missing',
        message: 'No token provided.'
      };
    }

    // Basic validation - Cashu tokens should start with "cashu"
    if (!token.trim().startsWith('cashu')) {
      return {
        status: 0,
        code: 'CU02',
        label: 'Invalid token format',
        message: 'Cashu tokens should start with "cashu".'
      };
    }

    // Attempt to decode the token using the getDecodedToken method
    let decodedToken = null;
    try {
      decodedToken = getDecodedToken(token.trim());
      if (!decodedToken) {
        return {
          status: 0,
          code: 'CU03',
          label: 'Invalid Cashu Token',
          message: 'Token could not be decoded.'
        };
      }
    } catch(err) {
      return {
        status: 0,
        code: 'CU03',
        label: 'Invalid Cashu Token',
        message: 'Token could not be decoded.'
      };
    }

    // Extract proofs from the token
    const proofs = extractProofsFromToken(decodedToken);
    if (!proofs || proofs.length === 0) {
      // If we couldn't extract proofs, still accept the token but show no value
      return {
        status: 1,
        value: {
          isValid: true,
          hasProofs: false
        }
      };
    }

    // Calculate the sum of proof values
    const totalAmount = proofs.reduce((sum, proof) => {
      const proofAmount = Number(proof.amount || 0);
      return sum + proofAmount;
    }, 0);

    // Return the token value with proof details
    return {
      status: 1,
      value: {
        isValid: true,
        hasProofs: true,
        amount: totalAmount,
        proofCount: proofs.length,
        unit: 'sats'
      }
    };
  } catch (error) {
    console.error('Error decoding token:', error);
    return {
      status: 0,
      code: 'CU04',
      label: 'Token validation error',
      message: error.message || 'Invalid token format.'
    };
  }
};