import { useState, useRef, useLayoutEffect } from 'preact/hooks';
import QRCode from 'qrcode';
import '../styles/guest-wifi-print.css';
import { ubusCall } from '../lib/ubus';
import { GUEST_SECTIONS, guestWifiPayload } from '../lib/guest-wifi-qr';

export default function GuestWifiCard() {
  const [section, setSection] = useState(GUEST_SECTIONS[0]);
  const [card, setCard] = useState<{ ssid: string; image: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  // Save/refresh removes this instance; obsolete fetch/encoder results die with it.
  useLayoutEffect(() => () => { generation.current++; }, []);
  async function prepare() {
    const request = ++generation.current;
    setCard(null); setError(''); setBusy(true);
    try {
      // Fetch only the selected guest section. Never fetch config.json/private_key.
      const result = await ubusCall('uci', 'get', { config: 'wireless', section });
      if (request !== generation.current) return;
      const cfg = result?.values;
      if (!cfg) throw new Error('Guest configuration unavailable.');
      const payload = guestWifiPayload(section, cfg);
      const svg = await QRCode.toString(payload, { type: 'svg', margin: 4, width: 320, errorCorrectionLevel: 'M' });
      if (request !== generation.current) return;
      setCard({ ssid: cfg.ssid, image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` });
    } catch (err) {
      if (request !== generation.current) return;
      // Do not render RPC error text: a transport error could include credentials.
      setError('Cannot prepare guest card. Check that this is an enabled guest AP using open or WPA/WPA2-Personal authentication on lan/guest.');
    } finally { if (request === generation.current) setBusy(false); }
  }
  return <section className="card guest-wifi-controls">
    <h3>Guest Wi-Fi table card</h3>
    <p>Only guest credentials are encoded. Printing publishes the guest password inside the QR code. Never use a management network.</p>
    <label>Guest radio <select aria-label="Guest radio" value={section} disabled={busy} onChange={e => { setSection(e.currentTarget.value); setCard(null); setError(''); }}>
      {GUEST_SECTIONS.map(s => <option key={s} value={s}>{s === GUEST_SECTIONS[0] ? '2.4 GHz guest' : '5 GHz guest'}</option>)}
    </select></label>
    <button className="btn btn-secondary" disabled={busy} onClick={prepare}>{busy ? 'Preparing…' : 'Prepare guest card'}</button>
    {error && <p role="alert">{error}</p>}
    {card && <>
      <article id="guest-wifi-print-card" style={{ background: 'white', color: 'black', padding: '24px', textAlign: 'center' }}>
        <h2>Guest Wi-Fi</h2><p>{card.ssid}</p>
        <img src={card.image} width="320" height="320" alt="Scan to join guest Wi-Fi" />
        <p>Scan with your phone camera and confirm joining Wi-Fi.</p>
        <p>Then open the Wi-Fi sign-in notification to access the captive portal.</p>
        <p>Joining Wi-Fi does not include paid internet access.</p>
      </article>
      <button className="btn btn-primary" onClick={() => window.print()}>Print guest card</button>
      <button className="btn btn-secondary" onClick={() => setCard(null)}>Hide guest card</button>
    </>}
  </section>;
}
