import { Prisma } from '@prisma/client';

function convert(value: unknown, seen: WeakSet<object>): Prisma.InputJsonValue | null {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('JSON payload contains a non-finite number');
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new Error(`JSON payload contains unsupported value type: ${typeof value}`);
  }
  if (seen.has(value)) throw new Error('JSON payload contains a circular reference');
  seen.add(value);

  if ('toJSON' in value && typeof value.toJSON === 'function') {
    const converted = convert(value.toJSON(), seen);
    seen.delete(value);
    if (converted === null) throw new Error('JSON payload cannot be top-level null');
    return converted;
  }

  if (Array.isArray(value)) {
    const array = value.map((item) => convert(item, seen));
    seen.delete(value);
    return array as Prisma.InputJsonArray;
  }

  const object: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, item] of Object.entries(value)) {
    object[key] = convert(item, seen);
  }
  seen.delete(value);
  return object as Prisma.InputJsonObject;
}

export function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  const converted = convert(value, new WeakSet<object>());
  if (converted === null) throw new Error('JSON payload cannot be top-level null');
  return converted;
}
