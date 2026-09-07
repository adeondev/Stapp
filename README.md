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
│   ├── Dockerfile.release # Empacota o binário já compilado no CI (não compila nada)
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

## Destaques de Engenharia e Arquitetura

- **Áudio Avançado e Volume Boost Real:** Elementos `<audio>` padrão limitam o ganho estritamente a 1.0 (100%). O Stapp utiliza uma abstração de `PlaybackGraph` sobre a Web Audio API conectando `MediaStreamAudioSourceNode -> GainNode -> destination`, viabilizando boosts reais de até 200% por participante e no master, com nós ancorados para proteção contra garbage collection e limiter no pipeline de microfone.
- **Pipeline Nativo de Captura de Tela de Alta Performance (Tauri v2):** O compartilhamento de tela e janelas desktop utiliza buffers binários puros (`tauri::ipc::Response` com `Vec<u8>`), eliminando a sobrecarga de 4x na serialização JSON. No Windows, o cursor do mouse do sistema operacional é composto em hardware via Win32 GDI (`GetCursorInfo` e `DrawIconEx`) antes do redimensionamento paralelo com `rayon`.
- **Navegação Segura de Links Externos (WebView2):** Prevenção contra travamento e janelas em branco na WebView2 através do módulo centralizado `openExternalLink`, delegando para `@tauri-apps/plugin-opener` no desktop nativo e mantendo fallback web com `rel="noopener noreferrer"`.
- **Estabilidade de Layout e Embeds de Vídeo Seguros:** Chat com layout shifts zero através de reserva de proporção de aspecto (`aspect-ratio`) em imagens e skeletons, ancoragem inteligente do scroll via `ResizeObserver` e crawler no backend Rust com proteção rigorosa contra SSRF e renderização sob demanda em iframes com sandbox estrita.

---

## Novidades da Versão 0.1.0-beta.7

A versão **0.1.0-beta.7** consolida um salto significativo em escalabilidade de infraestrutura, fidelidade de áudio, ergonomia de chat e integração com o sistema operacional desktop:

### 1. Armazenamento em Objeto S3 / Cloudflare R2 e Pipeline CI/CD Otimizada
- **Suporte Nativo a S3/R2:** Armazenamento distribuído de anexos, avatares e mídias compatível com AWS S3, Cloudflare R2 e MinIO, configurável via bloco `[storage]` no `stapp.toml` ou variáveis de ambiente `STAPP_STORAGE_*`.
- **Fallback Local Transparente:** Em ambientes sem configuração de nuvem, o servidor utiliza automaticamente o armazenamento local em disco com expiração de uploads órfãos.
- **URLs Pré-assinadas:** Downloads e uploads diretos eliminam gargalos de banda e I/O no servidor central.
- **Distribuição GHCR:** Pipeline de CI/CD rápida com publicação de imagens multi-arquitetura diretamente no GitHub Container Registry (`ghcr.io/adeondev/stapp`).

### 2. Áudio BC-2 (Singleton AudioContext), Toque Unificado e Correções de Voz
- **Singleton AudioContext (BC-2):** Ciclo de vida unificado para todos os grafos de reprodução e efeitos, impedindo esgotamento de contextos do navegador e dessincronização de relógios de amostragem.
- **Máquina de Estados de Chamada Aprimorada:** Toque unificado (`ringing`) sincronizado entre remetente e destinatário, encerramento confiável dos loops sonoros e notificação persistente de chamadas perdidas.
- **Troca de Microfone Dinâmica e VAD Estável:** Alternância a quente de dispositivos de entrada sem necessidade de reiniciar a chamada, combinada com detecção de voz (VAD) ajustada contra ruídos transitórios.

### 3. DMs em Accordions Colapsáveis, Menu de Contexto no Trilho e Skip da Connect
- **Accordions por Servidor:** Lista de Mensagens Diretas agrupada por servidor de origem em seções colapsáveis, persistindo as preferências de expansão/recolhimento no `localStorage`.
- **Menu de Contexto no Trilho:** Clique com botão direito nos servidores do `ServerRail` exibe menu nativo com opções para "Marcar como lido", "Copiar endereço", "Convidar amigos" e "Sair do servidor".
- **Inicialização Ágil (Skip Connect):** Usuários com sessões pré-autenticadas e servidores ativos em cache ignoram automaticamente a tela `Connect`, entrando diretamente na interface principal.

### 4. Jumbojis Exclusivos, Proporção Real de Imagens e Favoritos de GIFs
- **Jumbojis (2.75rem):** Mensagens contendo estritamente entre 1 e 10 emojis (Unicode ou Twemoji) são renderizadas com dimensões ampliadas (`.chat__emoji--jumbo`), preservando o tamanho convencional quando mescladas a texto.
- **Proporção Real de Imagens:** Remoção de cortes forçados em anexos visuais com cálculo intrínseco de `aspect-ratio` e transparência total preservada para arquivos PNG, WebP e GIF.
- **Favoritos de GIFs:** Nova aba dedicada no seletor de GIFs (`GifPicker`), permitindo favoritar mídias frequentemente usadas com salvamento local instantâneo.

### 5. Fechar para a Bandeja (Close to Tray) e Notificações Desktop Nativas
- **Close to Tray no Tauri v2:** Interceptação do fechamento da janela (`CloseRequested`), mantendo o Stapp ativo na bandeja do sistema sem desconectar chamadas de voz ou WebSockets.
- **Menu da Bandeja:** Acesso rápido por clique duplo ou menu de contexto da bandeja: "Abrir Stapp", "Mutar Microfone" e "Sair Definitivamente".
- **Notificações Nativas do SO:** Avisos do sistema operacional para menções (`@nome`, `@everyone`), mensagens diretas e chamadas entrantes com foco automático ao clicar.

### 6. Avatar GIF Reativo à Voz, Banners de Perfil e 5 Temas Semânticos
- **Avatar GIF Reativo:** Extração do primeiro quadro estático no upload (`avatar_static_url`), ativando a reprodução animada (`avatar_gif_url`) exclusivamente quando o usuário fala em canais de voz.
- **Banners de Perfil Customizados:** Suporte a cores sólidas hexadecimais e imagens de banner em 960x360, com popover rápido e atalho direto para iniciar conversa.
- **5 Temas de Cores com Persistência:** Escuro (padrão), Ônix (OLED), Cinza Neutro, Claro e Personalizado (com personalização livre de fundo e cor de destaque).

---

## Licença

MIT


