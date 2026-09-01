# LiveKit local do Stapp

Servidor SFU WebRTC LiveKit `v1.13.6` para chamadas de voz e transmissões de tela com múltiplos participantes sem sobrecarga de CPU/rede P2P. Compatível com redes locais (LAN), Tailscale, Radmin VPN, WireGuard ou IP público.

> **Dica:** Para rodar a stack completa (Stapp Server + Web SPA + LiveKit) com um único comando, use o `docker compose up -d` na raiz do projeto.

### Inicialização Isolada do LiveKit:

1. Copie `.env.example` para `.env` e configure o IP do host (`STAPP_HOST_IP`), chave e segredo.
2. Certifique-se de que as portas necessárias estão liberadas no Firewall da sua rede/máquina:
   - **TCP 7880** (Sinalização WebSocket / API)
   - **TCP 7881** (ICE TCP fallback)
   - **UDP 7882** (Tráfego de mídia WebRTC)
3. Execute o script de inicialização:

   **No Windows (PowerShell):**
   ```powershell
   .\Start-LiveKit.ps1 -Mode Docker -StartStapp
   # ou nativo:
   .\Start-LiveKit.ps1 -Mode Native -StartStapp
   ```

   **No Linux / macOS (Bash):**
   ```bash
   ./start-livekit.sh
   ```

O modo Docker utiliza a imagem oficial `livekit/livekit-server:v1.13.6`. O modo nativo baixa o release oficial e valida a soma criptográfica SHA-256. Em navegadores remotos sobre HTTP não seguro, lembre-se de usar o aplicativo Desktop (Tauri) ou configurar HTTPS (ex.: perfil Caddy na raiz).
