import tollgateLogo from '../assets/logo/TollGate_Logo-C-white.png';
import tollgateIcon from '../assets/logo/TollGate_icon-White.png';

export default {
  brand: {
    name: 'TollGate',
    logo: tollgateLogo,
    icon: tollgateIcon,
    poweredByText: 'TollGate',
    poweredByUrl: 'https://tollgate.me/',
  },

  colors: {
    cta: '#FFB54C',
    ctaTransparent: 'rgba(255, 181, 76, .8)',
    background: '#080e1d',
    black: '#000',
    foreground: '#171D35',
    particleLine: null,
  },

  pwa: {
    enabled: true,
    themeColor: '#FFB54C',
    backgroundColor: '#080e1d',
    icons: {
      192: tollgateIcon,
      512: tollgateIcon,
    },
  },

  features: {
    sizeSelector: true,
    pwaModal: true,
  },
};
