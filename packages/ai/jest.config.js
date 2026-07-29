/** @type {import('jest').Config} */
module.exports = {
  displayName: '@rfsanz/ai',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.spec.ts'],
  moduleNameMapper: {
    '^@rfsanz/logger$':   '<rootDir>/../logger/src/index.ts',
    '^@rfsanz/database$': '<rootDir>/../database/src/index.ts',
  },
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.jest.json',
    },
  },
  collectCoverageFrom: [
    'src/core/**/*.ts',
    'src/router/**/*.ts',
    'src/utils/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/index.ts',
  ],
};
