# Binance Symbol Universe

## Source and flow

The production Spot universe is discovered from Binance public `GET /api/v3/exchangeInfo` through the existing `BinanceMarketClient`:

`exchangeInfo -> normalizeSymbol -> eligibility filter -> SymbolRegistryService -> canonical scanner`

No production symbol list is hardcoded.

## Spot eligibility

An exchangeInfo symbol is registered only when:

- `status === TRADING`
- `quoteAsset === USDT`
- `isSpotTradingAllowed === true`
- `filters` is present and parseable as an array
- the symbol passes the shared slash/dash/case normalization

Duplicates such as `BTC/USDT`, `BTCUSDT`, and `btcusdt` resolve to one `BTCUSDT` entry. Spot and Futures entries carry separate `marketType` metadata and are not mixed.

## Refresh policy

The registry performs an initial refresh during module startup, then refreshes periodically through the scheduler. The interval is `BINANCE_SYMBOL_REFRESH_MS`, defaulting to five minutes. Concurrent refresh attempts are coalesced.

## Failure behavior

Refreshes build a complete desired map before replacing the Spot portion of the registry. A failed refresh never clears the last-known-good registry. With a previous successful load, health is `DEGRADED` and scanning continues from that registry. Without a successful load, health is `INVALID` and the scanner safely does not run.

## Scanner relationship

The registry defines the market universe; it does not reject symbols for liquidity or opportunity. The scanner reports symbols seen, symbols eligible, rejection reasons, and candidates. A zero-candidate result is valid only after a non-empty universe has been evaluated.
