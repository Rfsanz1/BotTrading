import bcrypt from 'bcryptjs';

type User = {
  id: string;
  email: string;
  passwordHash?: string;
  name?: string;
  roles?: string[];
  telegramId?: string | null;
  isActive?: boolean;
};

const users = new Map<string, User>();
const byEmail = new Map<string, string>();
let idCounter = 1;

export async function createUser(email: string, password?: string, name?: string) {
  const id = String(idCounter++);
  const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;
  const u: User = { id, email, passwordHash, name, roles: ['user'], telegramId: null, isActive: true };
  users.set(id, u);
  byEmail.set(email, id);
  return u;
}

export function findUserByEmail(email: string) {
  const id = byEmail.get(email);
  if (!id) return null;
  return users.get(id) ?? null;
}

export function findUserById(id: string) {
  return users.get(id) ?? null;
}

export async function verifyPassword(user: User, password: string) {
  if (!user.passwordHash) return false;
  return bcrypt.compare(password, user.passwordHash);
}

export function linkTelegram(userId: string, telegramId: string) {
  const u = users.get(userId);
  if (!u) return false;
  u.telegramId = telegramId;
  return true;
}

export function findByTelegramId(tid: string) {
  for (const u of users.values()) {
    if (u.telegramId === tid) return u;
  }
  return null;
}

export function listUsers() {
  return Array.from(users.values());
}

export function updateUserRoles(userId: string, roles: string[]) {
  const u = users.get(userId);
  if (!u) return false;
  u.roles = roles;
  return true;
}

export function setUserActive(userId: string, active: boolean) {
  const u = users.get(userId);
  if (!u) return false;
  u.isActive = active;
  return true;
}
