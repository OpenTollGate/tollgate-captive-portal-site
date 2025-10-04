// external
import { useTranslation, Trans } from 'react-i18next';

// main component for displaying device info in the portal footer
export const DeviceInfo = (props) => {
  const { tollgateDetails } = props;
  const { t: i18n } = useTranslation();

  // set default values for device type and value
  let type = 'unkonw_type';
  let value = 'unknown_value';

  // extract device type and value from tollgateDetails if available
  if (tollgateDetails.deviceInfo) {
    if (tollgateDetails.deviceInfo.type) {
      if ('mac' === tollgateDetails.deviceInfo.type) {
        type = i18n(`device_${tollgateDetails.deviceInfo.type}`);
      }
    }
    if (tollgateDetails.deviceInfo.value) {
      value = tollgateDetails.deviceInfo.value;
    }
  }

  // render a paragraph with the device type and value
  return <p className="tollgate-captive-portal-deviceinfo">
    {/* shows the device type and value, e.g. mac address, for the user */}
    {type}: {value}
  </p>;
}

export default DeviceInfo