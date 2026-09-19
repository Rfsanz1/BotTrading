export type ProtectionCapabilities = {
  nativeStopLossTakeProfit: boolean;
};

export function assertLiveEntryProtectionReady(
  mode: 'PAPER' | 'TESTNET' | 'LIVE',
  isExit: boolean,
  capabilities: ProtectionCapabilities,
): void {
  if (mode !== 'LIVE' || isExit) return;
  if (!capabilities.nativeStopLossTakeProfit) {
    throw new Error('LIVE entry blocked: exchange-native stop-loss/take-profit protection is unavailable');
  }
}
