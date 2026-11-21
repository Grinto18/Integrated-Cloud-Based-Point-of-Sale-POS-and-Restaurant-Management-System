import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    globals: false,
    isolate: true,
    include: ['src/__tests__/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
    ...(process.platform === 'win32' ? { maxWorkers: 2 } : {}),
  },
});
