export type JwtConfig = {
  accessSecret: string;
  refreshSecret: string;
  issuer: string;
  audience: string;
};

function requiredString(name: string): string {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid environment: ${name} must be a non-empty string`);
  }
  return value;
}

export function getJwtConfig(): JwtConfig {
  return {
    accessSecret: requiredString('JWT_ACCESS_SECRET'),
    refreshSecret: requiredString('JWT_REFRESH_SECRET'),
    issuer: requiredString('JWT_ISSUER'),
    audience: requiredString('JWT_AUDIENCE'),
  };
}
