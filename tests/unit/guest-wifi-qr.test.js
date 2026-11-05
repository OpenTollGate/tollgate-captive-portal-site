import { describe, it, expect } from 'vitest';
import { guestWifiPayload } from '../../admin/src/lib/guest-wifi-qr';
const guest = { '.type': 'wifi-iface', mode: 'ap', network: 'lan', ssid: 'Cafe', encryption: 'none' };
describe('guest Wi-Fi QR', () => {
  it('encodes open without even reading a stray key', () => {
    expect(guestWifiPayload('tollgate_2g_open', {...guest, key: 'SECRET'})).toBe('WIFI:T:nopass;S:Cafe;H:false;;');
  });
  it('escapes each reserved character and preserves Unicode', () => {
    expect(guestWifiPayload('tollgate_5g_open', {...guest, ssid: 'Café;,:"\\', encryption: 'psk2+ccmp', key: 'a;,:"\\bc', hidden: '1'})).toBe('WIFI:T:WPA;S:Café\\;\\,\\:\\"\\\\;P:a\\;\\,\\:\\"\\\\bc;H:true;;');
  });
  it.each(['private_radio0','default_radio0','upstream','tollgate_2g_open_extra'])('rejects non-canonical guest section %s', section => {
    expect(() => guestWifiPayload(section, guest)).toThrow();
  });
  it.each([{mode:'sta'}, {network:'private'}, {network:['lan','private']}, {network:''}, {'.type':'wifi-device'}, {ssid:''}, {ssid:'é'.repeat(17)}, {disabled:'1'}, {encryption:'sae'}, {encryption:'wep'}, {encryption:'wpa2'}, {encryption:'psk2',key:''}, {encryption:'psk2',key:'short'}, {hidden:'invalid'}])('fails closed for invalid configuration %j', patch => {
    expect(() => guestWifiPayload('tollgate_2g_open', {...guest,...patch})).toThrow();
  });
  it.each([true, 1, 'yes', 'true', '2', [['1']], 2, null])('rejects disabled or ambiguous disabled flag %j', disabled => {
    expect(() => guestWifiPayload('tollgate_2g_open', { ...guest, disabled })).toThrow();
  });
  it.each([{network:'lan guest'}, {network:['lan','guest']}, {network:['lan','lan']}])('rejects ambiguous attachment %j', patch => { expect(() => guestWifiPayload('tollgate_2g_open', {...guest, ...patch})).toThrow(); });
  it.each(['psk','psk2','psk-mixed','psk2+ccmp'])('supports personal encryption %s', encryption => {
    expect(guestWifiPayload('tollgate_2g_open', {...guest,encryption,key:'password',hidden:true})).toBe('WIFI:T:WPA;S:Cafe;P:password;H:true;;');
  });
});
