// Aula 5 — DESENHAR os dados na tela.
//
// Esta função recebe um array de tarefas e monta os cartões nas colunas.
// Ela não sabe (nem precisa saber) DE ONDE o array veio: na aula 5 vinha
// de dados.js; na E3 vem de dados.json pela rede. Por isso ela não muda.
// Se fosse preciso mexer aqui para trocar a origem, o acoplamento estaria
// errado.

const NOMES_DOS_MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
                         'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const ROTULO_DA_PRIORIDADE = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

// "2026-08-26" -> "26 ago"
function formatarPrazo(isoData) {
  const [ano, mes, dia] = isoData.split('-').map(Number);
  return `${String(dia).padStart(2, '0')} ${NOMES_DOS_MESES[mes - 1]}`;
}

// Cria um elemento já com texto. textContent, nunca innerHTML:
// o dado vira texto na tela, jamais é interpretado como HTML.
function elemento(tag, texto, classe) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

function criarCartao(tarefa) {
  const artigo = elemento('article', undefined, 'cartao');

  const topo = elemento('div', undefined, 'cartao__topo');
  const titulo = elemento('h4', tarefa.titulo);
  titulo.title = tarefa.titulo;
  const etiqueta = elemento('span', ROTULO_DA_PRIORIDADE[tarefa.prioridade] || tarefa.prioridade,
                            `prioridade prioridade--${tarefa.prioridade}`);
  topo.append(titulo, etiqueta);

  const projeto = elemento('p', undefined, 'cartao__projeto');
  projeto.append(elemento('span', 'Projeto'), ` ${tarefa.projeto || ''}`);

  const responsavel = elemento('p', undefined, 'cartao__responsavel');
  responsavel.append(elemento('span', 'Responsável'), ` ${tarefa.responsavel || ''}`);

  const rodape = elemento('footer', undefined, 'cartao__rodape');
  const prazo = elemento('time', formatarPrazo(tarefa.prazo));
  prazo.dateTime = tarefa.prazo;
  rodape.append(prazo, elemento('span', tarefa.tipo || ''));

  artigo.append(topo, projeto, responsavel, rodape);

  const item = document.createElement('li');
  item.append(artigo);
  return item;
}

export function renderizarTarefas(tarefas) {
  const colunas = document.querySelectorAll('section.coluna');

  colunas.forEach(function (coluna) {
    const lista = coluna.querySelector('.coluna__tarefas');
    const doStatus = tarefas.filter(function (t) { return t.status === coluna.id; });

    lista.replaceChildren(...doStatus.map(criarCartao));

    coluna.querySelector('.coluna__quantidade').textContent = String(doStatus.length);
    coluna.querySelector('.somente-leitor').textContent =
      `${doStatus.length} ${doStatus.length === 1 ? 'tarefa' : 'tarefas'}`;
  });

  const total = document.getElementById('total-tarefas');
  if (total) total.textContent = `${tarefas.length} ${tarefas.length === 1 ? 'tarefa' : 'tarefas'}`;
}
