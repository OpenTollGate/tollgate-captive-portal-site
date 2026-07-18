export const parseUsageResponse = (text) => {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed === '-1/-1') return null;
  const parts = trimmed.split('/');
  if (parts.length !== 2) return null;
  const used = parseInt(parts[0], 10);
  const total = parseInt(parts[1], 10);
  if (isNaN(used) || isNaN(total)) return null;
  return { used, total };
};

const formatBytes = (bytes) => {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
};

const formatTime = (ms) => {
  if (ms >= 3600000) return Math.round(ms / 3600000) + ' hours';
  if (ms >= 60000) return Math.round(ms / 60000) + ' min';
  return Math.round(ms / 1000) + ' sec';
};

export const formatRemaining = (used, total, allocationStr) => {
  const remaining = total - used;
  const isBytes = /B\b|byte/i.test(allocationStr);
  const isTime = /min|hour|sec|time/i.test(allocationStr);

  if (isBytes) {
    return `${formatBytes(remaining)} remaining of ${formatBytes(total)}`;
  }
  if (isTime) {
    return `${formatTime(remaining)} remaining of ${formatTime(total)}`;
  }
  return `${remaining} remaining of ${total}`;
};
