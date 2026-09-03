/// <reference types="vitest/config" />
import { readFileSync } from 'fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  base: '/night-stack/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'NightStack',
        short_name: 'NightStack',
        description: 'Sleep optimization tracker',
        theme_color: '#1a1a2e',
        background_color: '#0f0f1a',
        display: 'standalone',
        display_override: ['standalone'],
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        // Home-screen long-press shortcut straight into the 4am episode
        // flow (home-experiments app-shell.md). Relative URL per
        // docs/pwa-best-practices.md so it stays inside the scope.
        shortcuts: [
          {
            name: 'Episode now',
            short_name: 'Episode',
            description: 'Record a 4am wake-up episode in one tap',
            url: './experiments/episode',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
        navigateFallback: 'index.html',
        navigateFallbackAllowlist: [/^(?!\/__).*/],
      },
    }),
  ],
});
