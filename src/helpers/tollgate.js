// tollgate host
// replace this if your are not developing the tollgate captive portal directly on a tollgate
// export const currentHost = "10.50.184.1";
const currentHost = window.location.hostname;

// Get the base URL dynamically
export const getTollgateBaseUrl = () => {
  // Always use port 2121 as specified in the TollGate spec
  return `http://${currentHost}:2121`;
};

// Function to fetch the TollGate details and device info
export const fetchTollgateData = async (i18n = (k, v) => k) => {
  try {
    const baseUrl = getTollgateBaseUrl();

    // for debugging
    // return {
    //   status: 1,
    //   value: {
    //     detailsEvent: {
    //       kind: 10021,
    //       id: "298930dc3fbc7d6cd81fa256f75982647a66459870f84df4ab1394c653605b38",
    //       pubkey: "dcce4729d4b134d5471a2c699dac1387fd769262ba8cbf183317082a6b612b8a",
    //       created_at: 0,
    //       tags: [
    //         [ "metric", "bytes" ],
    //         [ "step_size", "600000"],
    //         [ "tips", "1", "2", "3", "4" ],
    //         [ "price_per_step", "cashu", "1", "", "https://mint.minibits.cash/Bitcoin", "0" ],
    //         [ "price_per_step", "cashu", "2", "", "https://mint2.nutmix.cash", "0" ]
    //       ],
    //       content: "",
    //       sig: "0f3aed6edd5725865c863c4c2e4e019f8e81370944d1bb9df702102dec95d1e0141bec2ccca6cbf3f1f73aef2a3b6039bf5b0083c04e892c013368d215e19642"
    //     },
    //     deviceInfo: {
    //       type: 'mac',
    //       value: '1A:2B:3C:4D:5E'
    //     }
    //   }
    // }

    // Fetch TollGate details
    const detailsResponse = await fetch(`${baseUrl}/`);
    if (!detailsResponse.ok) {
      return {
        status: 0,
        code: 'TG01',
        label: i18n('TG01_label'),
        message: detailsResponse.status || i18n('TG01_message')
      };
    }

    const detailsEvent = await detailsResponse.json();

    // Fetch device MAC address
    const whoamiResponse = await fetch(`${baseUrl}/whoami`);

    if (!whoamiResponse.ok) {
      return {
        status: 'error',
        code: 'TG02',
        label: i18n('TG02_label'),
        message: whoamiResponse.status || i18n('TG02_message')
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
      code: 'TG03',
      label: i18n('TG03_label'),
      message: i18n('TG03_message')
    };
  }
};

// example tollgate data 
// {
//   kind = 10021,
//   id = "298930dc3fbc7d6cd81fa256f75982647a66459870f84df4ab1394c653605b38",
//   pubkey = "dcce4729d4b134d5471a2c699dac1387fd769262ba8cbf183317082a6b612b8a",
//   created_at = 0,
//   tags = [
//     [ "metric", "milliseconds" ],
//     [ "step_size", "600000"],
//     [ "tips", "1", "2", "3", "4" ],
//     [ "price_per_step", "cashu", "1", "", "https://mint.minibits.cash/Bitcoin", "0" ],
//     [ "price_per_step", "cashu", "2", "", "https://mint2.nutmix.cash", "0" ]
//   ],
//   content = "",
//   sig = "0f3aed6edd5725865c863c4c2e4e019f8e81370944d1bb9df702102dec95d1e0141bec2ccca6cbf3f1f73aef2a3b6039bf5b0083c04e892c013368d215e19642"
// }

export const getAccessOptions = (detailEvent, i18n) => {
  if (!detailEvent || !Array.isArray(detailEvent.tags)) return [];

  // Extract metric and step_size from tags
  let metric = null;
  let step_size = null;

  for (const tag of detailEvent.tags) {
    if (tag[0] === 'metric') metric = tag[1];
    if (tag[0] === 'step_size') step_size = Number(tag[1]);
  }

  // Return error if any of the variables is not successfully extracted
  if ("string" !== typeof metric || "number" !== typeof step_size) {
    return {
      status: 0,
      code: 'TG04',
      label: i18n('TG04_label'),
      message: i18n('TG04_message')
    };
  }

  // Find all price_per_step tags
  const pricing = detailEvent.tags
    .filter((tag) => {
      // filter tags 'price_per_step' at index 0
      return tag[0] === 'price_per_step'
    })
    .map((tag) => {
      // extract pricing info for each mint

      // ["price_per_step", "<bearer_asset_type>", "<price>", "<unit>", "<mint_url>", "<min_steps>"]
      // Example: [ 'price_per_step', 'cashu', '1', '', 'https://mint.minibits.cash/Bitcoin', '0' ]

      const asset_type = tag[1] || '';
      if("cashu" !== asset_type) return;

      const price = tag[2] ? Number(tag[2]) : false;
      if (!price) return;

      const unit = tag[3] || 'sat';

      const url = tag[4] || '';
      if(!url.length) return;

      // If tag[5] exists and is a number, use as min_steps, else fallback
      const min_steps = tag[5] !== undefined && !isNaN(Number(tag[5])) ? Number(tag[5]) : 0;

      return {
        metric,
        step_size,
        url,
        asset_type,
        price,
        unit,
        min_steps
      };
    }).sort((a, b) => {
      // sort by price asc
      return a.price - b.price
    });

  return pricing;
}

export const getStepSizeValues = (mint, i18n) => {
  // set stepsize to mint.step_size or 1 if 0
  const setpSize = mint.step_size || 1;

  if ('milliseconds' === mint.metric) {
    return formatTimeInSeconds(setpSize, i18n)
  } else if ('bytes' === mint.metric) {
    return formatDataSize(setpSize, i18n);
  }

  return false;
}

export const formatTimeInSeconds = (milliseconds, i18n) => {
  const seconds = milliseconds / 1000;
  if (seconds < 60) {
    return {
      value: (seconds % 1 !== 0) ? seconds.toFixed(2) : seconds, // decimals when needed
      unit: seconds === 1 ? i18n('second') : i18n('second_plural')
    };
  } else if (seconds < 3600) {
    const minutes = seconds / 60;
    return {
      value: (minutes % 1 !== 0) ? minutes.toFixed(2) : minutes, // decimals when needed
      unit: minutes === 1 ? i18n('minute') : i18n('minute_plural')
    };
  } else {
    const hours = seconds / 3600;
    return {
      value: (hours % 1 !== 0) ? hours.toFixed(2) : hours, // decimals when needed
      unit: hours === 1 ? i18n('hour') : i18n('hour_plural')
    };
  }
};

// Helper function to format data size in user-friendly units
export const formatDataSize = (kibiBytes, i18n) => {
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

// Calculate allocation of milliseconds or bytes
export const calculateAllocation = (token, mint, i18n) => {
  const allocation = token.amount / mint.price * mint.step_size;
  if ('milliseconds' === mint.metric) {
    return formatTimeInSeconds(allocation, i18n)
  } else if ('bytes' === mint.metric) {
    return formatDataSize(allocation, i18n);
  }
}