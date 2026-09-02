# Stapp

Um Discord só nosso. Servidor auto-hospedado + aplicação web e desktop — no espírito de um
servidor de Minecraft: alguém sobe o servidor, o resto entra.

O Stapp oferece **canais, mensagens diretas, amizades, privacidade, bloqueio, chamadas de voz, vídeo e transmissão de tela**
com contas locais por servidor. Cada host controla seus próprios usuários; não existe conta
Stapp global nem um serviço central recebendo credenciais.

---

## Início Rápido com Docker (Recomendado)

O projeto possui orquestração completa com Docker Compose, subindo o servidor Stapp (API + SPA Web integrado) e o servidor de voz LiveKit com um único comando:

```bash
# 1. Clone o repositório
git clone https://github.com/adeondev/Stapp.git
cd Stapp

# 2. Configure as variáveis de ambiente
cp .env.example .env

# (Opcional) Edite o .env para definir STAPP_HOST_IP com o IP da sua LAN/Tailscale/VPN

# 3. Inicie todos os serviços
docker compose up -d
```

Acesse **`http://localhost:8787`** (ou no IP configurado). O frontend web já vem compilado e servido diretamente pelo backend!

### HTTPS Automático com Caddy (Microfone liberado em qualquer navegador)

Navegadores bloqueiam microfone e câmera em conexões HTTP remotas. Para liberar o microfone automaticamente com certificado TLS válido:

```bash
# No .env, defina seu domínio e ative o perfil Caddy:
# STAPP_DOMAIN=stapp.meudominio.com
# STAPP_VOICE_PUBLIC_URL=wss://stapp.meudominio.com

docker compose --profile caddy up -d
```

---

## Criando Contas e Administração (CLI)

Por padrão, o registro público pode ser liberado no `.env` (`STAPP_ALLOW_REGISTRATION=true`) ou administrado manualmente pelo host:

```bash
# Via Docker:
docker compose exec stapp-server /usr/local/bin/stapp-server user add daniel
docker compose exec stapp-server /usr/local/bin/stapp-server user list
docker compose exec stapp-server /usr/local/bin/stapp-server user passwd daniel

# Via Cargo local:
cd server
cargo run -- user add daniel
cargo run -- user list
cargo run -- user passwd daniel
cargo run -- user disable daniel
cargo run -- user enable daniel
```

---

## Desenvolvimento Local (Sem Docker)

### Requisitos
- [Rust](https://rustup.rs) (edição 2021+)
- [Node.js](https://nodejs.org) 20+ e [pnpm](https://pnpm.io)

### 1. Subindo o backend
```bash
cd server
cargo run
```
Sobe em `http://localhost:8787`. Configurações em [`server/stapp.toml`](server/stapp.toml) ou via variáveis de ambiente com prefixo `STAPP_`.

### 2. Subindo o frontend (Vite Dev Server)
```bash
cd web
pnpm install
pnpm dev
```
Abre em `http://localhost:5173`.

### 3. Subindo o App Desktop (Tauri)
```bash
cd web
pnpm app          # Roda o app nativo Tauri apontando para o dev server
pnpm app:build    # Gera o instalador standalone
```

> **Dica sobre o Microfone:** Acessar o cliente via navegador web remoto em HTTP simples bloqueia o microfone por restrição de segurança dos navegadores. O **App Desktop (Tauri)** roda em contexto seguro (`tauri://`) e funciona nativamente com voz/vídeo em qualquer IP de rede local ou VPN sem precisar de HTTPS.

---

## Arquitetura

```
├── compose.yaml          # Orquestração Docker do stapp-server, livekit e caddy
├── server/               # Backend em Rust (Axum + Tokio + SQLite bundled)
│   ├── Dockerfile        # Build multi-stage (Node SPA + Rust Release + Debian Runtime)
│   ├── src/              # Auth HTTP, WebSocket, presença, chat, chamadas e SQLite
│   └── stapp.toml        # Arquivo de configuração padrão do servidor
├── web/                  # Frontend Vite + React + TypeScript
│   ├── src/              # UI flat sem sombras, cliente de voz e gerência de estado
│   └── src-tauri/        # Casca desktop nativa (Windows, Linux, macOS)
└── infra/
    ├── caddy/            # Configuração de proxy reverso e terminação TLS
    └── livekit/          # Configurações e scripts para o SFU de voz e vídeo WebRTC
```

---

## Licença

MIT
