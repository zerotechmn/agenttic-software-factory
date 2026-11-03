import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
const target = process.env.FORGE_URL ?? 'http://127.0.0.1:4300'
export default defineConfig({
  base: '/world/', plugins: [react()],
  server: { proxy: Object.fromEntries(['/state', '/events', '/api', '/docs', '/doc', '/task', '/say'].map(path => [path, { target: target }])) },
})
