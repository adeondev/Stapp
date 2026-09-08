# Stapp — instruções para IAs

Discord privado auto-hospedado para um grupo pequeno de amigos. Modelo mental: **servidor de
Minecraft**. O `server/` é o "servidor" que alguém sobe; o `web/` é o "jogo" que conecta nele.
A aplicação só fala com esse servidor — não existe backend na nuvem, não existe serviço terceiro.

Escopo atual é **protótipo**: chat de texto + call de voz. Cada servidor possui suas proprias
contas locais (username + senha Argon2id); nao existe identidade global, OAuth, e-mail, servico
terceiro ou recuperacao automatica.

### Costuras de prototipo precisam estar escritas

Use `PROTOTYPE:` quando o comportamento atual e uma concessao deliberada e `FUTURE:` quando ja
existe uma costura concreta para a proxima direcao. O comentario precisa dizer a limitacao, o
invariante que nao pode ser quebrado e como a costura deve evoluir. Nao deixe `TODO` vago.

---

## Design — estas regras não são sugestão

1. **Flat. Sem sombra nenhuma.** `box-shadow` é proibido no projeto inteiro — inclusive em modal,
   dropdown, popover e hover. Elevação se expressa por tom de fundo, nunca por sombra.
2. **Sem outline e sem borda** na maioria dos elementos. Separação entre áreas é feita por
   **tom de fundo**, não por linha divisória.
   - *Única exceção:* `:focus-visible` mantém um anel visível. É acessibilidade de teclado, não
     decoração. Não remova.
3. **Acento `#209cee`** — o azul do Stapp.
4. **Tema escuro.**
5. **Nenhum hex solto em componente.** Toda cor sai de uma CSS custom property definida em
   [`web/src/ui/theme.css`](web/src/ui/theme.css). Precisa de um tom novo? Adiciona um token lá.

```css
--accent #209cee   --accent-hover #1686cf   --accent-quiet rgba(32,156,238,.15)
--on-accent #ffffff   --on-danger #ffffff   --on-online #ffffff  /* tinta SOBRE cor solida */

/* Escada de superficie: quanto mais a DIREITA na tela, mais claro o fundo. */
--bg-canvas #131416   --bg-rail #1a1b1e   --bg-sidebar #232428
--bg-app #2b2d31      --bg-chat #2f3035   --bg-raised #1d1e21
--bg-floating #131416 --bg-input #383a40  --bg-surface = --bg-raised
--sunken rgba(0,0,0,.24)   --overlay-scrim rgba(0,0,0,.85)

--text #f2f3f5   --text-soft #dbdee1   --text-dim #949ba4   --text-faint #80848e
--danger #f23f43   --online #23a55a   --warning #f0b232
```

E tudo tem escada, não só cor. Use o degrau; não invente o valor intermediário:

```css
--radius-sm 4px  --radius-md 6px  --radius 8px  --radius-lg 12px  --radius-xl 16px  --radius-pill 999px
--space-1..8     2 4 6 8 12 16 24 32
--fs-xs..2xl     11 12 13(base) 14(md) 16 20 24     --fw-medium/semibold/bold  500/600/700
--dur-fast 90ms  --dur-base 140ms  --dur-slow 220ms   (+ --motion-smooth / --motion-spring)
--z-raised 10  --z-sticky 20  --z-dock 40  --z-popover 300  --z-modal 400  --z-toast 500
```

Sem biblioteca de UI e sem framework de CSS. CSS na mão, um arquivo por componente.

### Iconografia: uma família, dois pesos

Tudo vem do **Remix Icon**, por [`web/src/ui/Icons.tsx`](web/src/ui/Icons.tsx). Nunca importe
`@remixicon/react` direto num componente, e nunca desenhe um `<svg>` à mão — a única exceção é
`IconStappLogo`, que é a marca.

- `outlined` (padrão) — ação inativa, secundária ou neutra;
- `filled` — ação selecionada, ativa, ou com mais peso visual;
- **destrutivo não se marca com preenchimento**, e sim com a cor `--danger`.

`size` é uma união fechada (16/18/20/24/32) de propósito: um `size={17}` solto não compila. Ícone
como caractere de texto (`✕`, `×`, `‹`, `!`) é proibido — já foi eliminado duas vezes.

### Primitives que já existem (use, não recrie)

| Precisa de | Use |
|---|---|
| diálogo | `<Modal>` de [`ui/Overlay.tsx`](web/src/ui/Overlay.tsx) — Escape, foco preso, foco devolvido |
| botão só com ícone | `<IconButton>` de [`ui/IconButton.tsx`](web/src/ui/IconButton.tsx) |
| menu / dropdown | `PopupMenu`, `MenuHost` de [`ui/Menu.tsx`](web/src/ui/Menu.tsx) |
| superfície ancorada | `useAnchoredSurface` de [`ui/anchored.ts`](web/src/ui/anchored.ts) — vira de lado sozinha |
| cartão de perfil | `useUserProfile()` / `useProfileTrigger()` de `ui/profile/` |
| linha de configuração | primitives de [`ui/settings/primitives.tsx`](web/src/ui/settings/primitives.tsx) |
| anexo | `AttachmentRenderer` de `ui/rich/` decide o tipo; não reimplemente |

---

## Arquitetura

```
compose.yaml      Orquestração completa: stapp-server, livekit e caddy (opcional)
server/Dockerfile Build multi-stage (Node 22 SPA + Rust 1.85 release + Debian runtime)
server/           Rust — axum + tokio. Binário único, config em stapp.toml ou env STAPP_*, SQLite em data/stapp.db.
web/              Vite + React + TS. Roda no navegador ou empacotado em Tauri.
infra/caddy/      Terminação TLS reversa opcional para HTTPS e portas unificadas.
infra/livekit/    Configurações e scripts para SFU LiveKit WebRTC.
```

Login, registro, refresh e logout passam por HTTP em `/auth`. O cliente guarda o access token
curto somente em memória e o usa para autenticar **um** WebSocket em `/ws`, JSON, enum com tag
interna `t`. A conexão recebe `auth.required`, responde `auth.access` e só então enxerga eventos.

### Regra dura: cada camada só conhece a de dentro

```
cli/        linha de comando (clap). main.rs só inicializa o log e chama Cli::run
app.rs      monta o Router do axum e serve
ws/         transporte: mod.rs é o cano, auth_flow.rs autentica, dispatch.rs roteia
services/   regras de cada funcionalidade (chat/, voice/)
session/    estado vivo: bus.rs entrega eventos, registry.rs sessões, membership.rs voz
storage/    SQLite: schema.rs migra, accounts.rs e messages.rs consultam
```

**Onde entra coisa nova:**

- comando novo → um arquivo em `cli/` e uma linha no enum `Command`;
- funcionalidade nova → um módulo em `services/` e um braço em `ws/dispatch.rs`;
- tabela nova → um arquivo em `storage/` e uma migração em `storage/schema.rs`.

`ws/mod.rs` **não** ganha `if` novo. A conexão é uma máquina de estados de duas fases
(`Phase::Anonymous` → `Phase::Authenticated`); anônima só alcança `auth_flow`, autenticada só
alcança `dispatch`. Foi assim que o `handle` gigante deixou de existir — não recrie.

### Mensagens diretas

A conversa **não tem tabela**: o par de contas já é a identidade dela, e o id sai de
`storage::conversation_id(a, b)` — os dois ids ordenados. Mandar a primeira mensagem para
alguém é igual a mandar a centésima; não existe "criar conversa".

Duas coisas que não são óbvias e já quebraram uma vez:

- **DM não vai por broadcast.** O canal usa `state.broadcast`; a direta entrega só nas sessões
  das duas contas (`sessions_of`). Uma pessoa pode ter várias conexões e todas precisam receber.
- **`dm.new` tem payload diferente por lado.** O campo `user_id` é sempre *a outra pessoa* na
  visão de quem recebe, e `unread` é a contagem daquele destinatário. Por isso são dois
  `send_to`, não um evento só.
- **Ler avisa todas as suas sessões** (`ServerMsg::DmRead`). Sem isso a aba que já estava com a
  conversa aberta continuava com o badge, porque nada dizia a ela que a contagem zerou.

`kind` em `dm_messages` (`text` | `call`) é o que deixa a chamada perdida virar linha na conversa.

### Chamada 1:1

`services/call` cuida **só do toque** — ligar, tocar, atender, recusar, desistir, expirar (30s).
Assim que é aceita, a chamada deixa de existir lá e vira um canal de voz comum, `dm:<a>:<b>`,
tratado pelo `services/voice` como qualquer sala: mesmo mesh, mesma sinalização, mesmo
`MeshTransport` no cliente. **Não existe caminho de áudio separado para DM.**

- **Toca mesmo se a pessoa já estiver numa sala de voz.** Quem decide sair é ela, ao atender —
  o `voice::join` já tira de uma call antes de entrar em outra. Não recuse por estar ocupado.
- **Evento de voz em canal `dm:` não vai por broadcast.** Numa sala, entrar e sair são públicos;
  numa conversa, contar para o servidor inteiro revelaria quem está falando com quem. Quem
  escolhe a audiência é `anunciar()` em `services/voice` — se você adicionar um evento de voz
  novo, ele passa por lá, não por `state.broadcast`.
- **Só os dois donos entram no canal `dm:`.** Sem essa guarda, bastaria adivinhar o nome do canal
  para entrar na conversa dos outros.
- O timer de expiração carrega o id da tentativa, senão um timer velho derrubaria uma chamada
  nova entre as mesmas duas pessoas.

### Regra dura: perfil se busca, não se copia

`username` é copiado para dentro de quase todo payload (`OnlineUser`, `VoicePeer`,
`Message.author_username`, `SocialMember`...). **Nome de exibição, cor e avatar não são.**

O servidor manda os perfis uma vez no `welcome` e um `user.profile` quando algum muda; os outros
payloads continuam levando só `user_id`. O cliente guarda `profiles: Record<UserId, Profile>` e
toda tela resolve por ali — [`web/src/ui/Avatar.tsx`](web/src/ui/Avatar.tsx) tem o `<Avatar>` e o
`<ProfileName>` que fazem isso.

Se você copiar o perfil para dentro de um payload, trocar de avatar vai exigir reescrever tudo
que já foi entregue, e o histórico fica com a foto velha para sempre.

`messages.author_username` e `dm_messages.author_username` **continuam existindo** e não são
bug: ali é registro histórico de quem escreveu. O que aparece na tela vem do perfil vivo.

Avatar e banner são imagens de verdade e passam pelo mesmo caminho: sobem por `POST /avatars` e
`POST /banners` (HTTP, não pelo WebSocket — centenas de KB pelo socket atrasariam a conversa de
todo mundo), o servidor **decodifica para saber se é imagem mesmo** (a extensão não vale nada),
corta, reduz e grava sempre um WebP. O que muda entre os dois é só a forma do corte, que é o
`Shape` em [`services/profile/avatar.rs`](server/src/services/profile/avatar.rs): quadrado de 256
para o avatar, 8:3 de 960×360 para o banner. Sem avatar, o `<Avatar>` cai sozinho na inicial
colorida; sem banner, o cartão de perfil usa uma faixa na cor de destaque da pessoa.

**Armadilha que já custou tempo:** o middleware de segurança em `app.rs` põe
`cross-origin-resource-policy: same-origin` em tudo. Isso **bloqueia a imagem no `<img>`** quando
o app roda noutra porta (dev: web em `:5173`, servidor em `:8787`) — e o sintoma engana, porque o
`GET` responde 200 e só o navegador recusa. As rotas de avatar e de banner sobrescrevem com
`cross-origin` de propósito, e o middleware respeita quem já definiu o cabeçalho. Se aparecer
imagem de perfil quebrada, olhe esse cabeçalho antes de qualquer outra coisa.

**O que é perfil e o que é detalhe.** O `welcome` manda o `Profile` de todo mundo de uma vez —
nome, cor, bio, `has_avatar`, `has_banner`, `created_at`. O que depende do PAR de contas (hoje só
amigos em comum) **não** vai aí: sai por `profile.fetch` → `profile.detail`, disparado quando
alguém *abre* um perfil, e nunca a cada avatar desenhado numa lista. Quem calcula a interseção é o
servidor, a partir da identidade da sessão — nunca de um id que o cliente disse ser "eu".

A cor é guardada pelo **nome** (`"green"`), nunca pelo hex — a lista canônica está em
`ACCENTS`, em [`server/src/services/profile/mod.rs`](server/src/services/profile/mod.rs), e
precisa bater com os tokens `--accent-<nome>` do `theme.css`.

### Regra dura: os dois `protocol` andam juntos

[`server/src/protocol.rs`](server/src/protocol.rs) é a fonte da verdade.
[`web/src/protocol.ts`](web/src/protocol.ts) é o espelho manual dele.

**Mexeu em um, mexe no outro na mesma alteração.** Não existe geração automática aqui de
propósito (não vale a complexidade nesse tamanho), então a disciplina é manual. Os nomes dos
campos no TS são `snake_case` porque vêm direto do serde — não "arrume" isso.

### Regra dura: mídia guarda a proporção real

`Attachment` carrega `width`/`height` desde a v8, e o `PATCH /attachments/{id}` sempre os aceitou —
mas ninguém preenchia, porque o servidor não decodifica anexo e o cliente só mandava nome e
descrição. Sem isso o container não sabia a proporção, e era por isso que **vídeo vertical entrava
espremido numa caixa horizontal** e a conversa dava salto quando a mídia carregava.

Agora o cliente mede no envio ([`rich/mediaDimensions.ts`](web/src/ui/rich/mediaDimensions.ts)) e
manda no PATCH. Duas consequências que não se pode desfazer por engano:

- **o que se limita é o tamanho da caixa, nunca a proporção.** Os tetos são em pixel (440 de
  largura, 420 de altura). Limitar por proporção parecia razoável e estava errado: qualquer teto
  abaixo de 16/9 faz um vídeo 9:16 — o formato de todo celular — ganhar tarja preta.
- **imagem solta usa `contain`, não `cover`.** `cover` corta retrato sem avisar. Na *galeria* (mais
  de uma imagem) o `cover` volta de propósito: ali o alinhamento entre as células vale mais, e o
  visualizador mostra a imagem inteira a um clique.

Quem escolhe o desenho de um anexo é o `AttachmentRenderer`; `MessageAttachments` só cuida do
ticket de acesso e da grade. **Não faça `fetch` dos bytes de mídia:** `/attachments/.../content`
manda `cross-origin-resource-policy` mas não `access-control-allow-origin`, então `fetch` falha
onde `<video src>` e `<img src>` funcionam. Isso já derrubou o player de áudio uma vez.

### Regra dura: voz passa pela interface, sempre

A UI **nunca** importa `RTCPeerConnection` ou qualquer API de WebRTC direto. Ela consome só
[`web/src/voice/VoiceTransport.ts`](web/src/voice/VoiceTransport.ts).

Hoje quem implementa é `MeshTransport` (P2P direto, o servidor só repassa sinalização). Isso
**trava acima de ~6 pessoas** na call, e é sabido — a migração para um SFU (LiveKit) já está
costurada em três pontos:

1. `VoiceTransport` — a interface. Amanhã ganha um `LiveKitTransport` ao lado do `MeshTransport`.
2. [`server/src/voice.rs`](server/src/voice.rs) — isola o backend de voz. `ws.rs` só delega.
3. `VoiceConfig`, entregue ao cliente dentro do `welcome`, tem um campo `backend`. O cliente
   escolhe o transporte **em runtime**, lendo esse campo. Trocar de mesh para SFU é config de
   servidor, não alteração de código de UI.

Não fure essas costuras por conveniência.

### Regra dura: Tauri é só a casca

Nenhuma lógica pode depender de `@tauri-apps/api`. O build web puro (`pnpm build`) tem que
continuar funcionando sozinho. Se precisar de algo nativo, isole atrás de uma interface com
fallback web.

---

## Testes

Duas camadas, e as duas ficam **fora** do arquivo de implementação:

- **unitários** — `src/<modulo>/tests.rs`, declarado com `#[cfg(test)] mod tests;` no `mod.rs`
  irmão. Continuam sendo um módulo interno, então enxergam o que é privado, mas não poluem o
  arquivo de código. É o meio-termo idiomático: nada de `#[path]` nem de teste no meio da lógica.
- **integração** — `server/tests/`, que só enxerga a API pública (`stapp_server::build`, `Config`,
  `admin`). `tests/fluxo_completo.rs` sobe o servidor numa porta efêmera e conversa por WebSocket
  de verdade: autenticar, conversar, entrar na call, reiniciar e conferir o histórico.

```bash
cd server && cargo test
```

Regra prática: se o teste precisa de detalhe interno, é unitário; se ele descreve o que o cliente
vê, é de integração. Não duplique o mesmo caso nas duas camadas.

---

## Como rodar

```bash
# Produção / Orquestração completa (stapp-server + web SPA + livekit):
cp .env.example .env
docker compose up -d

# Desenvolvimento local nativo:
cd server && cargo run      # :8787
cd web && pnpm dev          # :5173  (navegador)
cd web && pnpm app          # app desktop (Tauri), usa o mesmo dev server
```

Antes da primeira entrada, crie uma conta com `docker compose exec stapp-server /usr/local/bin/stapp-server user add <username>` (ou `cargo run -- user add <username>`) ou habilite `auth.allow_registration` no `stapp.toml` / `.env`. Testar de verdade = duas contas em duas abas.

---

## Armadilhas (já custaram tempo, não repita)

- **Microfone exige contexto seguro.** `getUserMedia` só funciona em `localhost` ou HTTPS.
  Abrir o cliente em `http://192.168.0.x:8787` **bloqueia o microfone silenciosamente**. Para
  usar na LAN/VPN: app Tauri (origem `tauri://` é secure context) ou ativar HTTPS (`docker compose --profile caddy up -d`).
- **Senha sem TLS só sai de rede privada/declarada.** O servidor recusa `/auth/login` e `/auth/register` de
  qualquer origem que não seja loopback, privada (LAN RFC1918, CGNAT/Tailscale 100.64.0.0/10, Radmin 26.0.0.0/8 quando `auth.trust_private_networks = true`) ou uma faixa em `auth.trusted_networks` (`stapp.toml`).
  Quem decide é o servidor, e ele avisa a decisão daquela conexão no `auth.required`, no campo
  `plaintext_auth_allowed` — **o cliente obedece, não repete a regra**. Se você se pegar
  escrevendo política de rede em `web/`, é sinal de que ela deveria estar no servidor.
- **Duas travas diferentes, não confunda.** Autenticação por rede confiável e microfone por
  contexto seguro são independentes: numa VPN o texto funciona e a voz não, porque o navegador
  não sabe nada de `trusted_networks`. Voz fora do localhost = app Tauri ou TLS.
- **Mesh sem TURN falha em alguns NATs** (CGNAT de operadora). O LiveKit SFU é o transporte padrão
  para chamadas em grupo, e o mesh permanece como fallback.
- **Anti-glare do mesh:** quem *entra* na call cria as offers para todo mundo que já estava;
  quem já estava **só responde**. Nunca os dois lados ofertando.
- **`sqlx` com SQLite assíncrono** gerencia o banco via `SqlitePool` e migrações em `server/migrations/`. No Windows precisa do MSVC
  Build Tools.
- **Analyser de audio precisa chegar ate `ctx.destination`.** O Chrome so processa o grafo que
  tem caminho ate a saida; um `AnalyserNode` num ramo solto le silencio. Por isso o
  `MeshTransport` liga `analyser -> GainNode(0) -> destination`. E pelo mesmo motivo os nos
  (`source`, `sink`) ficam guardados no `Monitor`: sem referencia viva o GC recolhe e o
  medidor morre calado. Custou horas — nao "simplifique" removendo.
- **Detectar quem esta falando nao da para verificar em navegador headless.** Em aba de fundo
  o grafo de audio praticamente nao roda, e o microfone falso do Chrome so emite bipes muito
  curtos. O caminho de audio (RTP nos dois sentidos) **da** para testar; o medidor de voz
  precisa de conferencia manual com microfone de verdade.
- **Senha exige transporte seguro.** `ws://` so autentica em loopback ou redes privadas autorizadas. Fora dessas redes,
  termine TLS em um proxy no mesmo host e conecte por `wss://`.
- **Limite nativo de volume no `<audio>` e uso obrigatório do `PlaybackGraph`:** A propriedade HTML5
  `audio.volume` aceita valores apenas entre `0.0` e `1.0`. Sliders que permitem amplificação
  (volume boost até 200%) são ignorados se aplicados diretamente no elemento de áudio. É obrigatório
  rotear as tracks remotas através do `PlaybackGraph` (`MediaStreamAudioSourceNode -> GainNode -> AudioContext.destination`),
  onde o `GainNode` suporta multiplicadores até `2.0`. Mantenha sempre referências vivas aos nós e ao `AudioContext`,
  caso contrário o GC do V8 coleta os objetos intermediários e o áudio é mutado silenciosamente.
- **Captura de tela nunca volta para GDI:** No Windows, o Windows Graphics Capture (WGC via `Direct3D11CaptureFramePool`)
  é a única fonte primária de captura de tela e de janelas. O backend GDI (`xcap::capture_image()` / `BitBlt`) é estritamente um
  fallback degradado para quando a API WGC for recusada pelo sistema operacional. GDI bloqueia o DWM do Windows, rouba
  10–25ms por quadro e causa engasgos severos em jogos executados em tela cheia. Nunca reverta a captura para GDI.
- **O quadro não desce para a CPU:** O ciclo de vida do quadro de vídeo opera 100% em memória de vídeo (VRAM): textura WGC
  (`ID3D11Texture2D`) → `D3D11VideoScaler` via `ID3D11VideoProcessor` (escala bilinear de alta qualidade e conversão BGRA→NV12 em
  passada única na GPU em ~0.1ms) → MFT de hardware (NVIDIA NVENC, AMD AMF ou Intel QuickSync) → bitstream H.264 despachado via canal
  binário `Channel<Response>`. A CPU não toca na memória de pixels: `rayon`, `parallel_resize_rgba` e cópias para RAM foram
  completamente eliminados. Jamais desça o quadro para a CPU nem "simplifique" o pipeline com buffers em RAM.
- **VP9 não tem encoder de hardware no WebView2:** No Chromium/WebView2 em ambiente Windows, a codificação de tela em VP9 roda
  estritamente em software na CPU, consumindo de 40% a 70% do processador do host ao transmitir a 1080p60. A transmissão de tela
  deve ser publicada obrigatoriamente em `video/H264` (perfil baseline/constrained via `videoCodec: 'h264'`) com fallback em VP8
  (`backupCodec: { codec: 'vp8' }`). A câmera continua em VP9.
- **Ingestão de vídeo no frontend sem canvas nem Blob:** O bitstream H.264 do canal binário alimenta diretamente a WebCodecs API
  (`VideoDecoder` com aceleração de hardware) e entrega o `VideoFrame` direto a um `MediaStreamTrackGenerator`, contornando
  `Blob`, `createImageBitmap`, `canvas.getContext('2d')` e `canvas.captureStream()`. Isso elimina o padrão em dente de serra do
  Garbage Collector do V8 e estabiliza o framerate no relógio do produtor nativo.
- **IPC de vídeo e áudio 100% binário:** Quadros de vídeo usam pacotes STAP de 32 bytes (`MAGIC_STAP`) e áudio PCM usa pacotes
  SAUD de 32 bytes (`MAGIC_SAUD`), despachados por canais dedicados `Channel<Response>` do Tauri. Jamais trafegue mídia por JSON.
- **Contrapressão explícita na fila de decodificação:** O tamanho de fila do `VideoDecoder` (`maxQueueSize = 4`) limita o atraso
  acumulado a ~66ms a 60fps. Ao atingir o limite, descarta o quadro e solicita imediatamente um IDR keyframe via IPC, preservando
  baixa latência sem congelar a reprodução.
- **Navegação de links externos na WebView2 (plugin opener):** Na WebView2 (Windows), tags `<a target="_blank">`
  não abrem o navegador padrão confiavelmente e podem quebrar a janela do app se não interceptadas.
  Use sempre a abstração `openExternalLink(url)` de [`web/src/platform/externalLink.ts`](web/src/platform/externalLink.ts),
  que delega para o `@tauri-apps/plugin-opener` no desktop nativo e recorre ao `window.open` seguro no navegador.

