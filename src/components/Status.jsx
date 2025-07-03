// internal
import { ErrorIcon, SuccessIcon } from './Icon.jsx'

// styles and assets
import './Status.scss'

// error message component for displaying error notifications to the user
export const Error = (props) => {
  const {label, code, message} = props;

  return <div className="status error">
    <div className="status-header">
      {/* label with error icon and text */}
      <p className="status-label">
        <ErrorIcon />
        {label}
      </p>
      {/* optional error code */}
      {code && <p className="status-code">#{code}</p>}
    </div>
    {/* optional error message content */}
    {message && <div className="status-content">
      <p className="status-message">{message}</p>
    </div>}
  </div>
}

// success message component for displaying success notifications to the user
export const Success = (props) => {
  const {label, info, message} = props;

  return <div className="status success">
    <div className="status-header">
      {/* label with success icon and text */}
      <p className="status-label">
        <SuccessIcon />
        {label}
      </p>
      {/* optional info, e.g. amount or details */}
      {info && <p className="status-info">{info}</p>}
    </div>
    {/* optional success message content, can include html */}
    {message && <div className="status-content">
      <p className="status-message" dangerouslySetInnerHTML={{__html:message}}></p>
    </div>}
  </div>
}