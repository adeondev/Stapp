# Stapp

Um Discord só nosso. Servidor auto-hospedado + aplicação que conecta nele — no espírito de um
servidor de Minecraft: alguém sobe o servidor, o resto entra.

Protótipo: **chat de texto** e **call de voz**. Sem cadastro — você escolhe um apelido e entra.

## Requisitos

- [Rust](https://rustup.rs) (edição 2021+)
- [Node.js](https://nodejs.org) 20+ e [pnpm](https://pnpm.io)

## Subindo o servidor

```bash
cd server
cargo run
```

Sobe em `http://localhost:8787`. Na primeira execução ele cria o `data/stapp.db`.

As configurações ficam em [`server/stapp.toml`](server/stapp.toml) — é o `server.properties` daqui.
Dá pra mudar nome do servidor, porta, canais, limite de gente na call e servidores de ICE.

## Subindo o cliente

```bash
cd web
pnpm install
pnpm dev
```

Abre em `http://localhost:5173`. Digite o endereço do servidor e um apelido.

Para testar de verdade, abra **duas abas** com apelidos diferentes.

> **Microfone:** o navegador só libera microfone em `localhost` ou HTTPS. Acessar o cliente pelo
> IP da rede local (`http://192.168.x.x`) faz o texto funcionar mas a voz não. Para usar na LAN,
> use o app desktop (Tauri) ou coloque HTTPS.

## App de desktop

```bash
cd web
pnpm app          # roda o app nativo (Tauri) apontando pro dev server
pnpm app:build    # gera o instalador
```

O app desktop tem uma vantagem concreta sobre o navegador: como a origem `tauri://` conta como
contexto seguro, o microfone funciona mesmo conectando num servidor da rede local pelo IP.

## Estrutura

```
server/   Rust (axum + tokio) — websocket, presença, chat, SQLite
web/      Vite + React + TS — a aplicação
web/src-tauri/   casca desktop (o app web roda inteiro sem ela)
```

A voz é P2P: o áudio vai direto de uma pessoa pra outra, o servidor só apresenta uma à outra.
Funciona bem até umas 6 pessoas na mesma call — daí em diante o upload de cada um satura, e a
troca por um servidor de mídia (SFU) já está preparada no código.

## Licença

MIT
