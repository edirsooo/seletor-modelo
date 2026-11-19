// Camada invisível por cima da trilha desenhada do esforço: recebe o ponteiro.
// Enquanto arrasta, manda `{ previa }` (a bolinha anda junto); ao soltar, `{ nivel }` (o app troca o esforço).
import type { ClientModule } from 'claude-code'

type Props = { niveis: number }
type Estado = { arrasto: number | null }

const Trilha: ClientModule<Props, Estado> = (props, s) => {
  const { Box, Text } = s.elements
  const ultimo = props.niveis - 1
  const arrasto = s.state?.arrasto ?? null

  const nivelEm = (x: number) => {
    const cols = Math.max(1, s.columns)
    return Math.round(Math.min(1, Math.max(0, x / cols)) * ultimo)
  }

  s.onPointer(ev => {
    const x = ev.fine?.x ?? ev.x + 0.5
    if (ev.type === 'down' || (ev.type === 'move' && ev.button === 'left' && arrasto !== null)) {
      const n = nivelEm(x)
      if (n !== arrasto) {
        s.post({ previa: n })
        s.setState({ arrasto: n })
      }
    } else if (ev.type === 'up' && arrasto !== null) {
      s.post({ nivel: nivelEm(x) })
      s.setState({ arrasto: null })
    }
  })

  return Box({ width: '100%', height: '100%', children: [Text({ children: ' ' })] })
}

export default Trilha
