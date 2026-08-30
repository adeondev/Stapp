import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Deixa acessivel na LAN. Atencao: pelo IP o navegador bloqueia o microfone
    // (contexto inseguro) — o texto funciona, a voz nao. Ver CLAUDE.md.
    host: true,
    port: 5173,
  },
  test: {
    setupFiles: ['./src/test-setup.ts'],
  },
})
