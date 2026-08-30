# LiveKit local do Stapp

Alvo inicial: Windows 10/11, Radmin VPN e no máximo seis participantes. O SFU é o
LiveKit `v1.13.6`; não há LiveKit Cloud, TURN, gravação, ingress, egress ou
telemetria externa configurada.

1. Copie `.env.example` para `.env` e troque IP, chave e segredo. O `.env` é
   ignorado pelo Git.
2. Abra no Firewall do Windows, somente para a rede usada pelo Radmin:
   TCP 7880 (sinalização/API), TCP 7881 (ICE fallback) e UDP 7882 (mídia).
3. Execute uma das formas equivalentes:

   ```powershell
   .\Start-LiveKit.ps1 -Mode Docker -StartStapp
   .\Start-LiveKit.ps1 -Mode Native -StartStapp
   ```

O modo Docker fixa `livekit/livekit-server:v1.13.6`. O modo nativo baixa o release
oficial Windows AMD64 e recusa o arquivo se o SHA-256 não for
`9df299b6c6c32f1be88d3d106a9a63f8f921b424b353cc59f57d6b84532a4475`.
O script gera `livekit.generated.yaml` e `server/stapp.livekit.toml`, ambos
ignorados, espera o health check e nunca cria regra de firewall silenciosamente.

O cliente deve ser o app Tauri/WebView2. Por HTTP remoto, navegadores não liberam
microfone ou captura; localhost ou HTTPS continuam funcionando.
