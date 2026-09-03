// E3 — OBTER os dados. Só isso. Nenhuma linha aqui toca o DOM.
//
// Responsabilidade única: buscar dados.json pela rede, verificar se a
// resposta presta, e devolver o array de tarefas. Quem decide o que
// mostrar na tela é outro módulo (estados.js).

export async function carregarTarefas() {
  // Caminho RELATIVO: o arquivo está na mesma origem da página.
  // Esta é a primeira espera: a promessa do fetch resolve quando os
  // CABEÇALHOS chegam, não quando o corpo inteiro foi baixado.
  //
  // O único caso em que o fetch REJEITA é falha de rede (offline, DNS,
  // servidor fora), e ele faz isso com um TypeError genérico. Damos ao
  // erro um nome próprio para a tela saber que foi a REDE, sem confundir
  // com qualquer outro TypeError vindo de um bug no código.
  let resposta;
  try {
    resposta = await fetch('dados.json');
  } catch (falhaDeRede) {
    const erro = new Error('Não houve resposta do servidor.', { cause: falhaDeRede });
    erro.name = 'NetworkError';
    throw erro;
  }

  // fetch NÃO rejeita em 404 ou 500. Para ele, a rede funcionou: houve
  // resposta. Quem diz se o conteúdo é bom é o response.ok (status 200-299).
  // Por isso a verificação vem ANTES de ler o corpo, e quando falha a
  // gente lança um erro com o status, para a tela saber o que aconteceu.
  if (!resposta.ok) {
    const erro = new Error(`O servidor respondeu com o status ${resposta.status}.`);
    erro.name = 'HttpError';
    erro.status = resposta.status;
    throw erro;
  }

  // Segunda espera: agora sim o corpo é baixado e interpretado como JSON.
  // Se o texto não for JSON válido, .json() rejeita com SyntaxError.
  const json = await resposta.json();

  // O documento raiz precisa ser um objeto com a chave "tarefas" contendo
  // um array. JSON válido com a forma errada também é problema de FORMATO,
  // então tratamos com o mesmo tipo de erro.
  if (!json || typeof json !== 'object' || !Array.isArray(json.tarefas)) {
    throw new SyntaxError('O JSON não tem a chave "tarefas" com um array.');
  }

  return json.tarefas;
}
