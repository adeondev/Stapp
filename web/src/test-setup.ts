// Sem isto o React Testing Library nao desmonta o que cada teste renderizou —
// o DOM de um caso vaza para o proximo e as buscas encontram elemento errado.
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)
