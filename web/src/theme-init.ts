/**
 * Aplica o tema salvo ANTES do React montar.
 *
 * Existe por causa do flash: `main.tsx` tambem chama `applyTheme`, mas so depois
 * de baixar e avaliar o bundle inteiro — nesse intervalo a pagina pisca no tema
 * padrao. Este modulo e minusculo e entra primeiro no `index.html`.
 *
 * PROTOTYPE: era um `<script>` inline no `index.html`, e a politica de CSP do
 * servidor (`script-src 'self' 'wasm-unsafe-eval'` em `server/src/app.rs`)
 * bloqueava — a tela abria sem tema nenhum quando servida pelo proprio Stapp.
 * O invariante que nao pode quebrar: **nada de script inline na pagina**; toda
 * execucao sai de um arquivo servido pela mesma origem. Se precisar de mais
 * trabalho antes da montagem, cresce aqui — nao volta para dentro do HTML.
 */
import { applyMotionPreference, applyTheme, loadCustomThemeSettings, loadMotionPreference, loadThemePreference } from './ui/settings/appearance'

applyTheme(loadThemePreference(), loadCustomThemeSettings())
applyMotionPreference(loadMotionPreference())
