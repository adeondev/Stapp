import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Deixa acessivel na LAN. Atencao: pelo IP o navegador bloqueia o microfone
    // (contexto inseguro) — o texto funciona, a voz nao. Ver CLAUDE.md.
    host: true,
    port: 5173,
    watch: {
      // O build do Tauri escreve dentro de src-tauri/target enquanto roda; sem
      // ignorar, o watcher do Vite tenta ler a DLL no meio da escrita, toma
      // EBUSY e o dev server morre — derrubando o cliente de todo mundo.
      ignored: ['**/src-tauri/**'],
    },
  },
  test: {
    setupFiles: ['./src/test-setup.ts'],
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom')) {
              return 'react-vendor'
            }
            if (id.includes('livekit-client')) {
              return 'livekit-vendor'
            }
            if (id.includes('react-markdown') || id.includes('remark') || id.includes('rehype')) {
              return 'markdown-vendor'
            }
            if (id.includes('@emoji-mart')) {
              return 'emoji-vendor'
            }
          }
        },
      },
    },
  },
})
