// tollgate host
// replace this if your are not developing the tollgate captive portal directly on a tollgate
// export const currentHost = "10.50.184.1";
const currentHost = window.location.hostname;

// get the base url dynamically
export const getTollgateBaseUrl = () => {
  // always use port 2121 as specified in the tollgate spec
  return `http://${currentHost}:2121`;
};

// function to fetch the tollgate details and device info
export const fetchTollgateData = async (i18n = (k, v) => k) => {
  try {
    const baseUrl = getTollgateBaseUrl();

    // this block is for development only: it returns mock data instead of fetching from the backend
    // todo: keep this up do date (last update @blockheight 903814)
    // example tollgate tip01 data https://github.com/OpenTollGate/tollgate/blob/main/protocol/01.md
    // return {
    //   status: 1,
    //   value: {
    //     detailsEvent: {
    //       kind: 10021,
    //       id: "298930dc3fbc7d6cd81fa256f75982647a66459870f84df4ab1394c653605b38",
    //       pubkey: "dcce4729d4b134d5471a2c699dac1387fd769262ba8cbf183317082a6b612b8a",
    //       created_at: 0,
    //       tags: [
    //         ["metric", "milliseconds"], // milliseconds or byte
    //         ["step_size", "600000"], // 1 minute step size
    //         ["step_purchase_limits", "1", "0"], // min 1 minute, max infinite minutes
    //         ["tips", "1", "2", "3", "4"],
    //         ["price_per_step", "cashu", "210", "sat", "https://mint.domain.net", 1],
    //         ["price_per_step", "cashu", "210", "sat", "https://other.mint.net", 1],
    //         ["price_per_step", "cashu", "500", "sat", "https://mint.thirddomain.eu", 3],
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

    // fetch tollgate details from the backend
    const detailsResponse = await fetch(`${baseUrl}/`);
    if (!detailsResponse.ok) {
      // if the request fails, return a specific error object
      return {
        status: 0,
        code: 'TG001',
        label: i18n('TG001_label'),
        message: i18n('TG001_message')
      };
    }

    // parse the tollgate event details from the response
    const detailsEvent = await detailsResponse.json();

    // fetch device mac address from the backend
    const whoamiResponse = await fetch(`${baseUrl}/whoami`);

    if (!whoamiResponse.ok) {
      // if the request fails, return a specific error object
      return {
        status: 'error',
        code: 'TG002',
        label: i18n('TG002_label'),
        message: i18n('TG002_message')
      };
    }

    // the response is expected to be in the format 'mac=00:11:22:33:44:55'
    const whoamiText = await whoamiResponse.text();
    
    // parse the device identifier type and value
    const [identifierType, identifierValue] = whoamiText.trim().split('=');
    const deviceInfo = {
      type: identifierType,
      value: identifierValue
    };

    // return the details event and device info in a structured object
    return {
      status: 1,
      value: {
        detailsEvent,
        deviceInfo
      }
    };
  } catch (err) {
    // catch any unexpected errors and return a general error object
    console.error('error fetching tollgate data:', err);
    return {
      status: 0,
      code: 'TG003',
      label: i18n('TG003_label'),
      message: i18n('TG003_message')
    };
  }
};

export const getAccessOptions = (detailEvent, i18n) => {
  // if the event or its tags are missing, return an empty array
  if (!detailEvent || !Array.isArray(detailEvent.tags)) return [];

  // extract metric, step_size and step_purchase_limits from tags
  let metric = null;
  let step_size = null;
  let step_purchase_limits = { min: 1, max: 0 };

  // iterate over tags to extract relevant parameters
  for (const tag of detailEvent.tags) {
    if (tag[0] === 'metric') metric = tag[1];
    if (tag[0] === 'step_size') step_size = Number(tag[1]);
    if (tag[0] === 'step_purchase_limits') {
      step_purchase_limits.min = tag[1] && !isNaN(tag[1]) ? Number(tag[1]) : 1;
      step_purchase_limits.max = tag[2] && !isNaN(tag[2]) ? Number(tag[2]) : 0;
    };
  }

  // return error if any of the variables is not successfully extracted
  if ("string" !== typeof metric || "number" !== typeof step_size) {
    return {
      status: 0,
      code: 'TG004',
      label: i18n('TG004_label'),
      message: i18n('TG004_message')
    };
  }

  // find all price_per_step tags and map them to access option objects
  const accessOptions = detailEvent.tags
    .filter((tag) => {
      // filter tags 'price_per_step' at index 0
      return tag[0] === 'price_per_step'
    })
    .map((tag) => {
      // extract access options info for each mint
      // todo: keep this up do date (last update @blockheight 903814)
      // example tollgate tip01 data https://github.com/OpenTollGate/tollgate/blob/main/protocol/01.md
      // ["price_per_step", "<bearer_asset_type>", "<price>", "<unit>", "<mint_url>", "<min_steps>"]

      // only support cashu asset type for now
      const asset_type = tag[1] || '';
      if("cashu" !== asset_type) return;

      // parse price and skip if invalid
      const price = tag[2] ? Number(tag[2]) : false;
      if (!price) return;

      // parse unit and url
      const unit = tag[3] || 'sat';
      const url = tag[4] || '';
      if(!url.length) return;

      // parse min_steps if present, otherwise default to 0
      let min_steps = tag[5] !== undefined ? tag[5] : 0;
      min_steps = isNaN(min_steps) ? 0 :  Number(min_steps)

      // return a structured access option object
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
      // sort by best option (lowest price per step)
      // todo: what if option.unit is exotic? how to compare different units?
      // based on https://github.com/OpenTollGate/tollgate/blob/main/protocol/02.md
      // compare price per step calculating from min_steps
      return a.price / (a.min_steps || 1) - b.price / (b.min_steps || 1)
    });

  // return the sorted access options array
  return accessOptions;
}

export const getStepSizeValues = (mint, i18n) => {
  // convert step size to human-readable format based on metric
  if ('milliseconds' === mint.metric) {
    return formatTimeInSeconds(mint.step_size, true, i18n)
  } else if ('bytes' === mint.metric) {
    return formatDataSize(mint.step_size, i18n);
  }

  // return false if metric is not recognized
  return false;
}

export const formatTimeInSeconds = (milliseconds, abbreviate, i18n) => {
  // convert milliseconds to seconds
  const seconds = milliseconds / 1000;
  if (seconds < 60) {
    // less than a minute, show seconds
    return {
      value: (seconds % 1 !== 0) ? seconds.toFixed(2) : seconds, // decimals when needed
      unit: abbreviate ? i18n('second_abbreviation') : seconds === 1 ? i18n('second') : i18n('second_plural')
    };
  } else if (seconds < 3600) {
    // less than an hour, show minutes
    const minutes = seconds / 60;
    return {
      value: (minutes % 1 !== 0) ? minutes.toFixed(2) : minutes, // decimals when needed
      unit: abbreviate ? i18n('minute_abbreviation') : minutes === 1 ? i18n('minute') : i18n('minute_plural')
    };
  } else {
    // one hour or more, show hours
    const hours = seconds / 3600;
    return {
      value: (hours % 1 !== 0) ? hours.toFixed(2) : hours, // decimals when needed
      unit: abbreviate ? i18n('hour_abbreviation') : hours === 1 ? i18n('hour') : i18n('hour_plural')
    };
  }
};

// helper function to format data size in user-friendly units
export const formatDataSize = (kibiBytes, i18n) => {
  // show value in kib, mb, or gb depending on size
  if (kibiBytes < 1024) { // less than 1 mb
    return {
      value: kibiBytes,
      unit: i18n('KiB')
    };
  } else if (kibiBytes < 1048576) { // less than 1 gb
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

// calculate allocation of milliseconds or bytes for a given amount and mint
export const calculateAllocation = (amount, mint, i18n) => {
  // allocation is proportional to the amount paid, step size, and min_steps
  const allocation = mint.step_size * (amount / mint.price *  (mint.min_steps || 1));

  // return formatted allocation based on metric
  if ('milliseconds' === mint.metric) {
    return formatTimeInSeconds(allocation, false, i18n)
  } else if ('bytes' === mint.metric) {
    return formatDataSize(allocation, i18n);
  }
}