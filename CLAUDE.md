# Stapp — instruções para IAs

Discord privado auto-hospedado para um grupo pequeno de amigos. Modelo mental: **servidor de
Minecraft**. O `server/` é o "servidor" que alguém sobe; o `web/` é o "jogo" que conecta nele.
A aplicação só fala com esse servidor — não existe backend na nuvem, não existe serviço terceiro.

Escopo atual é **protótipo**: chat de texto + call de voz. **Não existe conta de usuário** — a
pessoa digita um apelido na tela de conexão e pronto. Não adicione login, OAuth, e-mail ou senha
sem que seja pedido.

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

Os dois se falam por **um** WebSocket em `/ws`, JSON, enum com tag interna `t`.

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

## Como rodar

```bash
cd server && cargo run      # :8787
cd web && pnpm dev          # :5173  (navegador)
cd web && pnpm app          # app desktop (Tauri), usa o mesmo dev server
```

Testar de verdade = **duas abas** em `http://localhost:5173` com apelidos diferentes.

---

## Armadilhas (já custaram tempo, não repita)

- **Microfone exige contexto seguro.** `getUserMedia` só funciona em `localhost` ou HTTPS.
  Abrir o cliente em `http://192.168.0.x:5173` **bloqueia o microfone silenciosamente**. Para
  testar na LAN: app Tauri (origem `tauri://` é secure context) ou TLS de verdade.
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
