export function redactCredentialText(
  value: string,
  secrets: string[] = [],
): string {
  let redacted = value;
  for (const secret of secrets.filter(Boolean)) {
    redacted = redacted.split(secret).join('[REDACTED]');
  }
  return redacted
    .replace(/([?&](?:signature|apiKey|secret|apiSecret)=)[^&\s]*/gi, '$1[REDACTED]')
    .replace(/(x-mbx-apikey["']?\s*[:=]\s*)[^,\s}]+/gi, '$1[REDACTED]');
}
