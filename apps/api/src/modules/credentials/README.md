# Exchange credential lifecycle

`ExchangeCredentialService` is the canonical application-layer path for
creating, updating, and rotating exchange API credentials. It is intentionally
service-only: this repository has no dedicated authenticated credential
settings/admin boundary, so no unauthenticated credential endpoint is exposed.

Every operation requires:

- an authenticated actor and explicit owner user ID;
- an explicit `ExchangeAccount` ID and external account ID;
- an explicit `BINANCE` exchange and `PAPER`, `TESTNET`, or `LIVE` mode;
- a mode-scoped account identity (`paper-*`, `testnet-*`, or `live-*`);
- plaintext credentials only at the controlled service boundary.

Secrets are encrypted with `CredentialCryptoService` before persistence,
plaintext values are never returned or written to audit metadata, and audit
records contain only non-secret identity and operation fields. Creation rejects
an existing active credential. Rotation creates a replacement and revokes the
previous credential in one transaction; it does not delete the old row or
attempt to decrypt it.

Operators preparing a controlled TESTNET rotation must call
`createExchangeCredential()` or `rotateExchangeCredential()` with
`mode: 'TESTNET'`, the exact TESTNET account identity, fresh dedicated TESTNET
credentials, and the currently configured
`EXCHANGE_CREDENTIAL_ENCRYPTION_KEY`. This operation does not submit exchange
orders. Do not use direct Prisma credential writes.

## Local operator CLI

The root command is:

```bash
pnpm credentials:testnet:create
```

Before starting it, inject the existing approved key only into the process
environment. Do not put it in command arguments, source code, or Git:

```bash
export EXCHANGE_CREDENTIAL_ENCRYPTION_KEY='<64-hex-character-value-or-base64-32-byte-value>'
pnpm credentials:testnet:create
unset EXCHANGE_CREDENTIAL_ENCRYPTION_KEY
```

The command builds the API and then runs the compiled operator entrypoint; it
does not execute an exchange request or submit an order.

The CLI requires an interactive terminal. It prompts for actor ID, owner/user
ID, exact exchange-account ID, external `testnet-*` account ID, and (when an
active credential exists) the exact credential ID. The fresh Binance TESTNET
API key and secret are entered with non-echoed terminal input. It always uses
`BINANCE` and `TESTNET`, rejects `live-*` identities, and selects create versus
rotation from the active credential state. The success output contains only
non-secret record identifiers and status.

After an approved operation, verify without revealing secrets:

```bash
pnpm doctor:db
pnpm doctor:redis
pnpm testnet:preflight
```

Do not use the CLI for LIVE credentials and do not submit an exchange order as
part of credential verification.

## Canonical TESTNET account

TESTNET runtime, preflight, lifecycle reconciliation, order execution, and
credential resolution use the same database `ExchangeAccount`. Supply its
database row ID through `TESTNET_EXCHANGE_ACCOUNT_ID`; the value must identify
one active Binance TESTNET account with exactly one active credential. The
runtime does not select the first account and does not use `startup-account`.

The API process and the preflight process must receive the same
`TESTNET_EXCHANGE_ACCOUNT_ID`. The preflight also resolves the encrypted
credential from that row using `EXCHANGE_CREDENTIAL_ENCRYPTION_KEY`; it does not
use the legacy `BINANCE_API_KEY` or `BINANCE_API_SECRET` variables.
