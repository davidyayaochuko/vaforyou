// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

/** Funke UI. Proxies /api to the Node control server when it is running. */
export default defineConfig({
  trailingSlash: 'ignore',
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:4310',
          changeOrigin: true,
        },
      },
    },
  },
});
