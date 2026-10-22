// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Read API_TOKEN from the repo-root .env so the Vite proxy can auth to :4310. */
function readApiToken() {
  try {
    const raw = fs.readFileSync(path.join(rootDir, '.env'), 'utf8');
    const line = raw.split('\n').find((l) => /^\s*API_TOKEN\s*=/.test(l));
    if (!line) return '';
    return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  } catch {
    return '';
  }
}

const apiToken = readApiToken();

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
          configure(proxy) {
            if (!apiToken) return;
            proxy.on('proxyReq', (proxyReq) => {
              if (!proxyReq.getHeader('authorization')) {
                proxyReq.setHeader('Authorization', `Bearer ${apiToken}`);
              }
            });
          },
        },
      },
    },
  },
});
