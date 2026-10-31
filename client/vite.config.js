import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

// The server only accepts writes whose Origin is http://localhost:3000
// (server/middleware/authSecurity.js). The browser sends this dev server's own origin,
// so the proxy swaps it for the one the server trusts. Development only.
const TRUSTED_ORIGIN = 'http://localhost:3000';

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        strictPort: true,
        proxy: {
            '/api': {
                target: BACKEND_URL,
                configure: (proxy) => {
                    proxy.on('proxyReq', (proxyReq) => {
                        proxyReq.setHeader('Origin', TRUSTED_ORIGIN);
                    });
                }
            }
        }
    }
});
