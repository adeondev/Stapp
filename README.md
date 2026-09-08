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
- **Pipeline Nativo de Captura e Streaming de Tela de Alta Performance (Zero-Copy GPU):** O compartilhamento de tela opera inteiramente em hardware no Windows: captura via Windows Graphics Capture (`Direct3D11CaptureFramePool`), escala e conversão de cores bilinear BGRA→NV12 via `ID3D11VideoProcessor` na GPU (~0.1ms), codificação H.264 por hardware (NVIDIA NVENC, AMD AMF ou Intel QuickSync via Media Foundation Transform), transferência por canais IPC binários puros de 32 bytes (`MAGIC_STAP` para vídeo e `MAGIC_SAUD` para áudio PCM) e ingestão no frontend via WebCodecs (`VideoDecoder` acelerado por hardware) direto para `MediaStreamTrackGenerator`, contornando canvas e blobs. Suporta 1080p60 fluido e estável com uso residual de CPU no host e sem engasgos em jogos. A arquitetura futura já está costurada para publicação nativa direta via SDK Rust do LiveKit (`livekit-rust`), zerando o envolvimento da WebView2 no streaming.
- **Navegação Segura de Links Externos (WebView2):** Prevenção contra travamento e janelas em branco na WebView2 através do módulo centralizado `openExternalLink`, delegando para `@tauri-apps/plugin-opener` no desktop nativo e mantendo fallback web com `rel="noopener noreferrer"`.
- **Estabilidade de Layout e Embeds de Vídeo Seguros:** Chat com layout shifts zero através de reserva de proporção de aspecto (`aspect-ratio`) em imagens e skeletons, ancoragem inteligente do scroll via `ResizeObserver` e crawler no backend Rust com proteção rigorosa contra SSRF e renderização sob demanda em iframes com sandbox estrita.

---

## Novidades da Versão 0.1.0-beta.8

A versão **0.1.0-beta.8** é uma leva de correção: a beta.7 chegou com um conjunto de regressões que só apareceram em uso real. Cada item abaixo traz a causa raiz, não só o sintoma.

### 1. Avatares, GIFs e Cards de Chamada Voltando a Carregar
- **Query de Entrega Recusada:** O extrator `axum::extract::Query` usa `serde_urlencoded`, que só aceita `true`/`false` como booleano. Como o próprio servidor publica `?static=1` e `?gif=1` em `avatar_static_url` e `avatar_gif_url`, **toda** requisição de avatar respondia `400 Bad Request` antes de chegar ao handler — derrubando avatares, GIFs animados e os cards da chamada de uma vez.
- **Desserialização Tolerante:** As flags aceitam `1`/`0`, `true`/`false` e chave vazia; valor irreconhecível vale como "não pediu" em vez de derrubar a resposta.

### 2. Política de CSP e Aplicação do Tema
- **Script Inline Bloqueado:** O `<script>` de tema no `index.html` era barrado pela diretiva `script-src 'self' 'wasm-unsafe-eval'` dos dois lados — o middleware de `server/src/app.rs` e o `tauri.conf.json`. Servida pelo próprio Stapp ou pelo app desktop, a tela abria sem tema nenhum.
- **Módulo Externo:** O código migrou para `web/src/theme-init.ts`, compilado pelo Vite e servido pela mesma origem. Nenhum script inline permanece na página.

### 3. Instância Única no Desktop (Tauri v2)
- **Segundo Processo ao Reabrir:** Com o Stapp escondido na bandeja, clicar no executável novamente subia um segundo processo — duas conexões, o mesmo apelido duplicado na lista e a janela original permanecendo oculta.
- **`tauri-plugin-single-instance`:** Registrado como primeiro plugin do builder. O processo duplicado apenas avisa o que já está rodando e encerra; a janela existente é restaurada tratando os três estados na ordem correta (oculta → `show`, minimizada → `unminimize`, então `set_focus`), preservando sessão e chamada em andamento.

### 4. Conflito de Sessão ao Entrar em Chamada
- **Reserva Vencendo Antes do Grant:** A reserva de vaga durava 15s contra 60s do grant. Entre `voice.join` e `voice.connected` o cliente ainda baixa o `livekit-client`, abre a conexão com o SFU, pede o microfone e carrega o WASM do RNNoise — em máquina fria isso ultrapassa os 15s. `RESERVATION_TTL` passou a ser igual a `GRANT_TTL`.
- **Takeover Canônico:** Sem reserva válida, mas com o SFU confirmando que a identidade está na sala, o servidor recusava justamente a sessão nova — a única realmente conectada — enquanto a antiga (queda abrupta, troca de aparelho) segurava a vaga. Agora a sessão nova desaloja as anteriores da conta e entra imediatamente.

### 5. Calibração do VAD e Anel de Fala
- **Limiar do Gate:** A faixa automática ia de -60 a -30 dBFS. Quem fala em volume médio, longe do microfone ou com ganho modesto fica perto de -45: o gate não abria, o LiveKit recebia silêncio e ninguém era anunciado como falante. A faixa desceu para -75/-45 nos dois worklets, com histerese de 6 dB contra o picote em torno do limiar.
- **Detecção no SFU:** O padrão do LiveKit (`active_level: 35`, ou -35 dBov, com 40% do intervalo) só reconhece voz projetada. A configuração passou a `active_level: 45` e `min_percentile: 15` na stack avulsa e no `compose.yaml`.
- **Medidor ao Vivo:** O deslizante de sensibilidade ganhou o nível de entrada em tempo real com a marca do limiar no mesmo eixo — dá para ver, falando, se a voz passa do ponto em que o anel verde acende.

### 6. Dispositivos de Áudio: Duplicatas e Troca a Quente
- **Apelidos do Windows:** O sistema entrega o mesmo microfone três vezes — o hardware real e os apelidos `default` e `communications`, com id e rótulo diferentes. A deduplicação passou a comparar hardware: `deviceId`, `groupId` e rótulo sem o prefixo do sistema.
- **Troca Presa no Dispositivo Antigo:** Com `stopMicTrackOnMute: false`, desligar o microfone apenas silencia a faixa, e `setMicrophoneEnabled(true, opções)` **reusa** essa faixa ignorando as opções novas. A troca passa por `switchActiveDevice`, e o restart despublica de verdade antes de republicar — o que também faz valer as mudanças de supressão de ruído e cancelamento de eco.

### 7. Camadas da Interface e Diálogos Aninhados
- **Selects que Não Abriam:** O `PopupMenu` é renderizado por portal no `document.body` com `z-index: 300`, abaixo do `--z-modal: 400` do próprio diálogo de configurações. A lista nascia atrás do scrim: invisível e sem receber clique. Token novo `--z-menu: 450`, entre modal e toast.
- **Escape em Diálogo sobre Diálogo:** Dois modais escutando `keydown` na janela em captura faziam o de baixo receber o evento primeiro — fechar o de cima levava os dois junto. O `Overlay` mantém uma pilha e só o diálogo do topo responde ao teclado.

### 8. Aba de Notificações
- **Interruptores por Tipo:** As notificações nativas do sistema operacional disparavam sempre, sem lugar nenhum para desligá-las. A categoria voltou às Configurações com controles independentes para chamadas, mensagens diretas e menções.
- **Decisão Junto do Disparo:** O interruptor é consultado dentro de `notifyIncomingCall`, `notifyNewDm` e `notifyMention`, de modo que nenhuma tela nova possa esquecer de verificá-lo. A preferência é local ao aparelho, como tema e voz.

### 9. Perfil: Enquadramento, Banner e Avatar
- **Banner Invisível no Desktop:** `banner_url` chega relativa ao servidor; usada crua, era resolvida contra a origem da página — `tauri://localhost` no app e `:5173` no dev, nunca o servidor. A imagem existia e respondia 200, mas aparecia apenas a faixa de cor. A resolução foi centralizada em `resolveMediaUrl`.
- **Enquadramento de Imagem:** O servidor sempre cortou pelo centro (1:1 no avatar, 8:3 no banner), o que comia o rosto em retratos de celular. O cliente passa a enquadrar antes do envio — arrastar e aproximar — entregando a imagem já na proporção final, sem nenhum campo novo no protocolo. GIF sobe intacto, senão o avatar animado viraria imagem parada.
- **Exclusividade entre Imagem e Cor:** Escolher uma imagem de banner limpa a cor sólida e vice-versa. No caminho apareceram duas derivas reais: `banner_color` faltava no espelho `web/src/protocol.ts`, e o cliente enviava `undefined` — que o servidor lê como "não mexe", fazendo a cor antiga sobreviver por trás da imagem nova.
- **Fundo Sólido Vazando no Avatar:** O contêiner pintava `--avatar-accent` mesmo com foto, vazando pela borda arredondada e por qualquer transparência do PNG, além de piscar um retângulo colorido durante o carregamento. Com imagem, o token passa a `transparent`.

### 10. Tela de Login
- **Dois Botões de Revelar Senha:** O Edge e a WebView2 desenham um olho e um "x" próprios dentro de `input[type=password]`. Ao lado do controle do Stapp viravam dois olhos no mesmo campo, um deles sem rótulo acessível. Os nativos foram suprimidos; o controle da aplicação permanece.

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


