// E3 — ponto de entrada. Junta as peças, sem misturar responsabilidades:
//   api.js      obtém os dados      (não toca o DOM)
//   estados.js  desenha o estado    (não faz requisição)
//   este arquivo decide a ordem e trata o que der errado.
//
// Repare: dados.js NÃO é importado. A origem agora é a rede.

import { carregarTarefas } from './api.js';
import { renderizarEstado } from './estados.js';

// Sem await de nível superior: tudo acontece dentro de uma função.
async function iniciar() {
  // O estado de carregando é aplicado ANTES do await. Se viesse depois, a
  // tela ficaria em branco durante toda a espera pela rede, e numa conexão
  // lenta o usuário veria nada por segundos.
  renderizarEstado('carregando');

  try {
    const tarefas = await carregarTarefas();

    // Vazio NÃO é erro. Se o servidor devolveu uma lista sem itens, isso é
    // um resultado válido e merece a própria tela. Por isso a checagem fica
    // aqui, no caminho de sucesso, e não no catch.
    if (tarefas.length === 0) {
      renderizarEstado('vazio');
      return;
    }

    renderizarEstado('sucesso', tarefas);
  } catch (erro) {
    // Tudo que falhou de verdade cai aqui: rede (NetworkError), protocolo
    // (HttpError, lançado por nós quando response.ok é falso) e formato
    // (SyntaxError). Quem escolhe o texto por tipo é estados.js.
    console.error(erro);
    renderizarEstado('erro', erro);
  }
}

iniciar();
