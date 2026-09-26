# REPORT.md

Tanggal laporan: 2026-09-23

Status ringkas: repo saat ini bersifat PARTIAL / BLOCKED untuk sistem live. Tidak ada order real Binance yang dikirim. LIVE tetap dinonaktifkan dan belum diklaim siap.

## Ringkasan eksekusi validasi

- Build API: DONE (`pnpm --dir apps/api run build`)
  - Hasil: berhasil.
- Typecheck seluruh repo: BLOCKED / FAIL (`pnpm run typecheck`)
  - Hasil: gagal di `packages/ai` karena error TS yang sudah ada (misalnya `src/index.ts` duplicate export, `src/orchestrator/*` undefined symbols, `@prisma/client` not found, dll.).
- DB-backed integration test: BLOCKED (`pnpm --dir apps/api run test:integration`)
  - Hasil: gagal karena database tidak dapat dijangkau: `Can't reach database server at 127.0.0.1:5432`.
- Ketersediaan PostgreSQL di Docker: DONE (`docker exec bottrading-postgres-1 psql -U bottrading -d bottrading -c 'SELECT 1;'`)
  - Hasil: berhasil (`?column?` = `1`).
- Live safety: DONE (fail-closed)
  - Bukti: `docker-compose.yml:15-16`, `apps/api/.env.paper.example:1-5`, `packages/exchange/src/services/live-protection-policy.ts:1-15` menegaskan `LIVE_TRADING_ENABLED=false`, `TRADING_MODE=PAPER`, dan `assertLiveEntryProtectionReady()` memblokir live entry jika native protection tidak valid.

## A. Proteksi SL/TP native
Status: BLOCKED

Bukti:
- `packages/exchange/src/adapters/binance.adapter.ts:19-30` — `nativeProtectionVerified = process.env.BINANCE_OCO_ENDPOINT_VERIFIED === 'true'`.
- `packages/exchange/src/adapters/binance.adapter.ts:783-855` — `createProtectionOco()` memeriksa `!this.nativeProtectionVerified` dan melempar `Binance OCO endpoint is UNVERIFIED; native protection is blocked`.
- `apps/api/src/modules/trading/trading.service.ts:559-760` — gate entry protection memakai `assertLiveEntryProtectionReady()`, tetapi OCO semantics di Binance belum dinyatakan diverifikasi secara eksternal.

Risiko sisa:
- Native OCO Binance Spot tidak dapat dipastikan valid secara resmi di environment saat ini; implementasi fail-closed dengan intent to block live entry.
- Belum ada verifikasi end-to-end terhadap `POST /api/v3/orderList/oco` di testnet/real account.

## B. Spot = long-only
Status: PARTIAL

Bukti:
- `apps/api/src/modules/trading/trading.service.ts:386-392` — validasi `SELL` entry memerlukan posisi long terkait dan intent exit/close.
- `apps/api/src/integration/db-backed-proof.spec.ts` — test DB-backed tidak bisa dijalankan di sini karena DB tidak reachable.

Risiko sisa:
- Penguatan long-only sudah ada di kode, tetapi coverage DB-backed tidak dapat dijalankan dalam environment saat ini.

## C. Risk engine & kill switch
Status: PARTIAL

Bukti:
- `apps/api/src/modules/trading/trading.service.ts:624-759` — risk checks (balance, order value, daily loss, position size, concurrent positions, market quality, riskEngine.evaluate) ada dan memblokir unsafe order.
- `apps/api/src/modules/trading/trading.service.ts:980-1020` — catch block aktifkan kill switch bila ada kegagalan protection/protection-labeled error.
- `packages/exchange/src/services/live-protection-policy.ts:1-15` — live readiness gate.

Risiko sisa:
- `portfolioHeat`, `symbolExposure`, `correlatedExposure` dan `unrealizedPnL` masih belum dibuktikan via DB-backed test karena Postgres blocked. Tidak ada klaim server-side risk reconstruction yang diverifikasi penuh.

## D. Pipeline sinyal → order
Status: PARTIAL

Bukti:
- `apps/api/src/modules/trading/trading.service.ts:386-392` dan `:500-760` menunjukkan order creation dan submission fail-closed.
- `packages/exchange/src/adapters/binance.adapter.ts:35-49` — endpoint mode jelas `TESTNET`/`LIVE`.
- `docker-compose.yml:15-16` — live disabled.

Risiko sisa:
- Real AI provider wiring dan approved recommendation listener belum dibuktikan dengan end-to-end test yang valid di environment saat ini.

## E. Onboarding kredensial LIVE (kode saja, jangan dijalankan)
Status: PARTIAL

Bukti:
- `apps/api/src/modules/credentials/live-operator-cli-entry.ts` ada di repo.
- `packages/exchange/src/adapters/binance.adapter.ts:517-562` — `fetchApiRestrictions()` memeriksa endpoint yang dikunci oleh `BINANCE_API_RESTRICTIONS_ENDPOINT_VERIFIED`.

Risiko sisa:
- Kode ada, namun onboarding live tidak dapat diverifikasi karena environment tidak punya akses testnet/live yang valid dan axis of approval masih diblokir karena aturan fail-closed.

## F. Deployment
Status: PARTIAL

Bukti:
- `docker-compose.prod.yml` berisi `DATABASE_URL: ${DATABASE_URL:?required}`, `TRADING_MODE: ${TRADING_MODE:?required}`, `LIVE_TRADING_ENABLED: ${LIVE_TRADING_ENABLED:?required}`.
- `apps/api/package.json:6-19` menunjukkan `credentials:live:create` dan DB migrate scripts.

Risiko sisa:
- Belum ada verifikasi deployment full end-to-end di lingkungan ini; migration one-shot belum dijalankan terhadap DB aktif.

## G. CI
Status: BLOCKED

Bukti:
- `pnpm run typecheck` gagal di `packages/ai`.
- `pnpm --dir apps/api run test:integration` gagal karena DB unreachable.

Risiko sisa:
- CI tidak dapat dianggap hijau sampai typecheck paket AI diperbaiki dan DB-backed tests dapat dijalankan/terhubung ke Postgres yang benar.

## H. Monitoring & kendali operator
Status: PARTIAL

Bukti:
- `apps/api/src/modules/trading/trading.service.ts:1000-1045` menangani error kill switch/protection; log failure existence ada.
- Repo mengandung modul/komponen operator/notification, tetapi belum dibuktikan via end-to-end operator flow di lingkungan ini.

Risiko sisa:
- Status operator/notification belum diverifikasi dengan koneksi Redis/Postgres aktif.

## I. Test & fixture
Status: BLOCKED

Bukti:
- `scripts/src/testnet-order-fixture.ts` ada, tetapi tidak dijalankan karena ketiadaan kredensial/DB environment yang valid.
- `apps/api/src/integration/db-backed-proof.spec.ts` gagal memulai karena `Can't reach database server at 127.0.0.1:5432`.

Risiko sisa:
- Fixture end-to-end (entry -> OCO -> fill -> close -> reconciliation) belum terbukti di sini.

## J. Kebersihan repo
Status: PARTIAL

Bukti:
- File `.gitignore`, `STATUS.md`, `LIVE-GO-NO-GO.md`, `FINAL_READINESS_REPORT.md`, dan `REPORT.md` ada untuk menjaga status jujur.
- `PRODUCTION-READINESS.md` dan laporan lama masih ada, tetapi status repo sekarang diturunkan ke honest partial/blocked.

Risiko sisa:
- Masih ada artefak legacy dan package `packages/ai` dengan error TS broad, sehingga repo belum bersih sepenuhnya secara build-approval.

## Hasil akhir typecheck/build/test

- Build API: PASS
  - Perintah: `cd /srv/gentongmas/apps/BotTrading && pnpm --dir apps/api run build`
  - Output: `tsc -p tsconfig.json` sukses.
- Typecheck root: FAIL
  - Perintah: `cd /srv/gentongmas/apps/BotTrading && pnpm run typecheck`
  - Output: gagal pada `packages/ai` dengan banyak TS7006/TS2308/TS2322/TS2739; contoh: `src/index.ts` duplicate exports, `src/orchestrator/*` missing symbols, `@prisma/client` cannot be found.
- DB-backed test: FAIL/BLOCKED
  - Perintah: `cd /srv/gentongmas/apps/BotTrading && pnpm --dir apps/api run test:integration`
  - Output: `Can't reach database server at 127.0.0.1:5432`.
- Postgres health: PASS (container-only)
  - Perintah: `docker exec bottrading-postgres-1 psql -U bottrading -d bottrading -c 'SELECT 1;'`
  - Output: `1`.

## Kesimpulan

LIVE tetap dinonaktifkan dan belum diklaim siap. Seluruh perubahan yang ada tetap bersifat fail-closed dan hati-hati; status repo saat ini adalah PARTIAL/BLOCKED, bukan PAPER READY atau LIVE READY.
