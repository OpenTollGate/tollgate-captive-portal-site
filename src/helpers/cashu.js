import { getDecodedToken } from '@cashu/cashu-ts';
import { getPublicKey, getEventHash, getSignature } from 'nostr-tools';
import { getTollgateBaseUrl } from './tollgate'

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
export const validateToken = (token = '', mint, i18n) => {
  try {
    if ('string' !== typeof token || !token.trim()) {
      return {
        status: 0,
        code: 'CU01',
        label: i18n('CU01_label'),
        message: i18n('CU01_message')
      };
    }

    // Basic validation - Cashu tokens should start with "cashu"
    if (!token.trim().startsWith('cashu')) {
      return {
        status: 0,
        code: 'CU02',
        label: i18n('CU02_label'),
        message: i18n('CU02_message')
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
          label: i18n('CU03_label'),
          message: i18n('CU03_message')
        };
      }
    } catch(err) {
      return {
        status: 0,
        code: 'CU03',
        label: i18n('CU03_label'),
        message: i18n('CU03_message')
      };
    }

    // Extract proofs from the token
    const proofs = extractProofsFromToken(decodedToken);
    if (!proofs || proofs.length === 0) {
      return {
        status: 0,
        code: 'CU04',
        label: i18n('CU04_label'),
        message: i18n('CU04_message')
      };
    }

    // Calculate the sum of proof values
    const totalAmount = proofs.reduce((sum, proof) => {
      const proofAmount = Number(proof.amount || 0);
      return sum + proofAmount;
    }, 0);

    // TODO: check if token unit matches mint unit

    // Return the token value with proof details
    return {
      status: 1,
      value: {
        isValid: true,
        hasProofs: true,
        amount: totalAmount,
        proofCount: proofs.length,
        unit: 'sat'
      }
    };
  } catch (error) {
    console.error('Error decoding token:', error);
    return {
      status: 0,
      code: 'CU05',
      label: i18n('CU05_label'),
      message: error.message || i18n('CU05_message')
    };
  }
};

export const submitToken = async (token, tollgateDetails, allocation, i18n) => {
  try {
    // Get TollGate pubkey from event
    const tollgatePubkey = tollgateDetails.detailsEvent.pubkey;
    // Generate a random private key for signing
    const privateKeyBytes = window.crypto.getRandomValues(new Uint8Array(32));
    const privateKeyHex = Array.from(privateKeyBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    // Generate the pubkey from private key using nostr-tools
    let pubkey;
    try {
      pubkey = getPublicKey(privateKeyHex);
    } catch (error) {
      console.error('Error getting public key:', error);
      return {
        status: 0,
        code: 'CU06',
        label: i18n('CU06_label'),
        message: error.message || i18n('CU06_message')
      };
    }
    
    // Create the Nostr event according to TIP-01 spec
    const unsignedEvent = {
      kind: 21000,
      pubkey: pubkey,
      content: "",
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["p", tollgatePubkey],
        ["device-identifier", tollgateDetails.deviceInfo.type, tollgateDetails.deviceInfo.value],
        ["payment", token],
      ],
    };
    
    // Calculate the event hash (id)
    const id = getEventHash(unsignedEvent);
    
    // Sign the event using signEvent, which is still available
    const sig = getSignature(unsignedEvent, privateKeyHex);
    
    // Create a clean event object for sending
    const event = {
      ...unsignedEvent,
      id,
      sig
    };
    
    console.log('Sending signed event:', event);

    // Send the event to the TollGate server
    const baseUrl = getTollgateBaseUrl();
    const response = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });
    
    if (!response.ok) {
      if (response.status === 402) {
        console.error('Error processing token:', response);
        return {
          status: 0,
          code: 'CU07',
          label: i18n('CU07_label'),
          message: response.message || i18n('CU07_message')
        };
      } else {
        console.error('Server error:', response);
        return {
          status: 0,
          code: 'CU08',
          label: i18n('CU08_label'),
          message: response.message || i18n('CU08_message')
        };
      }
    }

    return {
      status: 1,
      label: i18n('access_granted_title'),
      message: i18n('access_granted_subtitle', { purchased: allocation })
    };
  } catch (error) {
    console.error('Error sending token:', error);
    return {
      status: 0,
      code: 'CU09',
      label: i18n('CU09_label'),
      message: error.message || i18n('CU09_message')
    };
  }
}