// Detect whether the clipboard read API is usable in the current context.
//
// navigator.clipboard.readText() is only available in a *secure context*
// (HTTPS or localhost). Captive portals serve over plain HTTP, so on most
// Android captive-portal WebViews navigator.clipboard is undefined and the
// paste button silently fails with a confusing error. This pure feature
// detection lets us hide the button instead of showing a broken one.
export function hasClipboardSupport() {
  return !!(
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.readText === "function"
  );
}

// request text from the user's clipboard
export const requestPaste = async (i18n) => {
  try {
    // try to read text from the clipboard using the browser api
    const text = await navigator.clipboard.readText();
    if ("string" === typeof text) {
      // successfully read text, return it
      return {
        status: 1,
        value: text || "",
      };
    } else {
      // clipboard is empty or not a string, return error object
      return {
        status: 0,
        code: "CB002",
        label: i18n("CB002_label"),
        message: i18n("CB002_message"),
      };
    }
  } catch (err) {
    // handle permission denied or other errors
    if (err && err.name && err.name === "NotAllowedError") {
      // user denied clipboard access
      return {
        status: 0,
        code: "CB001",
        label: i18n("CB001_label"),
        message: i18n("CB001_message"),
      };
    } else {
      // other clipboard errors
      return {
        status: 0,
        code: "CB002",
        label: i18n("CB002_label"),
        message: i18n("CB002_message"),
      };
    }
  }
};

// HTTP captive portals often have no Clipboard API. Keep the legacy copy
// operation in the click handler so browsers can still use its user gesture.
function copyWithSelection(text) {
  const active = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
    : [];
  const inputSelection = active && typeof active.selectionStart === "number"
    ? [active.selectionStart, active.selectionEnd, active.selectionDirection]
    : null;
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px;";
  document.body.appendChild(field);
  try {
    field.select();
    field.setSelectionRange(0, text.length);
    if (!document.execCommand || !document.execCommand("copy")) {
      throw new Error("Clipboard copy was denied");
    }
  } finally {
    field.remove();
    active?.focus({ preventScroll: true });
    if (inputSelection) active.setSelectionRange(...inputSelection);
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach((range) => selection.addRange(range));
    }
  }
}

// copy the given text to the user's clipboard and provide ui feedback
export const copyTextToClipboard = async (e, text, i18n) => {
  // currentTarget is the button, even when an icon inside it was clicked.
  // Capture it before awaiting: event.currentTarget is cleared after dispatch.
  const button = e.currentTarget || e.target;
  // save the original button text
  const defaultTextContent = button.textContent;
  // show copying state
  button.textContent = i18n("clipboard_copying");
  button.classList.add("clipboard-copying");
  try {
    if (typeof navigator.clipboard?.writeText === "function") {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        copyWithSelection(text);
      }
    } else {
      copyWithSelection(text);
    }
    // show success state
    button.classList.remove("clipboard-copying");
    button.classList.add("clipboard-success");
    button.textContent = i18n("clipboard_success");
    setTimeout(() => {
      button.classList.remove("clipboard-success");
      button.textContent = defaultTextContent;
    }, 1000);
    // optionally, provide user feedback (e.g., a temporary "copied!" message)
  } catch (err) {
    // failed to copy, show error state
    console.error("failed to copy text: ", err);
    button.classList.remove("clipboard-copying");
    button.classList.add("clipboard-error");
    button.textContent = i18n("clipboard_error");
    setTimeout(() => {
      button.classList.remove("clipboard-error");
      button.textContent = defaultTextContent;
    }, 1000);
    // optionally, inform the user that copying failed and suggest manual copy
  }
};
