import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import packageInfo from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [react(), {
    name: 'release-metadata',
    transformIndexHtml() {
      return [
        { tag: 'meta', attrs: { name: 'build-time', content: new Date().toISOString() }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'app-version', content: packageInfo.version }, injectTo: 'head' },
      ]
    },
  }],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/v1': 'http://127.0.0.1:8080',
      '/health': 'http://127.0.0.1:8080',
    },
  },
  build: {
    chunkSizeWarningLimit: 700,
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    restoreMocks: true,
  },
})
