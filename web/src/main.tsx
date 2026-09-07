import { createRoot } from 'react-dom/client'
import App from './App'
import { DesktopFrame } from './ui/DesktopFrame'
// O tema sai de `src/theme-init.ts`, que o `index.html` tambem carrega no
// `<head>` — no dev isso e o que evita o pisca-pisca, porque roda antes de o app
// inteiro ser avaliado. A importacao aqui e a garantia do build de producao, em
// que o empacotador junta os dois pontos de entrada num pedaco so: sem ela, a
// aplicacao do tema poderia sair do bundle. O modulo e idempotente, entao rodar
// duas vezes nao custa nada.
import './theme-init'
import './ui/theme.css'

// Sem StrictMode de proposito: o mount duplo do dev abriria duas conexoes e o
// mesmo apelido apareceria duas vezes na lista, atrapalhando o teste manual.
createRoot(document.getElementById('root')!).render(<DesktopFrame><App /></DesktopFrame>)
