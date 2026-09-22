# LIVE Go / No-Go Checklist

A human operator must record evidence for every item before enabling LIVE:

- [ ] At least two weeks of testnet operation with representative fills and no unexplained incidents.
- [ ] Reconciliation is clean across orders, trades, balances, and positions.
- [ ] Native Spot OCO protection is verified against current Binance documentation and testnet.
- [ ] Capital is deliberately small and loss limits are reviewed.
- [ ] API key is trade-only, IP-restricted, and withdraw permission is disabled.
- [ ] Persistent kill switch has been manually tested, including exit-only behavior.
- [ ] Protection failure, unknown order, websocket loss, and reconciliation mismatch alerts were exercised.
- [ ] Database-backed CI and migration deployment completed successfully.

If any item lacks evidence, the decision is **NO-GO**.
