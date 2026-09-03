# Plano de Estudos — E3: consumo de dados com `fetch` e os quatro estados da tela

Terceira etapa do gerenciador de tarefas acadêmicas. Parte do projeto da E2 e troca a origem dos dados: sai o array escrito em `js/dados.js`, entra o arquivo `dados.json` carregado pela rede com `fetch`.

## Como abrir

Precisa ser servido por HTTP (não por `file:`), porque `fetch` e módulos ES não funcionam abrindo o arquivo direto.

```bash
cd e3-fetch
python3 -m http.server 8000
```

Depois abrir `http://localhost:8000` no navegador.

## Estrutura

```
e3-fetch/
├── index.html          região de status vazia + <script type="module" src="js/main.js">
├── styles.css          E2 + estilos dos quatro estados
├── dados.json          { "tarefas": [ ... 9 tarefas ... ] }
└── js/
    ├── main.js         ponto de entrada: ordem e tratamento de erro
    ├── api.js          OBTER: carregarTarefas() — fetch, response.ok, json. Não toca o DOM.
    ├── estados.js      DESENHAR O ESTADO: renderizarEstado(estado, dados). Não faz requisição.
    ├── renderizacao.js DESENHAR OS DADOS: renderizarTarefas(tarefas). Igual à aula 5.
    └── dados.js        array da aula 5/6. Continua no repositório; não é mais importado.
```

## Os quatro estados

| Estado | Quando | O que aparece |
|---|---|---|
| carregando | antes do `await`, enquanto a rede responde | "Carregando tarefas…" |
| sucesso | array com itens | os cartões + "N tarefas carregadas." |
| vazio | `tarefas.length === 0` | "Nenhuma tarefa cadastrada ainda…" |
| erro | qualquer exceção no `try` | mensagem diferente por tipo de falha |

Os três tipos de erro produzem textos distintos, decididos por `erro.name` em `estados.js`:

| Tipo | Como acontece | `erro.name` |
|---|---|---|
| rede | offline, DNS, servidor fora. O `fetch` **rejeita** com `TypeError`; `api.js` dá ao erro um nome próprio. | `NetworkError` |
| protocolo | servidor respondeu 404/500. O `fetch` **resolve**; nós lançamos ao ver `!response.ok`. | `HttpError` |
| formato | corpo não é JSON válido, ou não tem a chave `tarefas`. | `SyntaxError` |

## Decisões

- **`response.ok` antes do corpo.** `fetch` não rejeita em 404: para ele a rede funcionou. Só o status diz se o conteúdo presta. Por isso a checagem vem antes de `resposta.json()`, e lança um erro com o status.
- **Duas esperas.** A primeira (`await fetch`) resolve quando os cabeçalhos chegam. A segunda (`await resposta.json()`) baixa e interpreta o corpo. São dois momentos diferentes da rede.
- **Carregando antes do `await`.** Se viesse depois, a tela ficaria em branco durante toda a espera.
- **Vazio fora do `catch`.** Lista vazia é uma resposta válida, não uma falha. Ela é detectada no caminho de sucesso, por `length === 0`.
- **Região de status pré-existente.** O `<p role="status" aria-live="polite">` está no HTML desde o início, vazio. Assim o leitor de tela já a observa quando o texto muda. Se fosse criada só na hora, nada seria anunciado. Por isso o CSS não usa `display: none` na região vazia (isso a tiraria da árvore de acessibilidade); só remove a caixa.
- **Erro de rede com nome próprio.** O `fetch` rejeita com um `TypeError` genérico. `api.js` o captura e relança como `NetworkError`; assim um `TypeError` causado por bug no código não é apresentado como "sua internet caiu": cai no texto genérico.
- **Estado de erro zera o quadro.** Antes da mensagem, `renderizarTarefas([])` deixa contadores e colunas coerentes com o que a tela diz.
- **`textContent`, nunca `innerHTML`.** Todo texto, inclusive o que vem do JSON, entra como texto. Nada é interpretado como HTML.
- **`renderizacao.js` não mudou.** Ele recebe um array e desenha; não sabe de onde o array veio. Trocar a origem não exigiu tocar nele: esse é o acoplamento resolvido.
- **Sem `await` de nível superior.** A inicialização acontece dentro de `iniciar()`.

## Fora do escopo desta entrega

Busca e filtros continuam existindo na tela, mas não operam. Cadastro/edição, estado centralizado e botão de tentar novamente ficam para as próximas etapas.

## Como verificar

1. **Carregando:** DevTools → Network → throttling `Slow 4G` → recarregar. A mensagem de carregamento aparece antes dos cartões.
2. **Vazio:** apontar `api.js` temporariamente para um arquivo com `{"tarefas": []}`.
3. **404:** apontar para um caminho que não existe. Deve mostrar a mensagem de protocolo, com o status.
4. **Offline:** DevTools → Network → `Offline` → recarregar. Mensagem diferente da do 404.
5. **JSON quebrado:** vírgula sobrando no array → mensagem de formato, não de rede.
6. **Região viva:** DevTools → Elements, antes de qualquer interação: `#status` existe e está vazio.
7. **Acoplamento:** `renderizacao.js` é o mesmo da aula 5.
