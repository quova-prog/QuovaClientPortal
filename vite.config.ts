import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  base: '/ClientPortal/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
      'schema-discovery': path.resolve(__dirname, '../packages/schema-discovery'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          charts: ['recharts'],
        },
      },
    },
  },
  server: {
    port: 5175,
    strictPort: true,
    headers: {
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'X-XSS-Protection': '1; mode=block',
    },
  },
})
