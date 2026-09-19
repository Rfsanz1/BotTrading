import { assertLiveEntryProtectionReady } from '../services/live-protection-policy';

describe('LIVE protection policy', () => {
  it('blocks LIVE entries when native protection is unavailable', () => {
    expect(() => assertLiveEntryProtectionReady('LIVE', false, { nativeStopLossTakeProfit: false }))
      .toThrow(/LIVE entry blocked/);
  });

  it('allows exits and non-LIVE modes to use the shared path', () => {
    expect(() => assertLiveEntryProtectionReady('LIVE', true, { nativeStopLossTakeProfit: false })).not.toThrow();
    expect(() => assertLiveEntryProtectionReady('TESTNET', false, { nativeStopLossTakeProfit: false })).not.toThrow();
    expect(() => assertLiveEntryProtectionReady('LIVE', false, { nativeStopLossTakeProfit: true })).not.toThrow();
  });
});
