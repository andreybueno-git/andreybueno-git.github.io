// E3 — DECIDIR qual das quatro telas está valendo. Nenhuma requisição aqui.
//
// A tela tem quatro estados: carregando, sucesso, erro e vazio.
// Todos acontecem com usuários reais, e cada um produz uma tela diferente.
// Este módulo recebe o estado (e os dados, quando houver) e desenha.

import { renderizarTarefas } from './renderizacao.js';

// A região de status EXISTE no HTML desde o início, vazia, com
// role="status" e aria-live="polite". Como ela já está no documento quando
// o leitor de tela monta a árvore de acessibilidade, toda mudança de texto
// nela é anunciada. Se fosse criada só na hora do carregamento, o leitor
// não estaria "observando" e nada seria dito.
const regiaoDeStatus = document.getElementById('status');

// Cada tipo de falha vira um texto diferente. Distinguimos por erro.name:
//   TypeError   -> a rede falhou (offline, DNS, servidor fora): o fetch REJEITOU
//   HttpError   -> a rede funcionou mas o servidor disse não (404, 500):
//                  o fetch RESOLVEU e nós lançamos por causa do response.ok
//   SyntaxError -> chegou resposta, mas o corpo não é JSON válido ou não
//                  tem a forma esperada: falhou em resposta.json() ou na checagem
function mensagemDoErro(erro) {
  switch (erro && erro.name) {
    case 'TypeError':
      return 'Não foi possível conectar. Verifique sua internet e tente recarregar a página.';
    case 'HttpError':
      return `O servidor não conseguiu entregar as tarefas (${erro.message}) Tente novamente mais tarde.`;
    case 'SyntaxError':
      return 'Os dados chegaram, mas estão em um formato inválido. O arquivo de tarefas precisa ser corrigido.';
    default:
      return 'Algo deu errado ao carregar as tarefas.';
  }
}

function mostrar(texto, modificador) {
  // textContent: o texto é mostrado como texto, nunca interpretado como HTML.
  regiaoDeStatus.textContent = texto;
  regiaoDeStatus.className = modificador ? `status status--${modificador}` : 'status';
}

export function renderizarEstado(estado, dados) {
  switch (estado) {
    case 'carregando':
      mostrar('Carregando tarefas…', 'carregando');
      break;

    case 'sucesso':
      renderizarTarefas(dados);
      mostrar(`${dados.length} ${dados.length === 1 ? 'tarefa carregada' : 'tarefas carregadas'}.`, 'sucesso');
      break;

    case 'vazio':
      // Chegou aqui porque tarefas.length === 0, e não por um erro.
      // Lista vazia é uma resposta VÁLIDA: o servidor respondeu, o JSON é
      // bom, só não há tarefas. Tratar isso como falha seria mentir.
      renderizarTarefas([]);
      mostrar('Nenhuma tarefa cadastrada ainda. Quando houver, elas aparecem aqui.', 'vazio');
      break;

    case 'erro':
      mostrar(mensagemDoErro(dados), 'erro');
      break;

    default:
      mostrar('Estado desconhecido.', 'erro');
  }
}
