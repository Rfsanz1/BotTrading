import crypto from 'node:crypto';

export type LiveApproval = Readonly<{
  approvalId: string;
  operatorUserId: string;
  runtime: 'LIVE';
  accountId: string;
  mode: 'LIVE';
  approvedAt: number;
  expiresAt: number;
  riskConfigVersion: string;
}>;

const DEFAULT_TTL_MS = 15 * 60 * 1000;
let activeApproval: LiveApproval | undefined;

export function armLiveApproval(input: {
  operatorUserId: string;
  accountId: string;
  riskConfigVersion: string;
  ttlMs?: number;
  now?: number;
}): LiveApproval {
  if (process.env.TRADING_MODE !== 'LIVE' || process.env.LIVE_TRADING_ENABLED !== 'true') {
    throw new Error('LIVE approval requires explicit LIVE runtime enablement');
  }
  if (!input.operatorUserId || !input.accountId || !input.riskConfigVersion) {
    throw new Error('LIVE approval identity, account, and risk version are required');
  }
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > DEFAULT_TTL_MS) {
    throw new Error('LIVE approval TTL is invalid');
  }
  const approvedAt = input.now ?? Date.now();
  activeApproval = Object.freeze({
    approvalId: crypto.randomUUID(),
    operatorUserId: input.operatorUserId,
    runtime: 'LIVE',
    accountId: input.accountId,
    mode: 'LIVE',
    approvedAt,
    expiresAt: approvedAt + ttlMs,
    riskConfigVersion: input.riskConfigVersion,
  });
  return activeApproval;
}

export function revokeLiveApproval(): void {
  activeApproval = undefined;
}

export function getLiveApproval(): LiveApproval | undefined {
  return activeApproval;
}

export function assertLiveApproval(input: {
  accountId: string;
  riskConfigVersion: string;
  now?: number;
}): LiveApproval {
  const approval = activeApproval;
  const now = input.now ?? Date.now();
  if (!approval) throw new Error('LIVE operator approval is missing');
  if (approval.mode !== 'LIVE' || approval.runtime !== 'LIVE') throw new Error('LIVE approval runtime mismatch');
  if (approval.accountId !== input.accountId) throw new Error('LIVE approval account mismatch');
  if (approval.riskConfigVersion !== input.riskConfigVersion) throw new Error('LIVE approval risk version mismatch');
  if (now >= approval.expiresAt) {
    activeApproval = undefined;
    throw new Error('LIVE operator approval expired');
  }
  return approval;
}
