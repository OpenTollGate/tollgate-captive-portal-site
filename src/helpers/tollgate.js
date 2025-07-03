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

    // TODO: keep this up do date (last update @blockheight 903814)
    // example tollgate tip01 data https://github.com/OpenTollGate/tollgate/blob/main/protocol/01.md
    // just for development
    return {
      status: 1,
      value: {
        detailsEvent: {
          kind: 10021,
          id: "298930dc3fbc7d6cd81fa256f75982647a66459870f84df4ab1394c653605b38",
          pubkey: "dcce4729d4b134d5471a2c699dac1387fd769262ba8cbf183317082a6b612b8a",
          created_at: 0,
          tags: [
            ["metric", "milliseconds"], // milliseconds or byte
            ["step_size", "600000"], // 1 minute step size
            ["step_purchase_limits", "1", "0"], // Min 1 minute, max infinite minutes
            ["tips", "1", "2", "3", "4"],
            ["price_per_step", "cashu", "210", "sat", "https://mint.domain.net", 1],
            ["price_per_step", "cashu", "210", "sat", "https://other.mint.net", 1],
            ["price_per_step", "cashu", "500", "sat", "https://mint.thirddomain.eu", 3],
          ],
          content: "",
          sig: "0f3aed6edd5725865c863c4c2e4e019f8e81370944d1bb9df702102dec95d1e0141bec2ccca6cbf3f1f73aef2a3b6039bf5b0083c04e892c013368d215e19642"
        },
        deviceInfo: {
          type: 'mac',
          value: '1A:2B:3C:4D:5E'
        }
      }
    }

    // Fetch TollGate details
    const detailsResponse = await fetch(`${baseUrl}/`);
    if (!detailsResponse.ok) {
      return {
        status: 0,
        code: 'TG01',
        label: i18n('TG01_label'),
        message: i18n('TG01_message')
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
        message: i18n('TG02_message')
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

export const getAccessOptions = (detailEvent, i18n) => {
  if (!detailEvent || !Array.isArray(detailEvent.tags)) return [];

  // Extract metric, step_size and step_purchase_limits from tags
  let metric = null;
  let step_size = null;
  let step_purchase_limits = { min: 1, max: 0 };

  for (const tag of detailEvent.tags) {
    if (tag[0] === 'metric') metric = tag[1];
    if (tag[0] === 'step_size') step_size = Number(tag[1]);
    if (tag[0] === 'step_purchase_limits') {
      step_purchase_limits.min = tag[1] && !isNaN(tag[1]) ? Number(tag[1]) : 1;
      step_purchase_limits.max = tag[2] && !isNaN(tag[2]) ? Number(tag[2]) : 0;
    };
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
  const accessOptions = detailEvent.tags
    .filter((tag) => {
      // filter tags 'price_per_step' at index 0
      return tag[0] === 'price_per_step'
    })
    .map((tag) => {
      // extract accessOptions info for each mint

      // TODO: keep this up do date (last update @blockheight 903814)
      // example tollgate tip01 data https://github.com/OpenTollGate/tollgate/blob/main/protocol/01.md
      // ["price_per_step", "<bearer_asset_type>", "<price>", "<unit>", "<mint_url>", "<min_steps>"]

      const asset_type = tag[1] || '';
      if("cashu" !== asset_type) return;

      const price = tag[2] ? Number(tag[2]) : false;
      if (!price) return;

      const unit = tag[3] || 'sat';

      const url = tag[4] || '';
      if(!url.length) return;

      // If tag[5] exists and is a number, use as min_steps, else fallback
      let min_steps = tag[5] !== undefined ? tag[5] : 0;
      min_steps = isNaN(min_steps) ? 0 :  Number(min_steps)

      return {
        metric,
        step_size,
        step_purchase_limits,
        url,
        asset_type,
        price,
        unit,
        min_steps
      };
    }).sort((a, b) => {
      // sort by best option
      // TODO: what if option.unit is exotic? how to compare different units?

      // Based on https://github.com/OpenTollGate/tollgate/blob/main/protocol/02.md
      // compare price per step calculating from min_steps
      return a.price / (a.min_steps || 1) - b.price / (b.min_steps || 1)
    });

  // console.log(accessOptions)

  return accessOptions;
}

export const getStepSizeValues = (mint, i18n) => {
    if ('milliseconds' === mint.metric) {
    return formatTimeInSeconds(mint.step_size, true, i18n)
  } else if ('bytes' === mint.metric) {
    return formatDataSize(mint.step_size, i18n);
  }

  return false;
}

export const formatTimeInSeconds = (milliseconds, abbreviate, i18n) => {
  const seconds = milliseconds / 1000;
  if (seconds < 60) {
    return {
      value: (seconds % 1 !== 0) ? seconds.toFixed(2) : seconds, // decimals when needed
      unit: abbreviate ? i18n('second_abbreviation') : seconds === 1 ? i18n('second') : i18n('second_plural')
    };
  } else if (seconds < 3600) {
    const minutes = seconds / 60;
    return {
      value: (minutes % 1 !== 0) ? minutes.toFixed(2) : minutes, // decimals when needed
      unit: abbreviate ? i18n('minute_abbreviation') : minutes === 1 ? i18n('minute') : i18n('minute_plural')
    };
  } else {
    const hours = seconds / 3600;
    return {
      value: (hours % 1 !== 0) ? hours.toFixed(2) : hours, // decimals when needed
      unit: abbreviate ? i18n('hour_abbreviation') : hours === 1 ? i18n('hour') : i18n('hour_plural')
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
export const calculateAllocation = (amount, mint, i18n) => {
  const allocation = mint.step_size * (amount / mint.price *  (mint.min_steps || 1));

  if ('milliseconds' === mint.metric) {
    return formatTimeInSeconds(allocation, false, i18n)
  } else if ('bytes' === mint.metric) {
    return formatDataSize(allocation, i18n);
  }
}