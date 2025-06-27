import { ErrorIcon, SuccessIcon } from './Icon.jsx'
import './Status.scss'

export const Error = (props) => {
  const {label, code, message} = props;

  return <div className="status error">
    <div className="status-header">
      <p className="status-label">
        <ErrorIcon />
        {label}
      </p>
      {code && <p className="status-code">#{code}</p>}
    </div>
    {message && <div className="status-content">
      <p className="status-message">{message}</p>
    </div>}
  </div>
}

export const Success = (props) => {
  const {label, info, message} = props;

  return <div className="status success">
    <div className="status-header">
      <p className="status-label">
        <SuccessIcon />
        {label}
      </p>
      {info && <p className="status-info">{info}</p>}
    </div>
    {message && <div className="status-content">
      <p className="status-message" dangerouslySetInnerHTML={{__html:message}}></p>
    </div>}
  </div>
}