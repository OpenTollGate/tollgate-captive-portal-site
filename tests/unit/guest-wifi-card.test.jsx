/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import GuestWifiCard from '../../admin/src/components/guest-wifi-card';
import QRCode from 'qrcode';
import { ubusCall } from '../../admin/src/lib/ubus';
vi.mock('../../admin/src/lib/ubus', () => ({ ubusCall: vi.fn() }));
const guest = { '.type': 'wifi-iface', mode: 'ap', network: 'guest', ssid: 'Cafe', encryption: 'none' };
let host;
function button(text) { return [...host.querySelectorAll('button')].find(b => b.textContent === text); }
async function mount() { host = document.createElement('div'); document.body.append(host); await act(() => render(h(GuestWifiCard), host)); }
async function click(text) { await act(async () => { button(text).click(); await new Promise(r => setTimeout(r, 0)); }); }
afterEach(() => { render(null, host); host.remove(); vi.restoreAllMocks(); vi.resetAllMocks(); });
describe('guest card component', () => {
  it('redacts encoder failure', async () => {
    vi.spyOn(QRCode, 'toString').mockRejectedValue(new Error('SECRET encoder'));
    ubusCall.mockResolvedValue({values:guest}); await mount(); await click('Prepare guest card');
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    expect(host.textContent).not.toContain('SECRET');
  });
  it.each(['fetch', 'encoder', 'error'])('discards pending %s on unmount', async stage => {
    let settle;
    const pending = new Promise((resolve, reject) => { settle = stage === 'error' ? reject : resolve; });
    const encoder = vi.spyOn(QRCode, 'toString');
    if (stage === 'encoder') { ubusCall.mockResolvedValue({values:guest}); encoder.mockReturnValue(pending); }
    else ubusCall.mockReturnValue(pending);
    await mount(); await act(async () => { button('Prepare guest card').click(); await Promise.resolve(); });
    await act(() => render(null, host));
    await act(async () => { settle(stage === 'error' ? new Error('SECRET') : stage === 'encoder' ? '<svg/>' : {values:guest}); await Promise.resolve(); });
    expect(host.innerHTML).toBe('');
    // NOTE: innerHTML alone does NOT prove the `generation` guard fires —
    // Preact no-ops setState after unmount (BaseComponent.setState guards on
    // this._vnode). What the guard really prevents is the fetch-then-encode
    // continuation running after the card is gone: 'fetch' must never reach
    // the encoder. The other two stages are covered for isolation only.
    expect(encoder).toHaveBeenCalledTimes(stage === 'encoder' ? 1 : 0);
  });
  it('reads only the selected guest and discards credentials on hide and selection', async () => {
    ubusCall.mockResolvedValue({ values: guest }); await mount(); await click('Prepare guest card');
    expect(ubusCall).toHaveBeenCalledExactlyOnceWith('uci', 'get', { config: 'wireless', section: 'tollgate_2g_open' });
    expect(host.querySelector('img')).not.toBeNull();
    window.print = vi.fn(); await click('Print guest card'); expect(window.print).toHaveBeenCalledOnce();
    await click('Hide guest card'); expect(host.querySelector('img')).toBeNull();
    await click('Prepare guest card');
    await act(() => { const select = host.querySelector('select'); select.value = 'tollgate_5g_open'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.querySelector('img')).toBeNull(); await click('Prepare guest card');
    expect(ubusCall).toHaveBeenLastCalledWith('uci', 'get', { config: 'wireless', section: 'tollgate_5g_open' });
  });
  it.each([undefined, {}, { values: { ...guest, network: 'private', key: 'SECRET' } }])('fails closed for missing or unsafe replies %j', async reply => {
    ubusCall.mockResolvedValue(reply); await mount(); await click('Prepare guest card');
    expect(host.querySelector('[role=alert]')).not.toBeNull(); expect(host.querySelector('img')).toBeNull(); expect(host.textContent).not.toContain('SECRET');
  });
  it('clears an old card on retry and redacts transport errors', async () => {
    ubusCall.mockResolvedValueOnce({ values: guest }).mockRejectedValueOnce(new Error('SECRET transport'));
    await mount(); await click('Prepare guest card'); await click('Prepare guest card');
    expect(host.querySelector('img')).toBeNull(); expect(host.textContent).not.toContain('SECRET'); expect(button('Prepare guest card').disabled).toBe(false);
  });
  it('disables controls while awaiting credentials', async () => {
    let resolve; ubusCall.mockReturnValue(new Promise(r => resolve = r)); await mount();
    await act(() => button('Prepare guest card').click());
    expect(host.querySelector('select').disabled).toBe(true); expect(button('Preparing…').disabled).toBe(true);
    await act(async () => { resolve({values:guest}); await new Promise(r => setTimeout(r, 0)); }); expect(host.querySelector('select').disabled).toBe(false);
  });
});
