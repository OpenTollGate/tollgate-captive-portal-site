// external
import { useTranslation, Trans } from 'react-i18next';

// main component for displaying device info in the portal footer
export const DeviceInfo = (props) => {
  const { tollgateDetails } = props;
  const { t: i18n } = useTranslation();

  // defensively resolve deviceInfo. the /whoami endpoint may return an error or
  // an empty/undefined payload, in which case tollgateDetails (or its deviceInfo)
  // may be null/undefined. accessing .deviceInfo.type without these guards would
  // throw a TypeError and crash the entire SPA.
  const deviceInfo = tollgateDetails?.deviceInfo;

  // if no device info is available (e.g. /whoami errored), render the footer
  // without the device info line instead of crashing
  if (!deviceInfo) {
    return null;
  }

  // set default values for device type and value
  let type = 'unkonw_type';
  let value = 'unknown_value';

  // extract device type and value from deviceInfo using null-safe access
  if (deviceInfo?.type) {
    if ('mac' === deviceInfo.type) {
      type = i18n(`device_${deviceInfo.type}`);
    }
  }
  if (deviceInfo?.value) {
    value = deviceInfo.value;
  }

  // render a paragraph with the device type and value
  return <p className="tollgate-captive-portal-deviceinfo">
    {/* shows the device type and value, e.g. mac address, for the user */}
    {type}: {value}
  </p>;
}

export default DeviceInfo