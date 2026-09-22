import prisma from '@rfsanz/database';

export async function getKillSwitch(): Promise<{ active: boolean; reason: string | null }> {
  const state = await prisma.killSwitchState.findUnique({ where: { id: 'global' } });
  return { active: state?.active ?? true, reason: state?.reason ?? 'Kill switch state unavailable' };
}

export async function setKillSwitch(active: boolean, reason: string, updatedBy?: string): Promise<void> {
  await prisma.killSwitchState.upsert({
    where: { id: 'global' },
    create: { id: 'global', active, reason, updatedBy },
    update: { active, reason, updatedBy },
  });
}
