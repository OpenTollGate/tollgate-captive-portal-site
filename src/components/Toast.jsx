import { useToast } from './ToastContext';
import './Toast.scss';

const ICONS = {
  info: (
    <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
      <path d="M10 0C4.48 0 0 4.48 0 10s4.48 10 10 10 10-4.48 10-10S15.52 0 10 0zm1 15H9v-2h2v2zm0-4H9V5h2v6z"/>
    </svg>
  ),
  success: (
    <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
      <path d="M10 0C4.48 0 0 4.48 0 10s4.48 10 10 10 10-4.48 10-10S15.52 0 10 0zm-1 15l-5-5 1.41-1.41L9 12.17l7.59-7.59L18 6l-9 9z"/>
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
      <path d="M1 17h18L10 1 1 17zm10-3H9v-2h2v2zm0-4H9V7h2v3z"/>
    </svg>
  ),
};

const ToastItem = ({ toast, onDismiss }) => {
  return (
    <div className={`toast toast--${toast.type}`} onClick={() => onDismiss(toast.id)}>
      <span className="toast__icon">{ICONS[toast.type] || ICONS.info}</span>
      <span className="toast__message">{toast.message}</span>
    </div>
  );
};

export const ToastContainer = () => {
  const { toasts, removeToast } = useToast();

  if (!toasts.length) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
      ))}
    </div>
  );
};

export default ToastContainer;
