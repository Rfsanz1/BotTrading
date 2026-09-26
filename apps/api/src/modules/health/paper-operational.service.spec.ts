import { PaperOperationalService } from './paper-operational.service';
import { SystemReadinessService } from '@rfsanz/exchange';

describe('PaperOperationalService', () => {
  const originalMode = process.env.TRADING_MODE;
  const originalLive = process.env.LIVE_TRADING_ENABLED;

  afterEach(() => {
    process.env.TRADING_MODE = originalMode;
    process.env.LIVE_TRADING_ENABLED = originalLive;
  });

  it('aborts startup when live trading is enabled in PAPER mode', async () => {
    process.env.TRADING_MODE = 'PAPER';
    process.env.LIVE_TRADING_ENABLED = 'true';
    const service = new PaperOperationalService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.validateStartup()).rejects.toThrow(/unsafe paper mode configuration/);
    expect(SystemReadinessService.getInstance().report().phase).toBe('HALTED');
  });
});
