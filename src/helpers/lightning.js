export const requestInvoice = async (amount, device, i18n) => {
  try {
    // for testing    
    return {
      status: 1,
      invoice: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ'
    };

    // Send the request to the TollGate server
    const baseUrl = getTollgateBaseUrl();

    const response = await fetch(`${baseUrl}/ln-invoice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({amount, device}),
    });
    
    if (!response.ok) {
      console.error('Server error:', response);
      return {
        status: 0,
        code: 'LN01',
        label: "Invoice request failed",
        message: "Server error. Reload the page and try again."
      };
    }

    const invoice = await response.text();

    return {
      status: 1,
      invoice
    };
  } catch (error) {
    console.error('Error sending token:', error);
    return {
      status: 0,
      code: 'LN02',
      label: "Invoice request failed",
      message: "Reload the page and try again."
    };
  }
}