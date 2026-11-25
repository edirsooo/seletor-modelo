export type Esforco = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

declare module 'claude-code' {
  interface PluginState {
    'seletor-modelo': {
      /** modelo que a pessoa acabou de pedir na faixa; null = vale o do app */
      modelo: string | null
      /** esforço que a pessoa acabou de pedir na faixa; null = vale o do app */
      esforco: Esforco | null
      /** último esforço que o app realmente usou num pedido */
      esforcoVisto: Esforco | null
      /** tokens de entrada somados nesta conversa (com cache lido e gravado) */
      entrada: number
      /** tokens de saída somados nesta conversa */
      saida: number
      /** início da conversa que a soma conta; muda no /clear e zera a soma */
      desde: number | null
      /** chave Ultracode da faixa: true = cada pedido digitado sai com a palavra "ultracode" */
      ultra: boolean
    }
  }
}
