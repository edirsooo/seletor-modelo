import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { Esforco } from '../types'

// ─── Estado ─────────────────────────────────────────────────────────────────
// o que a pessoa acabou de pedir na faixa (some quando o app confirma)
const modelo = atom({ plugin: 'seletor-modelo', key: 'modelo' } as const, null)
const esforco = atom({ plugin: 'seletor-modelo', key: 'esforco' } as const, null)
// último esforço que o app realmente usou num pedido
const esforcoVisto = atom({ plugin: 'seletor-modelo', key: 'esforcoVisto' } as const, null)
// tokens desta conversa: entrada (com cache) e saída, somados a cada resposta
const entrada = atom({ plugin: 'seletor-modelo', key: 'entrada' } as const, 0)
const saida = atom({ plugin: 'seletor-modelo', key: 'saida' } as const, 0)
const desde = atom({ plugin: 'seletor-modelo', key: 'desde' } as const, null)
let custo: number | null = null

type Fatia = { rotulo: string; tokens: number }
type Contexto = { pct: number; usados: number; janela: number; fatias: Fatia[] }
let ctx: Contexto | null = null

// true = a faixa troca o modelo/esforço de verdade (/model e /effort), e a barra do app acompanha.
// false = o app não tem o comando; a faixa só força o valor em cada pedido.
let viaModelo = false
let viaEsforco = false

// Do mais forte para o mais leve
const MODELOS = [
  { id: 'claude-fable-5-2', curto: 'Fable', chave: 'fable' },
  { id: 'claude-opus-5-5', curto: 'Opus', chave: 'opus' },
  { id: 'claude-sonnet-5-5', curto: 'Sonnet', chave: 'sonnet' },
  { id: 'claude-haiku-5-5', curto: 'Haiku', chave: 'haiku' },
] as const

const NIVEIS: { id: Esforco; nome: string }[] = [
  { id: 'low', nome: 'Low' },
  { id: 'medium', nome: 'Medium' },
  { id: 'high', nome: 'High' },
  { id: 'xhigh', nome: 'X-High' },
  { id: 'max', nome: 'Max' },
]
const ULTIMO = NIVEIS.length - 1

const AZUL = '#4d8df0'
const AZUL_CLARO = '#6c9bff'
const ROXO = '#a78bfa'
const VERDE = '#3fcf9b'
const AMBAR = '#f2b04a'
const ROSA = '#f0728a'
const VERMELHO = '#f06464'

const qualModelo = (s: string) => MODELOS.findIndex(x => s.toLowerCase().includes(x.chave))

// 1.234.567 → "1,2M"; 224.900 → "225k"
const curto = (n: number) =>
  n >= 1_000_000
    ? `${String(+(n / 1_000_000).toFixed(1)).replace('.', ',')}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}k`
      : String(n)

// ─── Desenhos (SVG): barra redonda do contexto e trilha do esforço ──────────
const CABECA = (w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`

function svgContexto(c: Contexto, tom: string, W: number, H: number): string {
  const tok = (nome: string) => c.fatias.find(f => f.rotulo === nome)?.tokens ?? 0
  const escala = W / Math.max(1, c.janela)
  const cores: [string, string][] = [
    ['Instruções', AZUL_CLARO],
    ['Ferramentas', ROXO],
    ['Conversa', tom],
  ]
  let x = 0
  let partes = ''
  for (const [nome, cor] of cores) {
    const t = tok(nome)
    if (t <= 0) continue
    const w = Math.max(3, t * escala)
    partes += `<rect x="${x.toFixed(1)}" y="0" width="${Math.max(1.5, w - 1.5).toFixed(1)}" height="${H}" fill="${cor}"/>`
    x += w
  }
  const wr = tok('Reserva') * escala
  const reserva =
    wr > 0 ? `<rect x="${(W - wr).toFixed(1)}" y="0" width="${wr.toFixed(1)}" height="${H}" fill="#9a9aa4" fill-opacity="0.5"/>` : ''
  return (
    CABECA(W, H) +
    `<defs><clipPath id="p"><rect width="${W}" height="${H}" rx="${H / 2}"/></clipPath></defs>` +
    `<rect width="${W}" height="${H}" rx="${H / 2}" fill="#808080" fill-opacity="0.28"/>` +
    `<g clip-path="url(#p)">${partes}${reserva}</g></svg>`
  )
}

function svgEsforco(pos: number, W: number, H: number): string {
  const pad = 11
  const y = H / 2
  const cx = (i: number) => pad + (i * (W - 2 * pad)) / ULTIMO
  const trilha = `<line x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}" stroke="#808080" stroke-opacity="0.35" stroke-width="4" stroke-linecap="round"/>`
  const cheio =
    pos > 0 ? `<line x1="${pad}" y1="${y}" x2="${cx(pos)}" y2="${y}" stroke="${AZUL}" stroke-width="4" stroke-linecap="round"/>` : ''
  const pontos = NIVEIS.map((_, i) =>
    i === pos
      ? ''
      : `<circle cx="${cx(i)}" cy="${y}" r="2.5" fill="${i < pos ? '#ffffff' : '#808080'}" fill-opacity="${i < pos ? 0.9 : 0.7}"/>`,
  ).join('')
  const bola = pos >= 0 ? `<circle cx="${cx(pos)}" cy="${y}" r="7.5" fill="#ffffff" stroke="${AZUL}" stroke-width="3"/>` : ''
  return CABECA(W, H) + trilha + cheio + pontos + bola + '</svg>'
}

// Painel de tokens numa linha só, com largura calculada pelo texto (nunca quebra)
type Parte = { texto: string; cor: string; forte?: boolean }
const FONTE = `font-family="Segoe UI, system-ui, -apple-system, sans-serif" font-size="12"`
const escapa = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const largura = (s: string) => Math.ceil(s.length * 6.6)

function svgPainel(partes: Parte[], H: number): { svg: string; W: number } {
  const padX = 9
  const vao = 13
  let x = padX
  let corpo = ''
  partes.forEach((p, i) => {
    if (i > 0) {
      const sx = x - vao / 2
      corpo += `<line x1="${sx}" y1="${H * 0.28}" x2="${sx}" y2="${H * 0.72}" stroke="#ffffff" stroke-opacity="0.14"/>`
    }
    corpo += `<text x="${x}" y="${H / 2}" dominant-baseline="central" ${FONTE} fill="${p.cor}"${p.forte ? ' font-weight="600"' : ''}>${escapa(p.texto)}</text>`
    x += largura(p.texto) + vao
  })
  const W = Math.round(x - vao + padX)
  return {
    W,
    svg:
      CABECA(W, H) +
      `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${(H - 1) / 2}" fill="#1c1c1f" stroke="#3a3a3f"/>` +
      corpo +
      '</svg>',
  }
}

// Para telas sem SVG (terminal): a mesma ideia em texto
const barraTexto = (pct: number, larg: number) => {
  const cheio = Math.max(0, Math.min(larg, Math.round((pct / 100) * larg)))
  return '█'.repeat(cheio) + '░'.repeat(larg - cheio)
}
const trilhaTexto = (pos: number) => NIVEIS.map((_, i) => (i === pos ? '●' : i < pos ? '━' : '─')).join('──')

// ─── Contexto: mesma conta da antiga Context Bar ────────────────────────────
const BALDES = ['Instruções', 'Ferramentas', 'Conversa', 'Reserva', 'Livre']

async function mede($: EngineInterface) {
  try {
    const { context, cost, startedAt } = await $.session.usage({ breakdown: 'summary' })
    custo = cost?.usd ?? null
    // conversa nova (/clear): a soma de entrada e saída recomeça
    if ((await read($, desde)) !== startedAt) {
      await update($, desde, () => startedAt)
      await update($, entrada, () => 0)
      await update($, saida, () => 0)
    }
    const b = context.breakdown
    if (b === undefined) return
    const soma = new Map<string, number>()
    for (const c of b.categories) {
      if (c.kind === 'deferred' || c.tokens <= 0) continue
      const balde =
        c.kind === 'free' ? 'Livre' : c.kind === 'buffer' ? 'Reserva' : /tool/i.test(c.name) ? 'Ferramentas' : /message/i.test(c.name) ? 'Conversa' : 'Instruções'
      soma.set(balde, (soma.get(balde) ?? 0) + c.tokens)
    }
    ctx = {
      pct: b.percentage,
      usados: b.totalTokens,
      janela: b.rawMaxTokens,
      fatias: BALDES.flatMap(rotulo => {
        const tokens = soma.get(rotulo)
        return tokens === undefined ? [] : [{ rotulo, tokens }]
      }),
    }
    $.ui.invalidate('ui.render')
  } catch {
    // sem números ainda
  }
}

// ─── Registro ───────────────────────────────────────────────────────────────
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    // começa limpo: nada de pedido antigo valendo por baixo dos panos
    await update($, modelo, () => null)
    await update($, esforco, () => null)
    try {
      const nomes = new Set((await $.command.list()).map(c => c.name))
      viaModelo = nomes.has('model')
      viaEsforco = nomes.has('effort')
    } catch {
      // sem a lista, a faixa fica no modo de forçar o valor em cada pedido
    }
    void mede($)
    return r
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    if (e.changed.includes('context')) await mede($)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    // soma os tokens da resposta da conversa principal
    const u = e.agentId === undefined ? e.usage : undefined
    if (u !== undefined) {
      const ent = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
      await update($, entrada, n => (n ?? 0) + ent)
      await update($, saida, n => (n ?? 0) + u.output_tokens)
    }
    // o app já tem o valor real: o pedido otimista pode sair
    if (viaModelo) await update($, modelo, () => null)
    if (viaEsforco) await update($, esforco, () => null)
    await mede($)
    return r
  })

  // Guarda o esforço que o app realmente usa; e, se o app não tem /model ou /effort, força o valor pedido
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const [m, n] = await Promise.all([read($, modelo), read($, esforco)])
    const forcaM = !viaModelo ? m : null
    const forcaN = !viaEsforco ? n : null
    const emUso = forcaN ?? (typeof e.effort === 'string' ? e.effort : null)
    if (emUso !== null && NIVEIS.some(x => x.id === emUso) && (await read($, esforcoVisto)) !== emUso) {
      await update($, esforcoVisto, () => emUso as Esforco)
    }
    if (forcaM === null && forcaN === null) return yield* next(e)
    return yield* next({ ...e, ...(forcaM !== null ? { model: forcaM } : {}), ...(forcaN !== null ? { effort: forcaN } : {}) })
  })

  // Esconde a antiga barra de contexto (agora está aqui dentro) e põe esta faixa no topo
  on('ui.render', { component: 'AbovePromptList' }, async ($, e, next) => {
    const linhas = e.props.rows.filter(r => r.plugin !== 'context-bar')
    const minha = linhas.filter(r => r.plugin === 'seletor-modelo')
    const outras = linhas.filter(r => r.plugin !== 'seletor-modelo')
    return next({ ...e, props: { ...e.props, rows: [...minha, ...outras] } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const Svg = e.surface === 'desktop' ? ($.ui.resolve(e) as Elements['desktop']).Svg : undefined

    const [pedM, pedN, visto, real, ent, sai] = await Promise.all([
      read($, modelo),
      read($, esforco),
      read($, esforcoVisto),
      $.session.model().catch(() => ''),
      read($, entrada),
      read($, saida),
    ])
    const iModelo = qualModelo(pedM ?? real)
    const nivel: Esforco | null = pedN ?? visto
    const pos = nivel === null ? -1 : NIVEIS.findIndex(x => x.id === nivel)
    const partes: Parte[] =
      ctx === null
        ? []
        : [
            { texto: `${curto(ctx.usados)}/${curto(ctx.janela)}`, cor: '#e6e6e8', forte: true },
            { texto: `↓${curto(ent)}`, cor: VERDE },
            { texto: `↑${curto(sai)}`, cor: VERMELHO },
            ...(custo !== null ? [{ texto: `$${custo.toFixed(2).replace('.', ',')}`, cor: '#9a9aa4' }] : []),
          ]
    const painel = partes.length > 0 ? svgPainel(partes, 22) : null
    const tom = ctx === null ? '#808080' : ctx.pct >= 85 ? ROSA : ctx.pct >= 65 ? AMBAR : VERDE

    // Troca o modelo de verdade (/model); a barra do app acompanha
    const escolheModelo = async (id: string) => {
      await update($, modelo, () => id)
      if (!viaModelo) return
      try {
        await $.command.run({ command: 'model', args: id })
        if (qualModelo(await $.session.model()) === qualModelo(id)) await update($, modelo, () => null)
      } catch {
        $.ui.toast('Não consegui trocar o modelo')
        await update($, modelo, () => null)
      }
    }

    // Sobe ou desce um nível de esforço (/effort); sem nível conhecido, parte do High
    const anda = async (passo: number) => {
      const atual = pos >= 0 ? pos : 2
      const alvo = NIVEIS[Math.min(ULTIMO, Math.max(0, atual + passo))]!.id
      if (alvo === nivel) return
      await update($, esforco, () => alvo)
      if (!viaEsforco) return
      try {
        await $.command.run({ command: 'effort', args: alvo })
        await update($, esforcoVisto, () => alvo)
        await update($, esforco, () => null)
      } catch {
        $.ui.toast('Não consegui trocar o esforço')
        await update($, esforco, () => null)
      }
    }

    // Roda um comando do app como se fosse digitado (/compact, /clear)
    const roda = async (comando: string) => {
      try {
        await $.command.run({ command: comando })
      } catch {
        $.ui.toast(`Não consegui rodar /${comando}`)
      }
    }

    // Duas colunas: à esquerda as duas linhas (contexto; modelo e esforço), à direita Limpar sobre Compactar.
    // Tela estreita (janela pequena, monitor vertical): a coluna da esquerda encolhe e cada linha quebra
    // em blocos inteiros (barra+%, painel, modelos, esforço), sem partir nenhum; os botões ficam à direita.
    return (
      <Box flexDirection="row" alignItems="center" columnGap={3}>
      <Box flexDirection="column" rowGap={1} flexGrow={1} flexShrink={1}>
        {/* Linha 1: contexto, uma barra redonda e simples */}
        {ctx !== null && (
          <Box flexDirection="row" alignItems="center" flexWrap="wrap" columnGap={2} rowGap={1}>
            <Box flexDirection="row" alignItems="center" columnGap={2} flexShrink={0}>
              <Text dimColor size="footnote">
                Contexto
              </Text>
              {Svg !== undefined ? (
                <Svg source={svgContexto(ctx, tom, 150, 8)} alt={`Contexto em ${ctx.pct}%`} width={150} height={8} />
              ) : (
                <Text color={tom}>{barraTexto(ctx.pct, 20)}</Text>
              )}
              <Text color={tom} weight="semibold" tabular>
                {`${ctx.pct}%`}
              </Text>
            </Box>
            {/* Painelzinho: uso da janela, entrada (verde), saída (vermelho) e custo */}
            {Svg !== undefined && painel !== null ? (
              <Svg source={painel.svg} alt={partes.map(p => p.texto).join(' · ')} width={painel.W} height={22} />
            ) : (
              <Text dimColor wrap="truncate">
                {partes.map(p => p.texto).join(' · ')}
              </Text>
            )}
          </Box>
        )}

        {/* Linha 2: modelo e esforço */}
        <Box flexDirection="row" alignItems="center" flexWrap="wrap" columnGap={3} rowGap={1}>
          <Box flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
            {MODELOS.map((x, i) => (
              <Button
                key={`m-${x.id}`}
                label={x.curto}
                variant={i === iModelo ? 'primary' : 'secondary'}
                onPress={() => void escolheModelo(x.id)}
              />
            ))}
          </Box>

          <Box flexDirection="row" alignItems="center" columnGap={2} flexShrink={0}>
            <Text dimColor size="footnote">
              Esforço
            </Text>
            <Button key="e-menos" label="−" dimColor={pos === 0} onPress={() => void anda(-1)} />
            {Svg !== undefined ? (
              <Svg source={svgEsforco(pos, 130, 22)} alt={`Esforço ${pos >= 0 ? NIVEIS[pos]!.nome : 'do app'}`} width={130} height={22} />
            ) : (
              <Text color={AZUL}>{trilhaTexto(pos)}</Text>
            )}
            <Button key="e-mais" label="+" dimColor={pos === ULTIMO} onPress={() => void anda(1)} />
            <Box width={8}>
              <Text weight="semibold">{pos >= 0 ? NIVEIS[pos]!.nome : 'auto'}</Text>
            </Box>
          </Box>
        </Box>
      </Box>

      <Box flexDirection="column" alignItems="flex-end" rowGap={1} flexShrink={0}>
        <Button key="c-limpar" label="Limpar" onPress={() => void roda('clear')} />
        <Button key="c-compactar" label="Compactar" onPress={() => void roda('compact')} />
      </Box>
      </Box>
    )
  })
}
