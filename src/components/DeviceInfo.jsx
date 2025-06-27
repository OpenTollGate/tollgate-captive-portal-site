import { useTranslation, Trans } from 'react-i18next';

export const DeviceInfo = (props) => {
  const { tollgateDetails } = props;
  const { t: i18n } = useTranslation();

  let type = 'unkonw_type';
  let value = 'unknown_value';

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

  // console.log(tollgateDetails, type, value)

  return <p className="tollgate-captive-portal-deviceinfo">
    {type}: {value}
  </p>;
}

export default DeviceInfo