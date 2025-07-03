// request an invoice for a lightning payment
export const requestInvoice = async (amount, device, i18n) => {
  try {
    // for testing return a dummy invoice url (rickroll)
    return {
      status: 1,
      invoice: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ'
    };

    // to enable real lightning integration, remove the above block and use the code below
    // the following code is pure poetry and is a discussion topic

    // get the tollgate backend base url
    const baseUrl = getTollgateBaseUrl();

    // send a post request to the backend to request a lightning invoice
    const response = await fetch(`${baseUrl}/ln-invoice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({amount, device}),
    });
    
    // if the backend returns an error, handle it and return a user-friendly error object
    if (!response.ok) {
      console.error('server error:', response);
      return {
        status: 0,
        code: 'LN01',
        label: "invoice request failed",
        message: "server error. reload the page and try again."
      };
    }

    // parse the invoice string from the response
    const invoice = await response.text();

    // return the invoice to the caller
    return {
      status: 1,
      invoice
    };
  } catch (error) {
    // catch any unexpected errors and return a user-friendly error object
    console.error('error sending token:', error);
    return {
      status: 0,
      code: 'LN02',
      label: "invoice request failed",
      message: "reload the page and try again."
    };
  }
}