const fs = require('fs');
const path = require('path');

const pnpmDir = path.resolve(__dirname, '../../node_modules/.pnpm');
const tsJestDir = fs.readdirSync(pnpmDir).find((name) => name.startsWith('ts-jest@'));
const tsJestModule = tsJestDir
  ? path.join(pnpmDir, tsJestDir, 'node_modules', 'ts-jest')
  : 'ts-jest';

module.exports = {
  rootDir: path.resolve(__dirname, '../..'),
  testEnvironment: 'node',
  testMatch: ['**/apps/api/src/**/*.spec.ts'],
  transform: {
    '^.+\\.(ts|tsx)$': [tsJestModule, { tsconfig: '<rootDir>/apps/api/tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
};
