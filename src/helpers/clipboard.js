// request text from the user's clipboard
export const requestPaste = async (i18n) => {
  try {
    // try to read text from the clipboard using the browser api
    const text = await navigator.clipboard.readText();
    if ('string' === typeof text) {
      // successfully read text, return it
      return {
        status: 1,
        value: text || ''
      }
    } else {
      // clipboard is empty or not a string, return error object
      return {
        status: 0,
        code: 'CB002',
        label: i18n('CB002_label'),
        message: i18n('CB002_message')
      }
    }
  } catch (err) {
    // handle permission denied or other errors
    if (err && err.name && err.name === 'NotAllowedError') {
      // user denied clipboard access
      return {
        status: 0,
        code: 'CB001',
        label: i18n('CB001_label'),
        message: i18n('CB001_message')
      }
    } else {
      // other clipboard errors
      return {
        status: 0,
        code: 'CB002',
        label: i18n('CB002_label'),
        message: i18n('CB002_message')
      }
    }
  }
}

// copy the given text to the user's clipboard and provide ui feedback
export const copyTextToClipboard = async(e, text, i18n) =>{
  // save the original button text
  const defaultTextContent = e.target.textContent;
  // show copying state
  e.target.textContent = i18n('clipboard_copying')
  e.target.classList.add('clipboard-copying')
  try {
    // try to write text to the clipboard
    await navigator.clipboard.writeText(text);
    // show success state
    e.target.classList.remove('clipboard-copying')
    e.target.classList.add('clipboard-success')
    e.target.textContent = i18n('clipboard_success')
    setTimeout(() => {
      e.target.classList.remove('clipboard-success')
      e.target.textContent = defaultTextContent
    }, 1000)
    // optionally, provide user feedback (e.g., a temporary "copied!" message)
  } catch (err) {
    // failed to copy, show error state
    console.error('failed to copy text: ', err);
    e.target.classList.remove('clipboard-copying')
    e.target.textContent = i18n('clipboard_error')
    setTimeout(() => {
      e.target.classList.remove('clipboard-error')
      e.target.textContent = defaultTextContent
    }, 1000)
    // optionally, inform the user that copying failed and suggest manual copy
  }
}