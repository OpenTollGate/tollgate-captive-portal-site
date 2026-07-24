import './DemoBanner.scss';

export const DemoBanner = () => {
  if (!import.meta.env.VITE_MOCK) return null;

  return (
    <div className="demo-banner">
      <span className="demo-banner__dot" />
      Demo Mode — using simulated data
    </div>
  );
};

export default DemoBanner;
