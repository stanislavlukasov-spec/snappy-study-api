module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js'],
  testMatch: ['**/__tests__/**/*.test.[jt]s'],
  // Transform TypeScript via babel-jest
  transform: {
    '^.+\\.tsx?$': 'babel-jest',
  },
  // Redirect the env module so it never tries to read real env vars at import time
  moduleNameMapper: {
    '^../config/env$': '<rootDir>/__tests__/__mocks__/env.js',
    '^../../config/env$': '<rootDir>/__tests__/__mocks__/env.js',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/localServer.ts',
  ],
};
