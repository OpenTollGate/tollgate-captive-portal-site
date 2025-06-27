import { nip19, getPublicKey, getEventHash, finishEvent, signEvent } from 'nostr-tools';
import { getDecodedToken } from '@cashu/cashu-ts';

// Get the base URL dynamically
export const getTollgateBaseUrl = () => {
  // Get the current host (without port)
  // const currentHost = window.location.hostname;
  const currentHost = "10.50.184.1";
  // Always use port 2121 as specified in the TollGate spec
  return `http://${currentHost}:2121`;
};

// Function to fetch the TollGate details and device info
export const fetchTollgateData = async () => {
  try {
    const baseUrl = getTollgateBaseUrl();
    // Fetch TollGate details
    const detailsResponse = await fetch(`${baseUrl}/`);
    if (!detailsResponse.ok) {
      return {
        status: 0,
        code: 2,
        label: 'Failed to fetch TollGate details',
        message: `${detailsResponse.status}`
      };
    }
    const detailsEvent = await detailsResponse.json();
    // Fetch device MAC address
    const whoamiResponse = await fetch(`${baseUrl}/whoami`);

    if (!whoamiResponse.ok) {
      return {
        status: 'error',
        code: 3,
        label: 'Failed to fetch device info',
        message: `${whoamiResponse.status}`
      };
    }
    const whoamiText = await whoamiResponse.text();
    
    // Parse format like 'mac=00:11:22:33:44:55'
    const [identifierType, identifierValue] = whoamiText.trim().split('=');
    const deviceInfo = {
      type: identifierType,
      value: identifierValue
    };

    return {
      status: 1,
      value: {
        detailsEvent,
        deviceInfo
      }
    };
  } catch (err) {
    console.error('Error fetching TollGate data:', err);
    return {
      status: 0,
      code: 1,
      label: 'Could not fetch TollGate information',
      message: 'TollGate could not connect to its relay. Contact the network administrator or try again later.'
    };
  }
};

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

// Helper function to format data size in user-friendly units
export const formatDataSize = (kibiBytes) => {
  if (kibiBytes < 1024) {
    return {
      value: kibiBytes,
      unit: i18n('KiB')
    };
  } else if (kibiBytes < 1048576) { // Less than 1 GB
    return {
      value: (kibiBytes / 1024).toFixed(1),
      unit: i18n('MB')
    };
  } else {
    return {
      value: (kibiBytes / 1048576).toFixed(2),
      unit: i18n('GB')
    };
  }
};

// Helper function to format time in seconds to appropriate units
export const formatTimeInSeconds = (seconds) => {
  if (seconds < 60) {
    return {
      value: Math.round(seconds),
      unit: seconds === 1 ? 'second' : 'seconds'
    };
  } else if (seconds < 3600) {
    const minutes = seconds / 60;
    return {
      value: minutes.toFixed(1),
      unit: minutes === 1 ? 'minute' : 'minutes'
    };
  } else {
    const hours = seconds / 3600;
    return {
      value: hours.toFixed(2),
      unit: hours === 1 ? 'hour' : 'hours'
    };
  }
};

// Helper function to get pricing info
export const getPricingInfo = (detailsEvent) => {
  if (!detailsEvent || !detailsEvent.tags) return null;
  
  const metric = detailsEvent.tags.find(tag => tag[0] === 'metric');
  const stepSize = detailsEvent.tags.find(tag => tag[0] === 'step_size');
  const mints = detailsEvent.tags.filter(tag => tag[0] === 'price_per_step');
  
  if (!metric || !stepSize || !mints) return null;
  
  return {
    metric: metric[1],
    stepSize: Number(stepSize[1]),
    mints: mints
  };
};

// Update the pricing format to be more digestible
export const formatPricingInfo = (metric, price, stepSize, i18n) => {
  if (!metric || !price || !stepSize) return i18n('mint_pricing_info_unavailable');

  // Format price (sats)
  const priceInt = Number(price);
  const priceStr = priceInt === 1
    ? i18n('sat', { count: priceInt })
    : i18n('sat_plural', { count: priceInt });

  let unitStr = '';

  if (metric === 'milliseconds') {
    // Convert stepSize to seconds, minutes, or hours
    let value, unitKey;
    if (stepSize < 60000) {
      value = Math.round(stepSize / 1000);
      unitKey = value === 1 ? 'second' : 'second_plural';
    } else if (stepSize < 3600000) {
      value = +(stepSize / 60000).toFixed(1);
      unitKey = value === 1 ? 'minute' : 'minute_plural';
    } else {
      value = +(stepSize / 3600000).toFixed(2);
      unitKey = value === 1 ? 'hour' : 'hour_plural';
    }
    unitStr = `${value} ${i18n(unitKey)}`;
  } else if (metric === 'bytes') {
    // Convert stepSize to KiB, MB, or GB
    if (stepSize < 1024) {
      unitStr = `${stepSize} ${i18n('KiB')}`;
    } else if (stepSize < 1048576) {
      unitStr = `${(stepSize / 1024).toFixed(1)} ${i18n('MB')}`;
    } else {
      unitStr = `${(stepSize / 1048576).toFixed(2)} ${i18n('GB')}`;
    }
  } else {
    unitStr = `${stepSize} ${metric}`;
  }

  // Use the translation key for the pricing string
  // Wrap price and unit in <strong> tags for emphasis
  return i18n('mint_pricing', {
    price: `<strong>${priceStr}</strong>`,
    unit: `<strong>${unitStr}</strong>`
  });
};

// Helper function to calculate purchased allocation
export const calculatePurchasedAllocation = (sats, metric, price, stepSize, i18n) => {
  if (!sats || !metric || !price || !stepSize) return i18n('mint_pricing_info_unavailable');

  // Calculate total allocation: (sats / price) * stepSize
  const totalSteps = sats / price;
  const totalAllocation = totalSteps * stepSize;

  let purchasedStr = '';

  if (metric === 'milliseconds') {
    // Convert milliseconds to seconds, minutes, or hours
    let value, unitKey;
    if (totalAllocation < 60000) {
      value = Math.round(totalAllocation / 1000);
      unitKey = value === 1 ? 'second' : 'second_plural';
    } else if (totalAllocation < 3600000) {
      value = +(totalAllocation / 60000).toFixed(1);
      unitKey = value === 1 ? 'minute' : 'minute_plural';
    } else {
      value = +(totalAllocation / 3600000).toFixed(2);
      unitKey = value === 1 ? 'hour' : 'hour_plural';
    }
    purchasedStr = `${value} ${i18n(unitKey)}`;
  } else if (metric === 'bytes') {
    // Convert to KiB, MB, or GB
    if (totalAllocation < 1024) {
      purchasedStr = `${Math.round(totalAllocation)} ${i18n('KiB')}`;
    } else if (totalAllocation < 1048576) {
      purchasedStr = `${(totalAllocation / 1024).toFixed(1)} ${i18n('MB')}`;
    } else {
      purchasedStr = `${(totalAllocation / 1048576).toFixed(2)} ${i18n('GB')}`;
    }
  } else {
    purchasedStr = `${totalAllocation} ${metric}`;
  }

  return purchasedStr;
};

// When token is pasted, extract proofs and calculate total value
export const validateToken = (token = '') => {
  try {
    if (!token.trim()) {
      return {
        status: 0,
        code: 1,
        label: 'Token missing',
        message: 'No token provided.'
      };
    }

    // Basic validation - Cashu tokens should start with "cashu"
    if (!token.trim().startsWith('cashu')) {
      return {
        status: 0,
        code: 2,
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
          code: 3,
          label: 'Invalid Cashu Token',
          message: 'Token could not be decoded.'
        };
      }
    } catch(err) {
      return {
        status: 0,
        code: 3,
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
      code: 4,
      label: 'Token validation error',
      message: error.message || 'Invalid token format.'
    };
  }
};

// Handle manual page close
export const handleClosePage = () => {
  // Set that the close button was clicked
  setCloseButtonClicked(true);
  
  // Try closing the window
  window.close();
  
  // If we're still here after a short delay, the close failed
  setTimeout(() => {
    // No need to show alert anymore since we'll show the message in UI
    // The fact that this code runs means the window wasn't closed
  }, 300);
};

// Update the handleSendToken function
export const handleSendToken = async () => {
  try {
    setStatus('Sending token...');
    
    if (!deviceInfo || !tollgateDetails) {
      throw new Error('Missing device information or TollGate details');
    }
    
    // Get TollGate pubkey from event
    const tollgatePubkey = tollgateDetails.pubkey;
    
    // Generate a random private key for signing
    const privateKeyBytes = window.crypto.getRandomValues(new Uint8Array(32));
    const privateKeyHex = Array.from(privateKeyBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    // Generate the pubkey from private key using nostr-tools
    let pubkey;
    try {
      pubkey = getPublicKey(privateKeyHex);
    } catch (e) {
      console.error('Error getting public key:', e);
      throw new Error('Failed to generate keys for signing');
    }
    
    // Create the Nostr event according to TIP-01 spec
    const unsignedEvent = {
      kind: 21000,
      pubkey: pubkey,
      content: "",
      created_at: nostrNow(),
      tags: [
        ["p", tollgatePubkey],
        ["device-identifier", deviceInfo.type, deviceInfo.value],
        ["payment", token],
      ],
    };
    
    // Calculate the event hash (id)
    const id = getEventHash(unsignedEvent);
    
    // Sign the event using signEvent, which is still available
    const sig = signEvent(unsignedEvent, privateKeyHex);
    
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
        throw new Error('Payment required. Your token was not accepted.');
      } else {
        throw new Error(`Server error: ${response.status}`);
      }
    }
    
    // Success!
    setStatus('');
    setShowSuccess(true);
    
    // Try to auto-close the page after 3 seconds
    setTimeout(() => {
      window.close();
      // If we're still here after a short delay, show the close button
      setTimeout(() => {
        setShowCloseButton(true);
      }, 500);
    }, 3000);
    
    // Reset form
    setToken('');
    setTokenValue(null);
    
  } catch (error) {
    console.error('Error sending token:', error);
    setStatus(`Error: ${error.message}`);
  }
};
