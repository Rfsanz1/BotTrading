import { Injectable, ForbiddenException, NotFoundException, Optional } from '@nestjs/common';
import prisma from '@rfsanz/database';
import { CredentialCryptoService } from '@rfsanz/exchange';

export type CredentialMode = 'PAPER' | 'TESTNET' | 'LIVE';
export type CredentialExchange = 'BINANCE';

export type ExchangeCredentialInput = {
  actorUserId: string;
  ownerUserId: string;
  exchangeAccountId: string;
  accountId: string;
  exchange: CredentialExchange;
  mode: CredentialMode;
  apiKey: string;
  apiSecret: string;
  permissions?: string[];
};

export type UpdateExchangeCredentialInput = {
  actorUserId: string;
  ownerUserId: string;
  credentialId: string;
  exchangeAccountId: string;
  accountId: string;
  exchange: CredentialExchange;
  mode: CredentialMode;
  permissions: string[];
};

export type RotateExchangeCredentialInput = ExchangeCredentialInput & {
  credentialId: string;
};

export type CredentialOperationResult = {
  credentialId: string;
  exchangeAccountId: string;
  accountId: string;
  exchange: CredentialExchange;
  mode: CredentialMode;
  active: boolean;
  revokedCredentialId?: string;
};

type CredentialDatabase = typeof prisma;

const EXCHANGES = new Set<CredentialExchange>(['BINANCE']);
const MODES = new Set<CredentialMode>(['PAPER', 'TESTNET', 'LIVE']);

@Injectable()
export class ExchangeCredentialService {
  constructor(
    @Optional()
    private readonly db: CredentialDatabase = prisma,
    @Optional()
    private readonly cryptoFactory: () => CredentialCryptoService = () => new CredentialCryptoService(),
  ) {}

  async createExchangeCredential(input: ExchangeCredentialInput): Promise<CredentialOperationResult> {
    const account = await this.validateRequest(input);
    const active = await this.db.apiKey.findFirst({
      where: { exchangeAccountId: account.id, revoked: false },
      select: { id: true },
    });
    if (active) {
      throw new Error('An active credential already exists for this exchange account; use rotation');
    }

    const encryptedSecret = this.encryptSecret(input.apiSecret);
    const permissions = this.normalizePermissions(input.permissions);
    return this.db.$transaction(async (tx) => {
      const credential = await tx.apiKey.create({
        data: {
          userId: account.userId,
          exchangeAccountId: account.id,
          keyHash: input.apiKey,
          keyEncrypted: this.encryptSecret(input.apiKey),
          secretEncrypted: encryptedSecret,
          permissions,
          revoked: false,
        },
      });
      await this.writeAudit(tx, input.actorUserId, 'EXCHANGE_CREDENTIAL_CREATED', credential.id, input);
      return this.result(credential.id, account, input.mode);
    });
  }

  async updateExchangeCredential(input: UpdateExchangeCredentialInput): Promise<CredentialOperationResult> {
    const account = await this.validateRequest(input);
    const credential = await this.getOwnedCredential(input.credentialId, input.ownerUserId);
    this.assertCredentialAccount(credential, account.id, input);
    if (credential.revoked) throw new Error('Revoked credentials cannot be updated');

    const permissions = this.normalizePermissions(input.permissions);
    return this.db.$transaction(async (tx) => {
      const updated = await tx.apiKey.update({
        where: { id: credential.id },
        data: { permissions },
      });
      await this.writeAudit(tx, input.actorUserId, 'EXCHANGE_CREDENTIAL_UPDATED', updated.id, input);
      return this.result(updated.id, account, input.mode);
    });
  }

  async rotateExchangeCredential(input: RotateExchangeCredentialInput): Promise<CredentialOperationResult> {
    const account = await this.validateRequest(input);
    const previous = await this.getOwnedCredential(input.credentialId, input.ownerUserId);
    this.assertCredentialAccount(previous, account.id, input);
    if (previous.revoked) throw new Error('Credential is already revoked');

    const encryptedSecret = this.encryptSecret(input.apiSecret);
    const permissions = this.normalizePermissions(input.permissions);
    return this.db.$transaction(async (tx) => {
      const replacement = await tx.apiKey.create({
        data: {
          userId: account.userId,
          exchangeAccountId: account.id,
          keyHash: input.apiKey,
          keyEncrypted: this.encryptSecret(input.apiKey),
          secretEncrypted: encryptedSecret,
          permissions,
          revoked: false,
        },
      });
      await tx.apiKey.update({
        where: { id: previous.id },
        data: { revoked: true },
      });
      await this.writeAudit(tx, input.actorUserId, 'EXCHANGE_CREDENTIAL_ROTATED', replacement.id, {
        ...input,
        previousCredentialId: previous.id,
      });
      return {
        ...this.result(replacement.id, account, input.mode),
        revokedCredentialId: previous.id,
      };
    });
  }

  private async validateRequest(input: {
    actorUserId: string;
    ownerUserId: string;
    exchangeAccountId: string;
    accountId: string;
    exchange: CredentialExchange;
    mode: CredentialMode;
    apiSecret?: string;
  }) {
    if (!input.actorUserId || !input.ownerUserId) throw new ForbiddenException('Credential ownership is required');
    if (!EXCHANGES.has(input.exchange)) throw new Error('Unsupported exchange');
    if (!MODES.has(input.mode)) throw new Error('Unsupported credential mode');
    if (!input.exchangeAccountId || !input.accountId) throw new Error('Exchange account identity is required');
    if (input.apiSecret !== undefined && !input.apiSecret) throw new Error('API secret cannot be empty');

    const actor = await this.db.user.findUnique({
      where: { id: input.actorUserId },
      select: { isActive: true, roles: { select: { role: { select: { name: true } } } } },
    });
    const isAdmin = actor?.roles.some(({ role }) => role.name === 'ADMIN') ?? false;
    if (!actor?.isActive || (input.actorUserId !== input.ownerUserId && !isAdmin)) {
      throw new ForbiddenException('Credential ownership is not authorized');
    }

    const account = await this.db.exchangeAccount.findUnique({
      where: { id: input.exchangeAccountId },
      select: { id: true, userId: true, exchange: true, accountId: true, isActive: true },
    });
    if (!account || !account.isActive) throw new NotFoundException('Exchange account not found');
    if (account.userId !== input.ownerUserId || account.accountId !== input.accountId) {
      throw new ForbiddenException('Exchange account ownership or identity mismatch');
    }
    if (account.exchange.toUpperCase() !== input.exchange) {
      throw new Error('Exchange account does not match credential exchange');
    }
    this.assertModeIdentity(account.accountId, input.mode);
    return account;
  }

  private async getOwnedCredential(credentialId: string, ownerUserId: string) {
    const credential = await this.db.apiKey.findUnique({
      where: { id: credentialId },
      select: {
        id: true,
        userId: true,
        exchangeAccountId: true,
        revoked: true,
      },
    });
    if (!credential) throw new NotFoundException('Exchange credential not found');
    if (credential.userId !== ownerUserId) throw new ForbiddenException('Credential ownership mismatch');
    return credential;
  }

  private assertCredentialAccount(
    credential: { exchangeAccountId: string | null },
    accountId: string,
    input: { exchange: CredentialExchange; mode: CredentialMode },
  ): void {
    if (credential.exchangeAccountId !== accountId) {
      throw new ForbiddenException('Credential is attached to a different exchange account');
    }
    if (!input.exchange || !input.mode) throw new Error('Credential exchange and mode are required');
  }

  private assertModeIdentity(accountId: string, mode: CredentialMode): void {
    const expectedPrefix = `${mode.toLowerCase()}-`;
    if (!accountId.toLowerCase().startsWith(expectedPrefix)) {
      throw new Error(`Exchange account identity is not explicitly scoped to ${mode}`);
    }
  }

  private encryptSecret(secret: string): string {
    if (!secret || secret.includes('\n') || secret.includes('\r')) {
      throw new Error('API secret is invalid');
    }
    return this.cryptoFactory().encrypt(secret);
  }

  private normalizePermissions(permissions?: string[]): string[] {
    const normalized = [...new Set((permissions ?? ['READ']).map((permission) => permission.trim().toUpperCase()))]
      .filter(Boolean);
    if (normalized.length === 0) throw new Error('At least one credential permission is required');
    return normalized;
  }

  private result(
    credentialId: string,
    account: { id: string; userId: string; accountId: string },
    mode: CredentialMode,
  ): CredentialOperationResult {
    return {
      credentialId,
      exchangeAccountId: account.id,
      accountId: account.accountId,
      exchange: 'BINANCE',
      mode,
      active: true,
    };
  }

  private async writeAudit(
    tx: any,
    actorUserId: string,
    action: string,
    credentialId: string,
    input: { ownerUserId: string; exchangeAccountId: string; accountId: string; exchange: string; mode: string; previousCredentialId?: string },
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action,
        resource: `ApiKey:${credentialId}`,
        meta: {
          ownerUserId: input.ownerUserId,
          exchangeAccountId: input.exchangeAccountId,
          accountId: input.accountId,
          exchange: input.exchange,
          mode: input.mode,
          ...(input.previousCredentialId ? { previousCredentialId: input.previousCredentialId } : {}),
        },
      },
    });
  }
}
