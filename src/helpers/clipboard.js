export const copyTextToClipboard = async(e, text, i18n) =>{
  const defaultTextContent = e.target.textContent;
  e.target.textContent = i18n('clipboard_copying')
  e.target.classList.add('clipboard-copying')
  try {
    await navigator.clipboard.writeText(text);
    e.target.classList.remove('clipboard-copying')
    e.target.classList.add('clipboard-success')
    e.target.textContent = i18n('clipboard_success')
    setTimeout(() => {
      e.target.classList.remove('clipboard-success')
      e.target.textContent = defaultTextContent
    }, 1000)
    // Optionally, provide user feedback (e.g., a temporary "Copied!" message)
  } catch (err) {
    console.error('Failed to copy text: ', err);
    e.target.classList.remove('clipboard-copying')
    e.target.textContent = i18n('clipboard_error')
    setTimeout(() => {
      e.target.classList.remove('clipboard-error')
      e.target.textContent = defaultTextContent
    }, 1000)
    // Optionally, inform the user that copying failed and suggest manual copy
  }
}