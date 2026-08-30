# Stapp

Um Discord só nosso. Servidor auto-hospedado + aplicação que conecta nele — no espírito de um
servidor de Minecraft: alguém sobe o servidor, o resto entra.

O Stapp oferece **canais, mensagens diretas, amizades, privacidade, bloqueio e chamadas de voz**
com contas locais por servidor. Cada host controla seus próprios usernames; não existe conta
Stapp global nem um serviço central recebendo credenciais.

## Requisitos

- [Rust](https://rustup.rs) (edição 2021+)
- [Node.js](https://nodejs.org) 20+ e [pnpm](https://pnpm.io)

## Subindo o servidor

```bash
cd server
cargo run
```

Sobe em `http://localhost:8787`. Na primeira execução ele cria o `data/stapp.db`. Se encontrar o
esquema antigo, que guardava somente apelidos, o servidor para e mostra o caminho do arquivo:
faça backup ou remova o banco conscientemente e inicie novamente.

As configurações ficam em [`server/stapp.toml`](server/stapp.toml) — é o `server.properties` daqui.
Dá pra mudar nome, porta, canais, limites, registro público e servidores de ICE.

Por padrão o registro pelo aplicativo vem fechado. Crie a primeira conta no terminal; a senha é
solicitada sem aparecer na tela ou no histórico do shell:

```bash
cd server
cargo run -- user add daniel
cargo run -- user list
cargo run -- user passwd daniel
cargo run -- user disable daniel
cargo run -- user enable daniel
```

Para outro arquivo, use `--config caminho/stapp.toml`. O formato antigo
`stapp-server caminho/stapp.toml` continua aceito temporariamente para iniciar o servidor.

Para permitir que qualquer pessoa alcançando o servidor crie a própria conta:

```toml
[auth]
allow_registration = true
max_sessions_per_user = 3
```

Usernames têm de 3 a 24 letras ASCII, números, ponto, hífen ou sublinhado e não diferenciam
maiúsculas de minúsculas para unicidade. Senhas têm de 12 a 128 caracteres e são guardadas como
hashes Argon2id com salt individual.

## Subindo o cliente

```bash
cd web
pnpm install
pnpm dev
```

Abre em `http://localhost:5173`. A aplicação pode lembrar vários servidores, mas mantém apenas
uma conexão ativa. "Lembrar servidor" salva somente URL, nome e username; senha e tokens nunca
entram no `localStorage`.

Login e registro usam `/auth/login` e `/auth/register`. O access token curto fica apenas em
memória e o WebSocket recebe somente esse token. "Lembrar usuário" usa um refresh token de 30
dias em cookie `HttpOnly`, `Secure` e exclusivo daquela instância; o SQLite guarda apenas seu
hash. Sem HTTPS (exceto localhost), a opção fica indisponível e a sessão é temporária.

Para testar de verdade, abra **duas abas** com contas diferentes. A mesma conta pode manter até
três sessões, mas aparece uma vez na lista online e apenas uma delas entra em voz.

> **Microfone:** o navegador só libera microfone em `localhost` ou HTTPS. Acessar o cliente pelo
> IP da rede local (`http://192.168.x.x`) faz o texto funcionar mas a voz não. Para usar na LAN,
> use o app desktop (Tauri) ou coloque HTTPS.

## HTTPS/WSS e senhas na rede

O servidor não termina TLS. Em produção, coloque Caddy ou Nginx **no mesmo host**, exponha
HTTPS/WSS e encaminhe tanto `/auth` quanto `/ws` para `127.0.0.1:8787`. O backend recusa senha
sem TLS fora de loopback ou de `auth.trusted_networks`; uma rede confiável habilita apenas sessão
temporária, pois o refresh cookie continua exigindo HTTPS. Não publique a porta 8787 na internet.

Se o cliente estiver hospedado em outro domínio, liste origens exatas em
`auth.allowed_origins`. Curingas não são aceitos.

Exemplo mínimo de Caddyfile:

```caddyfile
stapp.exemplo.com {
    reverse_proxy 127.0.0.1:8787
}
```

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
server/   Rust (axum + tokio) — auth HTTP, WebSocket, presença, social, chat, SQLite
web/      Vite + React + TS — shell multi-servidor e aplicação
web/src-tauri/   casca desktop (o app web roda inteiro sem ela)
```

A voz é P2P: o áudio vai direto de uma pessoa pra outra, o servidor só apresenta uma à outra.
Funciona bem até umas 6 pessoas na mesma call — daí em diante o upload de cada um satura, e a
troca por um servidor de mídia (SFU) já está preparada no código.

## Licença

MIT
