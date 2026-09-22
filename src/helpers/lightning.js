import { getTollgateBaseUrl, getClientMac } from "./tollgate";

// the backend identifies the client by the "mac" query parameter and falls back
// to an IP-derived lookup only when it is absent (main.go: HandleLightningInvoice).
// the portal already knows its MAC from the /whoami device info, so every
// /ln-invoice call carries it: without it the invoice is created against the IP
// the request happens to arrive from, which is not necessarily the client the
// operator is looking at.
const macQuery = (deviceInfo) => {
  const mac = getClientMac(deviceInfo);
  return mac ? `mac=${encodeURIComponent(mac)}` : "";
};

// runtime capability probe for the lightning payment method.
//
// The lightning tab must not be offered on gateways whose backend build has no
// /ln-invoice route (older builds), so we ask the backend once and only enable
// the tab when it answers with our JSON envelope. A GET without a quote is
// side-effect free: the backend replies 400 {"status":0,"error":"quote is
// required"} when the route exists, and a non-JSON 404 when it does not.
export const probeLightningCapability = async () => {
  try {
    const baseUrl = getTollgateBaseUrl();
    const response = await fetch(`${baseUrl}/ln-invoice`, { method: "GET" });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return { supported: false };
    }

    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object" || !("status" in payload)) {
      return { supported: false };
    }

    return { supported: true };
  } catch (error) {
    console.error("lightning capability probe failed:", error);
    return { supported: false };
  }
};

const invoiceRequestError = (i18n, message) => ({
  status: 0,
  code: "LN003",
  label: i18n("LN003_label"),
  message: message || i18n("LN003_message"),
});

const invoiceStatusError = (i18n, message) => ({
  status: 0,
  code: "LN004",
  label: i18n("LN004_label"),
  message: message || i18n("LN004_message"),
});

// request an invoice for a lightning payment
export const requestInvoice = async (amount, mintUrl, i18n, deviceInfo) => {
  try {
    const baseUrl = getTollgateBaseUrl();
    const mac = macQuery(deviceInfo);
    const response = await fetch(`${baseUrl}/ln-invoice${mac ? `?${mac}` : ""}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount, mint_url: mintUrl }),
    });

    const payload = await response.json();

    if (!response.ok || !payload.status) {
      console.error("invoice request failed:", payload);
      return invoiceRequestError(i18n, payload?.error);
    }

    return {
      status: 1,
      quote: payload.quote,
      invoice: payload.invoice,
      mintUrl: payload.mint_url,
      amount: payload.amount,
      expiry: payload.expiry,
      state: payload.state,
    };
  } catch (error) {
    console.error("error requesting invoice:", error);
    return invoiceRequestError(i18n);
  }
};

export const getInvoiceStatus = async (quote, i18n, deviceInfo) => {
  try {
    const baseUrl = getTollgateBaseUrl();
    const mac = macQuery(deviceInfo);
    const response = await fetch(
      `${baseUrl}/ln-invoice?quote=${encodeURIComponent(quote)}${mac ? `&${mac}` : ""}`
    );
    const payload = await response.json();

    if (!response.ok || !payload.status) {
      console.error("invoice status request failed:", payload);
      return invoiceStatusError(i18n, payload?.error);
    }

    return {
      status: 1,
      quote: payload.quote,
      mintUrl: payload.mint_url,
      amount: payload.amount,
      state: payload.state,
      accessGranted: payload.access_granted,
      allotment: payload.allotment,
      metric: payload.metric,
    };
  } catch (error) {
    console.error("error checking invoice status:", error);
    return invoiceStatusError(i18n);
  }
};
