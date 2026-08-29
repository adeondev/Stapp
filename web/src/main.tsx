import { createRoot } from 'react-dom/client'
import App from './App'
import './ui/theme.css'

// Sem StrictMode de proposito: o mount duplo do dev abriria duas conexoes e o
// mesmo apelido apareceria duas vezes na lista, atrapalhando o teste manual.
createRoot(document.getElementById('root')!).render(<App />)
