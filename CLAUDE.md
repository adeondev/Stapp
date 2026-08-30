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
3. **Acento `#7C9CFF`** — um azul claro, de propósito mais claro que o `#5865F2` do Discord.
4. **Tema escuro.**
5. **Nenhum hex solto em componente.** Toda cor sai de uma CSS custom property definida em
   [`web/src/ui/theme.css`](web/src/ui/theme.css). Precisa de um tom novo? Adiciona um token lá.

```css
--accent  #7C9CFF   --accent-hover  #96AFFF   --accent-quiet  #2A3050
--on-accent #10131C  /* texto EM CIMA do acento */
--bg-sidebar #16171C   --bg-app #1E2027   --bg-raised #2A2D36   --bg-input #24262E
--text #E6E8EE   --text-dim #9AA0AE   --danger #E4676B   --online #57C98A
--radius 8px
```

`--on-accent` e escuro de proposito: branco sobre `#7C9CFF` da ~2.3:1 de contraste
e fica ilegivel. Botao com fundo de acento leva texto escuro.

Sem biblioteca de UI e sem framework de CSS. CSS na mão, um arquivo por componente.

---

## Arquitetura

```
server/   Rust — axum + tokio. Binário único, config em stapp.toml, SQLite em data/stapp.db.
web/      Vite + React + TS. Roda no navegador hoje, empacotado em Tauri depois.
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

A cor é guardada pelo **nome** (`"green"`), nunca pelo hex — a lista canônica está em
`ACCENTS`, em [`server/src/services/profile/mod.rs`](server/src/services/profile/mod.rs), e
precisa bater com os tokens `--accent-<nome>` do `theme.css`.

### Regra dura: os dois `protocol` andam juntos

[`server/src/protocol.rs`](server/src/protocol.rs) é a fonte da verdade.
[`web/src/protocol.ts`](web/src/protocol.ts) é o espelho manual dele.

**Mexeu em um, mexe no outro na mesma alteração.** Não existe geração automática aqui de
propósito (não vale a complexidade nesse tamanho), então a disciplina é manual. Os nomes dos
campos no TS são `snake_case` porque vêm direto do serde — não "arrume" isso.

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
cd server && cargo run      # :8787
cd web && pnpm dev          # :5173  (navegador)
cd web && pnpm app          # app desktop (Tauri), usa o mesmo dev server
```

Antes da primeira entrada, crie uma conta com `cargo run -- user add <username>` ou habilite
`auth.allow_registration` no `stapp.toml`. Testar de verdade = duas contas em duas abas.

---

## Armadilhas (já custaram tempo, não repita)

- **Microfone exige contexto seguro.** `getUserMedia` só funciona em `localhost` ou HTTPS.
  Abrir o cliente em `http://192.168.0.x:5173` **bloqueia o microfone silenciosamente**. Para
  testar na LAN: app Tauri (origem `tauri://` é secure context) ou TLS de verdade.
- **Senha sem TLS só sai de rede declarada.** O servidor recusa `/auth/login` e `/auth/register` de
  qualquer origem que não seja loopback ou uma faixa em `auth.trusted_networks` (`stapp.toml`).
  Quem decide é o servidor, e ele avisa a decisão daquela conexão no `auth.required`, no campo
  `plaintext_auth_allowed` — **o cliente obedece, não repete a regra**. Se você se pegar
  escrevendo política de rede em `web/`, é sinal de que ela deveria estar no servidor.
- **Duas travas diferentes, não confunda.** Autenticação por rede confiável e microfone por
  contexto seguro são independentes: numa VPN o texto funciona e a voz não, porque o navegador
  não sabe nada de `trusted_networks`. Voz fora do localhost = app Tauri ou TLS.
- **Mesh sem TURN falha em alguns NATs** (CGNAT de operadora). O `ice_servers` vem do
  `stapp.toml`, então adicionar um coturn depois é config, não código.
- **Anti-glare do mesh:** quem *entra* na call cria as offers para todo mundo que já estava;
  quem já estava **só responde**. Nunca os dois lados ofertando.
- **`rusqlite` usa a feature `bundled`** (compila o SQLite em C). No Windows precisa do MSVC
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
- **Senha exige transporte seguro.** `ws://` so autentica em loopback. Fora da propria maquina,
  termine TLS em um proxy no mesmo host e conecte por `wss://`; nunca afrouxe essa validacao para
  fazer a LAN funcionar.
