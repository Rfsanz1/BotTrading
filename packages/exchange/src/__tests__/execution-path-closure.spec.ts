import fs from 'node:fs';
import path from 'node:path';

describe('canonical execution path closure', () => {
  it('keeps adapter transport calls inside OrderService', () => {
    const sourceRoot = path.resolve(__dirname, '..');
    const files: string[] = [];
    const visit = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(fullPath);
        else if (entry.name.endsWith('.ts')) files.push(fullPath);
      }
    };
    visit(sourceRoot);

    const offenders = files
      .filter((file) => !file.includes(`${path.sep}__tests__${path.sep}`))
      .filter((file) => !file.endsWith(`${path.sep}services${path.sep}order.service.ts`))
      .filter((file) => !file.includes(`${path.sep}adapters${path.sep}`))
      .filter((file) => !file.endsWith('IExchange.ts') && !file.endsWith('ExchangeBase.ts'))
      .filter((file) => /\.(placeOrder|cancelOrder)\s*\(/.test(fs.readFileSync(file, 'utf8')));

    expect(offenders).toEqual([]);
  });
});
