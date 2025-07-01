import { useTranslation, Trans } from 'react-i18next';

import DeviceInfo from './DeviceInfo';
import LanguageSwitcher from './LanguageSwitcher';

import './Lightning.scss'

export const Lightning = (props) => {
  const { tollgateDetails } = props;
  const { t: i18n } = useTranslation();
  console.log(tollgateDetails)
  
  return <div className="tollgate-captive-portal-method-lightning tollgate-captive-portal-method">
      <div className="tollgate-captive-portal-method-header">
        <h1>{i18n('portal_title')}</h1>
        <h2><Trans i18nKey="provide_lightning" components={{ 1: <a href="https://en.wikipedia.org/wiki/Lightning_Network" target="_blank" rel="noreferrer"></a> }} /></h2>
      </div>
      <div className="tollgate-captive-portal-method-content">
        asd
      </div>
      <div className="tollgate-captive-portal-method-footer">
        <DeviceInfo tollgateDetails={tollgateDetails} />
        <LanguageSwitcher />
      </div>
  </div>;
}

export default Lightning