# E2 — Layout responsivo com Flexbox e Grid

Entrega sem JavaScript, construída em HTML semântico e CSS externo.

## Como abrir

Abra `index.html` no navegador. Não há etapa de instalação ou build.

## Decisões principais

- CSS mobile-first: a base tem uma coluna, sem media query.
- Aos `42rem`, o conteúdo permite duas colunas sem comprimir os cartões.
- Aos `75rem`, as quatro etapas passam a caber lado a lado.
- O quadro usa Grid; colunas, cartões e seus conteúdos usam Flexbox.
- A estrutura da E1 foi preservada: busca, filtros rotulados, `fieldset`, `legend`, `ul`, `li`, `section` e `article`.
- Os títulos têm `min-width: 0`, `overflow: hidden` e `text-overflow: ellipsis`.
- As animações são apenas CSS e são reduzidas quando o usuário ativa `prefers-reduced-motion`.
- Foco visível, link de salto, alvos de navegação maiores que 24px e cores de alto contraste foram incluídos.

## Checklist da entrega

- `styles.css` externo e ligado por `<link>`
- Sem `<style>`, atributo `style` ou JavaScript
- `box-sizing: border-box` universal
- Propriedades personalizadas no `:root` e cores de status reutilizadas
- Grid no quadro, Flexbox nas colunas e cartões
- `gap` para espaçamento entre itens
- Meta viewport acessível
- `clamp()` combinando `rem` e `vw`
- Breakpoints com comentários e justificativas
- Layout verificado no navegador em 320px, 768px, 1440px e 1920px, sem rolagem horizontal
