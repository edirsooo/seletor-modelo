// Camada invisível por cima da chavinha desenhada do Ultracode: um clique manda `{ alterna: true }`.
import type { ClientModule } from 'claude-code'

const Chave: ClientModule<Record<string, never>, Record<string, never>> = (_props, s) => {
  const { Box, Text } = s.elements
  s.onPointer(ev => {
    if (ev.type === 'up') s.post({ alterna: true })
  })
  return Box({ width: '100%', height: '100%', children: [Text({ children: ' ' })] })
}

export default Chave
