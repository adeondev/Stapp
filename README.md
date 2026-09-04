# Stapp

Um Discord só nosso. Servidor auto-hospedado + aplicação web e desktop — no espírito de um
servidor de Minecraft: alguém sobe o servidor, o resto entra.

O Stapp oferece **canais, mensagens diretas, amizades, privacidade, bloqueio, chamadas de voz, vídeo e transmissão de tela**
com contas locais por servidor. Cada host controla seus próprios usuários; não existe conta
Stapp global nem um serviço central recebendo credenciais.

---

## Executando como Servidor Portátil (Estilo Minecraft)

O Stapp é distribuído como um **executável único e autossuficiente** para Windows e Linux. Não requer Node.js, bancos de dados externos nem ferramentas de compilação:

1. Baixe o pacote pré-compilado da sua plataforma na aba [Releases](https://github.com/adeondev/Stapp/releases) (`.zip` para Windows ou `.tar.gz` para Linux).
2. Extraia o conteúdo e execute o binário:
   ```bash
   # Linux / macOS
   ./stapp-server

   # Windows (PowerShell)
   .\stapp-server.exe
   ```
3. **Bootstrapping Automático:** na primeira inicialização, o Stapp gera sozinho o arquivo de configuração comentado [`stapp.toml`](server/stapp.toml), a pasta de dados `data/`, inicializa o banco SQLite via SQLx e serve o cliente web moderno já embutido no executável em **`http://localhost:8787`**.

### TLS e HTTPS Automático (Sem Proxy Reverso)
O executável possui suporte nativo a certificados TLS via Let's Encrypt (ACME TLS-ALPN-01) e certificados manuais (`.pem`), dispensando proxies externos como Nginx ou Caddy:
- Edite o bloco `[tls]` no `stapp.toml` gerado:
  ```toml
  [tls]
  enabled = true
  port = 443
  domains = ["chat.meudominio.com"]
  email = "admin@meudominio.com"
  production = true
  http_redirect_port = 80 # Redireciona http:// automaticamente para https://
  ```
- Ou defina as variáveis de ambiente: `STAPP_TLS_ENABLED=true`, `STAPP_TLS_DOMAINS=chat.meudominio.com`, `STAPP_TLS_HTTP_REDIRECT_PORT=80`.

---

## Executando com Docker

### Imagem de Contêiner Pronta (GHCR)
Você pode executar o contêiner oficial do Stapp publicado no GitHub Container Registry:

```bash
docker run -d \
  --name stapp-server \
  -p 8787:8787 \
  -v ./data:/app/data \
  ghcr.io/adeondev/stapp:latest
```

### Orquestração Completa com LiveKit (Docker Compose)
Para ambientes com suporte a chamadas de voz e vídeo em larga escala via SFU LiveKit:

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

Acesse **`http://localhost:8787`** (ou no IP configurado). O frontend web já vem compilado e servido diretamente pelo binário!

#### HTTPS Automático com Caddy (Opcional)
Caso queira utilizar o Caddy como proxy reverso com LiveKit:
```bash
docker compose --profile caddy up -d
```

---

## Criando Contas e Administração (CLI)

O executável do Stapp conta com comandos integrados para gestão de usuários:

```bash
# Executável Standalone:
./stapp-server user add daniel
./stapp-server user list
./stapp-server user passwd daniel
./stapp-server user disable daniel
./stapp-server user enable daniel

# Via Docker Compose:
docker compose exec stapp-server /usr/local/bin/stapp-server user add daniel
docker compose exec stapp-server /usr/local/bin/stapp-server user list
docker compose exec stapp-server /usr/local/bin/stapp-server user passwd daniel

# Via Cargo local:
cd server
cargo run -- user add daniel
cargo run -- user list
cargo run -- user passwd daniel
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
