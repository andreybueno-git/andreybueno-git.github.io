/*
 * desktop.js — AndreyOS 24, o desktop que aparece na tela do PC antigo.
 *
 * Contrato (SPEC.md):
 *   AndreyDesktop.create(rootEl, { onTour(stop), onEvent(kind, detail), onExpandRequest() }) -> api
 *   api.el                 raiz 1024×768 (um <div> NOVO criado dentro de rootEl)
 *   api.setVisible(bool)   ao esconder: pausa o jogo, para timers, tira o foco
 *   api.openApp(id)        'sobre' | 'projetos' | 'arcade' | 'terminal' | 'temas' | 'lixeira'
 *                          (aceita também 'blocos', 'zumbis', 'mundo', 'arcade:<jogo>',
 *                          'sobre_mim.txt' e 'proj:<id>'; os jogos abrem o Arcade já no jogo:
 *                          BLOCOS e MINI MUNDO jogando, o ZUMBIS na tela de título)
 *   api.closeApp(id)
 *   api.setTheme(name)     'sistema' | 'grafite' | 'classico' | 'ambar' | 'fosforo' | 'noite' (não emite evento)
 *   api.getTheme()         tema atual (o padrão é 'sistema'; a escolha da pessoa fica no localStorage)
 *
 * Tema 'sistema' (padrão): Mac clássico em preto, branco e cinza. A barra de tarefas vira uma
 * barra de menus no topo (MENU_H px): o menu AndreyOS (cabeça do guará) faz o papel do Iniciar
 * e Arquivo lista as janelas abertas, inclusive as minimizadas (não há botões de janela).
 * Janelas, ícones e erros começam abaixo dessa barra.
 *   api.typeKey(key)       tecla vinda de fora; vai para o app ativo; retorna true se usou
 *   api.setExpanded(bool)  só troca classes; o integrador move o nó e cuida do transform
 *   api.dispose()
 *
 * Eventos em onEvent(kind, detail):
 *   'open' {app} · 'close' {app} · 'minimize' {app} · 'theme' name · 'shutdown'
 *   'key' {key, app} · 'error' {source} · 'pane' {count} · 'fix' {count}
 *   'record' {score, game} · 'command' {command} · 'link' {id, url} · 'capi' {visible}
 *   'blocos' {kind, detail} · 'zumbis' {kind, detail} · 'mundo' {kind, detail}
 *
 * Jogos do Arcade (BLOCOS, NOITE DOS ZUMBIS, MINI MUNDO): todos seguem o contrato do
 * AndreyBlocos (SPEC.md) e moram, um por vez, no gamehost da janela Arcade. Trocar de
 * cartucho faz dispose do anterior; "‹ Cartuchos" só esconde (o mesmo cartucho continua
 * de onde parou, pausado). Cada aviso do jogo sai daqui com o nome do cartucho como kind
 * do desktop e o aviso original dentro, para o integrador da página tocar os sons:
 *   'blocos' kind: 'start' | 'line' | 'level' | 'gameover' | 'record' | 'pause' | 'resume'
 *   'zumbis' kind: 'start' | 'wave' | 'shot' | 'hit' | 'hurt' | 'pickup' | 'reload' | 'empty' |
 *                  'gameover' | 'record' | 'pause' | 'resume'
 *   'mundo'  kind: 'start' | 'place' | 'break' | 'pick' | 'daynight' | 'reset' | 'pause' | 'resume' | 'save'
 *   (o detail é o do próprio jogo; ver o cabeçalho de blocos.js, zumbis.js e mundo.js)
 * Além do repasse, 'record' {score, game} sai sempre que BLOCOS ou ZUMBIS batem recorde
 * (game: 'blocos' | 'zumbis'). O MINI MUNDO não tem placar.
 *
 * A raiz recebe transform: matrix3d(...) do integrador para colar na tela 3D.
 * Por isso o arrasto de janelas converte o ponteiro para coordenadas do desktop
 * invertendo essa homografia (desktopPoint).
 *
 * Se o integrador esconder a raiz com style.visibility = 'hidden' (tela fora da vista)
 * por mais de 400 ms, o desktop se comporta como na aba oculta: o jogo do Arcade pausa, os
 * timers param e o foco sai. Volta sozinho quando a raiz fica visível de novo.
 */
(function (global) {
  'use strict';

  const doc = global.document;
  const W = 1024;
  const H = 768;
  const TASK_H = 48;
  const AREA_H = H - TASK_H;
  const MENU_H = 28;          // barra de menus do tema sistema (no topo, no lugar da barra de tarefas)
  const LOG_MAX = 240;
  const INPUT_MAX = 120;
  const THEME_KEY = 'andreyos.tema';
  const DEFAULT_THEME = 'sistema';
  const IDLE_MS = 30000;
  let seq = 0;

  /* ------------------------------------------------------------------ */
  /* Conteúdo                                                            */
  /* ------------------------------------------------------------------ */

  const THEMES = {
    sistema: { nome: 'Sistema', desc: 'preto e branco, menus no topo' },
    grafite: { nome: 'Grafite', desc: 'escuro e limpo, com luz de guará' },
    classico: { nome: 'Clássico', desc: 'verde-azulado retrô de 1995' },
    ambar: { nome: 'Âmbar', desc: 'âmbar sobre preto' },
    fosforo: { nome: 'Fósforo', desc: 'verde de terminal antigo' },
    noite: { nome: 'Noite', desc: 'azul de madrugada' }
  };
  const THEME_ORDER = ['sistema', 'grafite', 'classico', 'ambar', 'fosforo', 'noite'];

  // Tamanhos fixos em px da superfície 1024×768 (área útil 1024×720).
  const APPS = {
    sobre: { title: 'sobre_mim.txt', menu: 'Sobre mim', icon: 'doc', w: 600, h: 440, x: 196, y: 48 },
    projetos: { title: 'Projetos', menu: 'Projetos', icon: 'folder', w: 720, h: 600, x: 176, y: 26 },
    arcade: { title: 'Arcade', menu: 'Arcade', icon: 'joy', w: 840, h: 690, x: 150, y: 14 },
    terminal: { title: 'Terminal', menu: 'Terminal', icon: 'term', w: 740, h: 510, x: 252, y: 58 },
    temas: { title: 'Temas', menu: 'Temas', icon: 'palette', w: 660, h: 520, x: 240, y: 30 },
    lixeira: { title: 'Lixeira', menu: 'Lixeira', icon: 'trash', w: 620, h: 486, x: 300, y: 110 }
  };
  const APP_ORDER = ['sobre', 'projetos', 'arcade', 'terminal', 'temas', 'lixeira'];

  // Cartuchos do Arcade. lib é o global que o script do jogo cria (index.html carrega os três
  // antes do desktop); recorde é a chave do placar no localStorage (null = jogo sem placar).
  // dica aparece embaixo dos cartuchos quando a pessoa aponta ou foca um deles.
  const GAMES = {
    blocos: { nome: 'BLOCOS', lib: 'AndreyBlocos', recorde: 'andreyos.blocos.recorde',
      linha: 'Encaixe as peças e limpe as linhas.', dica: 'BLOCOS: setas movem e giram, Espaço derruba, C guarda, P pausa.' },
    // titulo: true = monta o cartucho sem start(); a tela de título (controles e "toque para começar")
    // espera o clique, o Enter ou o toque da pessoa.
    zumbis: { nome: 'NOITE DOS ZUMBIS', lib: 'AndreyZumbis', recorde: 'andreyos.zumbis.recorde', titulo: true,
      linha: 'Segure o quintal, onda após onda.', dica: 'ZUMBIS: WASD anda, o mouse mira, clique ou Espaço atira, R recarrega.' },
    mundo: { nome: 'MINI MUNDO', lib: 'AndreyMundo', recorde: null,
      linha: 'Construa na ilha. Fica tudo salvo.', linhaSemSalvar: 'Construa na ilha. Aqui não fica salvo.', dica: 'MINI MUNDO: clique põe, botão direito tira, arraste gira, N vira noite.' }
  };
  const GAME_ORDER = ['blocos', 'zumbis', 'mundo'];
  const ARCADE_MSG = 'Escolha um cartucho. Os controles de cada um aparecem aqui.';
  function isGame(id) { return typeof id === 'string' && Object.prototype.hasOwnProperty.call(GAMES, id); }

  const PROJETOS = [
    { id: 'vereda', nome: 'Vereda', linha: 'apresentação 3D do ciclo de vida', ano: 2026, url: 'https://andreybueno-git.github.io/vereda-ciclo-de-vida/', alias: ['vereda', 'ciclo', 'ciclodevida', 'veredaciclo', 'veredaciclodevida', 'luminaria', 'lamp'] },
    { id: 'vereda-plano', nome: 'Vereda', linha: 'plano de negócio', ano: 2026, url: 'https://andreybueno-git.github.io/vereda-apresentacao/', alias: ['veredaplano', 'plano', 'planodenegocio', 'veredaapresentacao', 'negocio'] },
    { id: 'g2', nome: 'Projeto G2', linha: 'kanban em Svelte', ano: 2026, url: 'https://andreybueno-git.github.io/projeto-g2-frontend/marco-3/', alias: ['g2', 'projetog2', 'kanban', 'svelte', 'projetog2frontend'] },
    { id: 'metadados', nome: 'Metadados Zero', linha: 'removedor de metadados de fotos', ano: 2026, url: 'https://andreybueno-git.github.io/metadados-zero/', alias: ['metadados', 'metadadoszero', 'camera', 'foto', 'fotos'] },
    { id: 'flashclip', nome: 'FlashClip Natal', linha: 'propostas natalinas com globo 3D', ano: 2026, url: 'https://andreybueno-git.github.io/flashclip-natal/', alias: ['flashclip', 'flashclipnatal', 'flash', 'natal', 'globo', 'globodeneve', 'snow'] },
    { id: 'prolog', nome: 'Paradigmas: Prolog', linha: 'paradigma lógico com sistema especialista', ano: 2026, url: 'https://andreybueno-git.github.io/paradigmas-prolog/', alias: ['prolog', 'paradigmas', 'paradigma', 'paradigmasprolog', 'livro', 'book'] },
    { id: 'front-end', nome: 'Front-end E1–E3', linha: 'HTML, CSS responsivo e fetch', ano: 2026, url: 'https://andreybueno-git.github.io/e3-fetch/', alias: ['frontend', 'front', 'caderno', 'e1', 'e2', 'e3', 'azul'] },
    { id: 'mibilisq', nome: 'Mibilisq', linha: 'vitrine sem glúten', ano: 2026, url: 'https://andreybueno-git.github.io/mibilisq/', alias: ['mibilisq', 'semgluten', 'vitrine'] },
    { id: 'festejo', nome: 'festejo-app', linha: 'controle de embalagens do festejo', ano: 2026, url: 'https://festejo-app.vercel.app', alias: ['festejo', 'festejoapp', 'caixa', 'box'] },
    { id: 'loja', nome: 'Vereda: a loja', linha: 'luminárias impressas em 3D, Palmas (TO)', ano: 2026, url: 'https://veredacerrado.com/', alias: ['loja', 'veredaloja', 'veredacerrado', 'luminarias'] },
    { id: 'kage', nome: 'Kage no Toki', linha: 'protótipo de jogo samurai em 3D', ano: 2026, url: 'https://brave-vapor-292.higgsfield.gg/', alias: ['kage', 'kagenotoki', 'samurai', 'katana'] },
    { id: 'tudo-tem-preco', nome: 'Tudo Tem Preço', linha: 'simulador de mercadinho em Unity', ano: 2026, url: 'https://github.com/andreybueno-git/MercadoFinal', alias: ['tudotempreco', 'tudo', 'mercado', 'mercadofinal', 'unity', 'cartucho', 'jogo'] },
    { id: 'pecas', nome: 'Peças impressas em 3D', linha: 'luminárias, letras bolha e medalhas', ano: 2026, url: 'https://veredacerrado.com/personalizaveis/letras-bolha', alias: ['pecas', 'pecas3d', 'impressao', 'letras', 'letrasbolha', 'medalha'] }
  ];

  const TOUR = { mesa: 'desk', estante: 'shelf', mural: 'board', janela: 'window', tela: 'screen', porta: 'door' };
  const TOUR_NOME = { mesa: 'a mesa', estante: 'a estante', mural: 'o mural', janela: 'a janela', tela: 'a tela', porta: 'a porta' };

  const LIXO = [
    { nome: 'ola_mundo_v1_FINAL_agora_vai.js', tam: '1 KB', txt: '// versão final. agora vai.\n// (já foi a versão final 6 vezes)\nconsole.log("ola mundo")\nconsole.log("ola mundo!!") // mais animado' },
    { nome: 'calculadora_que_so_soma.py', tam: '1 KB', txt: 'def calcular(a, b):\n    return a + b  # subtrair fica pra v2\n\nprint(calcular(2, 2))  # 4. confia.' },
    { nome: 'site_com_marquee.html', tam: '2 KB', txt: '<marquee>BEM-VINDO AO MEU SITE</marquee>\n<p>em construção desde sempre</p>\n<!-- não mexer: funciona e ninguém sabe por quê -->' }
  ];

  const PANE = [
    'Erro 0xCAFE: café insuficiente para continuar.',
    'guara.exe saiu atrás de fruta-do-lobo. Deseja esperar?',
    'Memória cheia de ideias. Feche um caderno e tente de novo.',
    'O disquete A: está com saudade. Ninguém usa ele desde 1998.',
    'Erro 404: produtividade não encontrada.',
    'Pressione qualquer tecla. Não, essa não.',
    'Abas demais abertas na vida. Feche 37 e tente de novo.',
    'Calma. Esc ou consertar resolve tudo.'
  ];

  const CAPI = {
    greet: 'oi! sou o guará, do Cerrado. um clique num ícone abre um app.',
    open: {
      sobre: 'esse é o Andrey. eu sou o guará. prazer.',
      projetos: 'o abrir leva para uma aba nova. o quarto continua aqui.',
      arcade: 'BLOCOS vicia. depois não diz que eu não avisei.',
      terminal: 'terminal aberto. digita help que eu espero.',
      temas: 'troca a cor. a luz do quarto muda junto.',
      lixeira: 'não julga. todo mundo começou assim.'
    },
    theme: {
      sistema: 'sistema: tudo em preto e branco, menos eu.',
      grafite: 'grafite: escuro, limpo e com a minha cor.',
      classico: 'clássico nunca sai de moda.',
      ambar: 'âmbar: tudo com cara de 1987.',
      fosforo: 'fósforo verde. agora sim, hacker de filme.',
      noite: 'modo noite. combina com café.'
    },
    record: 'RECORDE! vou uivar pro Cerrado inteiro.',
    pane: 'calma. respira. digita consertar ou aperta Esc.',
    fix: 'ufa. ninguém viu.',
    idle: 'ainda tá aí? tenta o terminal: digita cafe.',
    pet: 'oi! me chamou? cafuné aceito.',
    back: 'voltei! senti falta do canto da tela.',
    bye: 'tchau! se bater saudade, digita pet no terminal.',
    shutdown: 'boa noite! desliga a luz da luminária também.'
  };
  const TIPS = [
    'dica: arraste as janelas pela barra de título.',
    'dica: no terminal, Tab completa e as setas trazem o histórico.',
    'dica: digite tour estante para passear pelo quarto.',
    'dica: no BLOCOS, C guarda a peça e Espaço derruba de vez.',
    'dica: na NOITE DOS ZUMBIS, o cafezinho devolve uma vida.',
    'dica: no MINI MUNDO, N vira a noite e as lanternas acendem.',
    'dica: o Iniciar tem tudo, até o botão de desligar.',
    'dica: Esc fecha a janela da frente.',
    'dica: tela fosforo deixa tudo verde.'
  ];

  const HELP = [
    { cmd: 'help', label: 'help', desc: 'esta lista' },
    { cmd: 'sobre', label: 'sobre', desc: 'quem é o Andrey' },
    { cmd: 'projetos', label: 'projetos', desc: 'lista os projetos e abre a pasta' },
    { cmd: 'abrir', label: 'abrir <nome>', desc: 'abre um projeto numa aba nova', fill: true },
    { cmd: 'jogar blocos', label: 'jogar blocos', desc: 'liga o BLOCOS no Arcade' },
    { cmd: 'jogar zumbis', label: 'jogar zumbis', desc: 'liga a NOITE DOS ZUMBIS' },
    { cmd: 'jogar mundo', label: 'jogar mundo', desc: 'liga o MINI MUNDO, de construir' },
    { cmd: 'tela', label: 'tela <tema>', desc: 'troca o tema; sem nome, lista todos', fill: true },
    { cmd: 'cafe', label: 'cafe', desc: 'pausa para o café' },
    { cmd: 'pet', label: 'pet', desc: 'chama o guará' },
    { cmd: 'contato', label: 'contato', desc: 'GitHub e Instagram' },
    { cmd: 'tour', label: 'tour <lugar>', desc: 'mesa, estante, mural ou janela', fill: true },
    { cmd: 'pane', label: 'pane', desc: 'não digite isso' },
    { cmd: 'consertar', label: 'consertar', desc: 'resolve a pane' },
    { cmd: 'data', label: 'data', desc: 'data e hora de agora' },
    { cmd: 'quem', label: 'quem', desc: 'quem está aí' },
    { cmd: 'limpar', label: 'limpar', desc: 'limpa a tela (ou clear)' },
    { cmd: 'sudo', label: 'sudo <algo>', desc: 'tente a sorte', fill: true }
  ];
  const COMMANDS = ['help', 'ajuda', 'sobre', 'projetos', 'abrir', 'jogar', 'tela', 'cafe', 'pet', 'tour', 'pane', 'consertar', 'sudo', 'limpar', 'clear', 'data', 'quem', 'ls', 'sair'];
  const ARGS = {
    abrir: PROJETOS.map(p => p.id).concat(APP_ORDER),
    jogar: ['blocos', 'zumbis', 'mundo'],
    tela: THEME_ORDER.slice(),
    tour: ['mesa', 'estante', 'mural', 'janela']
  };

  /* ------------------------------------------------------------------ */
  /* Desenhos (pixel art 16×16 em SVG, cores pelas variáveis do tema)    */
  /* ------------------------------------------------------------------ */

  // k contorno · m principal · w claro · a destaque · b destaque 2 · c destaque 3
  // d sombra · n tela escura · e erro · g cor do texto (currentColor)
  const ICONS = {
    doc: [
      '..kkkkkkkkk.....',
      '..kwwwwwwwkk....',
      '..kwwwwwwwkwk...',
      '..kwwwwwwwkkkk..',
      '..kwbbbbbwwwwk..',
      '..kwwwwwwwwwwk..',
      '..kwddddddddwk..',
      '..kwwwwwwwwwwk..',
      '..kwddddddwwwk..',
      '..kwwwwwwwwwwk..',
      '..kwddddddddwk..',
      '..kwwwwwwwwwwk..',
      '..kwddddwwwwwk..',
      '..kwwwwwwwwwwk..',
      '..kkkkkkkkkkkk..',
      '................'
    ],
    folder: [
      '................',
      '.kkkkkk.........',
      'kaaaaaak........',
      'kaaaaaaakkkkkkk.',
      'kawwwwwwwwwwwwak',
      'kaaaaaaaaaaaaaak',
      'kkkkkkkkkkkkkkkk',
      'kmmmmmmmmmmmmmmk',
      'kmwwwwwwwwwwwwmk',
      'kmmmmmmmmmmmmmmk',
      'kmmmmmmmmmmmmmmk',
      'kmmmmmmmmmmmmmmk',
      'kmmmmmmmmmmmmmmk',
      'kddddddddddddddk',
      'kkkkkkkkkkkkkkkk',
      '................'
    ],
    joy: [
      '......kkkk......',
      '.....kaaaak.....',
      '.....kawaak.....',
      '.....kaaaak.....',
      '......kkkk......',
      '.......kk.......',
      '.......kk.......',
      '..kkkkkkkkkkkk..',
      '.kmmmmmmmmmmmmk.',
      '.kmbbmmmmmmccmk.',
      '.kmbbmmmmmmccmk.',
      '.kmmmmmmmmmmmmk.',
      '.kddddddddddddk.',
      '..kkkkkkkkkkkk..',
      '................',
      '................'
    ],
    term: [
      'kkkkkkkkkkkkkkkk',
      'kbbbbbbbbbbbbbbk',
      'kbbbbbbbbwkwkwbk',
      'kkkkkkkkkkkkkkkk',
      'knnnnnnnnnnnnnnk',
      'kncnnnnnnnnnnnnk',
      'knccnnnnnnnnnnnk',
      'knnccnnnnnnnnnnk',
      'knccnnnnnnnnnnnk',
      'kncnnnwwwwnnnnnk',
      'knnnnnnnnnnnnnnk',
      'knnnnnnnnnnnnnnk',
      'kmmmmmmmmmmmmmmk',
      'kkkkkkkkkkkkkkkk',
      '................',
      '................'
    ],
    palette: [
      '................',
      '....kkkkkkk.....',
      '..kkmmmmmmmkk...',
      '.kmmaammmbbmmk..',
      '.kmmaammmbbmmmk.',
      'kmmmmmmmmmmmmmk.',
      'kmccmmmmmmmmmmk.',
      'kmccmmmmkkkmmmk.',
      'kmmmmmmk...kmmk.',
      'kmmmmmmk...kmk..',
      '.kmeemmmkkkmmk..',
      '.kmeemmmmmmmk...',
      '..kmmmmmmmmk....',
      '...kkkkkkkk.....',
      '................',
      '................'
    ],
    trash: [
      '................',
      '.....kkkkk......',
      '...kkwwkwwkk....',
      '..kkkkkkkkkkkk..',
      '..kmmmmmmmmmmk..',
      '..kkkkkkkkkkkk..',
      '...kmdmmdmmdk...',
      '...kmdmmdmmdk...',
      '...kmdmmdmmdk...',
      '...kmdmmdmmdk...',
      '...kmdmmdmmdk...',
      '...kmdmmdmmdk...',
      '...kmmmmmmmmk...',
      '....kkkkkkkk....',
      '................',
      '................'
    ],
    // Marca do AndreyOS: o sol nascendo sobre o horizonte.
    logo: [
      '................',
      '.......aa.......',
      '..a....aa....a..',
      '...a........a...',
      '.....kkkkkk.....',
      '....kaaaaaak....',
      'aa.kaaaaawaak.aa',
      '...kaaaaaaaak...',
      'kkkkkkkkkkkkkkkk',
      'kcccccccccccccck',
      'kccbbbccccbbbcck',
      'kbbbbbbbbbbbbbbk',
      'kkkkkkkkkkkkkkkk',
      '................',
      '................',
      '................'
    ],
    moon: [
      '................',
      '......kkkk......',
      '....kkmmmk......',
      '...kmmmmk.......',
      '..kmmmmk........',
      '..kmmmk.........',
      '.kmmmmk.........',
      '.kmmmmk.........',
      '.kmmmmk.........',
      '.kmmmmmk........',
      '..kmmmmmk.....k.',
      '..kmmmmmmkkkkmk.',
      '...kmmmmmmmmmk..',
      '....kkmmmmmkk...',
      '......kkkkk.....',
      '................'
    ],
    // Cabeça do lobo-guará para a barra de menus do tema sistema (no lugar da maçã).
    // o = laranja do guará: o único toque de cor do tema.
    guara: [
      '.k........k.',
      'kok......kok',
      'kwok....kowk',
      'kwookkkkoowk',
      'kooooooooook',
      'kookooookook',
      '.kooooooook.',
      '.kwoooooowk.',
      '..kwokkowk..',
      '...kwkkwk...',
      '....kkkk....'
    ],
    err: [
      '.....kkkkkk.....',
      '...kkeeeeeekk...',
      '..keeeeeeeeeek..',
      '.keeeeewweeeeek.',
      '.keeeeewweeeeek.',
      'keeeeeewweeeeeek',
      'keeeeeewweeeeeek',
      'keeeeeewweeeeeek',
      'keeeeeewweeeeeek',
      'keeeeeeeeeeeeeek',
      'keeeeeewweeeeeek',
      '.keeeeewweeeeek.',
      '.keeeeeeeeeeeek.',
      '..keeeeeeeeeek..',
      '...kkeeeeeekk...',
      '.....kkkkkk.....'
    ]
  };
  const GLYPH = {
    min: ['........', '........', '........', '........', '........', '.gggggg.', '.gggggg.', '........'],
    close: ['gg....gg', 'ggg..ggg', '.gggggg.', '..gggg..', '..gggg..', '.gggggg.', 'ggg..ggg', 'gg....gg'],
    expand: ['ggg..ggg', 'gg....gg', 'g......g', '........', '........', 'g......g', 'gg....gg', 'ggg..ggg'],
    shrink: ['..g..g..', 'ggg..ggg', '........', '........', '........', '........', 'ggg..ggg', '..g..g..'],
    check: ['.......g', '......gg', '.....gg.', 'g...gg..', 'gg.gg...', '.ggg....', '..g.....', '........']
  };
  // Barra de menus do tema sistema: os menus e o que cada um faz (ver dropList).
  const MENUS = ['os', 'arquivo', 'tela', 'especial', 'ajuda'];
  const MENU_NOME = { os: 'AndreyOS', arquivo: 'Arquivo', tela: 'Tela', especial: 'Especial', ajuda: 'Ajuda' };

  function px(rows, size, cls) {
    const h = rows.length;
    const w = rows[0].length;
    let out = '';
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      let x = 0;
      while (x < w) {
        const ch = row[x];
        if (ch === '.') { x++; continue; }
        let x2 = x + 1;
        while (x2 < w && row[x2] === ch) x2++;
        out += '<rect x="' + x + '" y="' + y + '" width="' + (x2 - x) + '" height="1" class="p' + ch + '"/>';
        x = x2;
      }
    }
    return '<svg class="aos-px' + (cls ? ' ' + cls : '') + '" viewBox="0 0 ' + w + ' ' + h + '" width="' + size + '" height="' + size +
      '" shape-rendering="crispEdges" aria-hidden="true" focusable="false">' + out + '</svg>';
  }

  // A capivara: formas simples em SVG, cores pelas variáveis do tema.
  // Mascote atual: o lobo-guará em pixel art (gerado no Higgsfield). O desenho da capivara fica como reserva.
  const GUARA_IMG = '<img class="aos-capi-svg aos-guara" src="assets/guara.png" width="70" height="110" alt="" draggable="false">';
  const CAPI_SVG =
    '<svg class="aos-capi-svg" viewBox="0 -10 122 102" width="112" height="94" aria-hidden="true" focusable="false">' +
      '<g class="cp-all">' +
        '<rect x="30" y="62" width="12" height="20" rx="4" class="cp-dark"/>' +
        '<rect x="78" y="62" width="12" height="20" rx="4" class="cp-dark"/>' +
        '<g class="cp-breath">' +
          '<rect x="8" y="30" width="88" height="44" rx="22" class="cp-body"/>' +
          '<path d="M24 62 Q50 72 78 62" class="cp-line"/>' +
          '<rect x="18" y="64" width="13" height="19" rx="4" class="cp-body"/>' +
          '<rect x="64" y="64" width="13" height="19" rx="4" class="cp-body"/>' +
          '<rect x="58" y="15" width="50" height="40" rx="15" class="cp-body"/>' +
          '<rect x="90" y="25" width="26" height="29" rx="11" class="cp-snout"/>' +
          '<rect x="106" y="30" width="7" height="6" rx="2" class="cp-nose"/>' +
          '<path d="M102 46 h8" class="cp-line"/>' +
          '<ellipse cx="68" cy="16" rx="6" ry="5" class="cp-dark"/>' +
          '<g class="cp-eye"><circle cx="86" cy="29" r="3.6" class="cp-nose"/><circle cx="87.3" cy="27.7" r="1.2" class="cp-shine"/></g>' +
          '<path d="M64 40 q6 5 12 0" class="cp-cheek"/>' +
          '<g class="cp-fruit"><circle cx="84" cy="5" r="8.5" class="cp-orange"/><path d="M84 -3 q6 -6 12 -2 q-5 6 -12 2z" class="cp-leaf"/></g>' +
        '</g>' +
      '</g>' +
    '</svg>';

  /* ------------------------------------------------------------------ */
  /* Utilidades                                                          */
  /* ------------------------------------------------------------------ */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }
  function slug(s) { return norm(s).replace(/[^a-z0-9:._]/g, ''); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isTextField(t) { return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  function isControl(t) { return !!t && (t.tagName === 'BUTTON' || t.tagName === 'A' || isTextField(t)); }
  function normTheme(name) { const s = slug(name); return Object.prototype.hasOwnProperty.call(THEMES, s) ? s : null; } // 'constructor' e '__proto__' não são temas
  // Tema escolhido pela pessoa (Temas ou `tela`). Sem nada salvo, vale o DEFAULT_THEME.
  function readTheme() {
    try { return normTheme(global.localStorage.getItem(THEME_KEY)); } catch (err) { return null; }
  }
  // O navegador deixa gravar? (modo privado ou armazenamento bloqueado: não)
  function canStore() {
    try { const k = 'andreyos.teste'; global.localStorage.setItem(k, '1'); global.localStorage.removeItem(k); return true; } catch (err) { return false; }
  }
  function saveTheme(t) {
    try { global.localStorage.setItem(THEME_KEY, t); } catch (err) { /* modo privado ou bloqueado: vale só nesta visita */ }
  }
  function findProject(name) {
    const s = slug(name).replace(/[:._]/g, '');
    if (!s) return null;
    return PROJETOS.find(p => slug(p.id).replace(/[:._]/g, '') === s) ||
      PROJETOS.find(p => p.alias.indexOf(s) >= 0) ||
      PROJETOS.find(p => p.alias.some(a => s.indexOf(a) >= 0)) || null;
  }
  // Recorde salvo de um cartucho (0 se não tem placar ou nada foi salvo).
  function readRecord(id) {
    const g = isGame(id) ? GAMES[id] : null;
    if (!g || !g.recorde) return 0;
    try {
      const L = global[g.lib];
      if (L && typeof L.getRecord === 'function') {
        const r = Number(L.getRecord());
        if (isFinite(r) && r > 0) return Math.floor(r);
      }
    } catch (err) { /* segue para o localStorage */ }
    try {
      const v = parseInt(global.localStorage.getItem(g.recorde), 10);
      return isFinite(v) && v > 0 ? v : 0;
    } catch (err) { return 0; }
  }
  // Nome solto digitado no terminal -> cartucho ('zumbi', 'noite dos zumbis', 'mini mundo'...).
  function gameFrom(raw) {
    const s = slug(raw).replace(/[:._]/g, '');
    if (!s) return null;
    if (isGame(s)) return s;
    if (/^(bloco|tetris|pecas?)$/.test(s)) return 'blocos';
    if (/zumbi|zombie|noite/.test(s)) return 'zumbis';
    if (/mundo|minecraft|ilha/.test(s)) return 'mundo';
    return null;
  }
  function longDate(d) {
    try {
      return d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } catch (err) { return d.toDateString(); }
  }

  /* ------------------------------------------------------------------ */
  /* create                                                              */
  /* ------------------------------------------------------------------ */

  function create(rootEl, options) {
    const opts = options || {};
    const uid = 'aos' + (++seq) + '-';
    const host = rootEl && rootEl.appendChild ? rootEl : doc.body;
    const el = doc.createElement('div');

    const S = {
      visible: true, shown: false, running: false, disposed: false, hostHidden: false,
      theme: readTheme() || DEFAULT_THEME, expanded: false, reduced: false,
      open: [], z: [], min: new Set(), pos: {}, active: null,
      menu: false, menuIdx: 0, sel: 0, drop: null, dropIdx: -1, dropHoverAt: 0,
      hist: [], histIdx: 0, draft: '',
      pane: [], paneQueue: [],
      capiOn: true, greeted: false, tip: 0, bubbleOn: false, bubbleAt: 0, byePending: false, lastAct: Date.now(),
      // Arcade: game = api do jogo montado; gameId = cartucho na tela (pode estar carregando);
      // gameTok descarta avisos de um jogo que já saiu; gameVis = último setVisible repassado.
      game: null, gameId: null, gameTok: null, gameVis: null, lastGame: 'blocos', arcadeView: 'carts', retries: 0,
      recs: { blocos: 0, zumbis: 0 },
      cafe: null, pointerType: 'mouse', trashSel: -1
    };
    const timers = new Map();
    const listeners = [];
    let drag = null;

    /* ---------- timers nomeados (todos param quando o desktop some) ---------- */
    function later(key, ms, fn) {
      clearLater(key);
      const t = global.setTimeout(() => { timers.delete(key); fn(); }, ms);
      timers.set(key, { t: t, iv: false });
    }
    function every(key, ms, fn) {
      clearLater(key);
      timers.set(key, { t: global.setInterval(fn, ms), iv: true });
    }
    function clearLater(key) {
      const r = timers.get(key);
      if (!r) return;
      if (r.iv) global.clearInterval(r.t); else global.clearTimeout(r.t);
      timers.delete(key);
    }
    function clearAllTimers() { Array.from(timers.keys()).forEach(clearLater); }
    function listen(target, type, fn, o) { target.addEventListener(type, fn, o); listeners.push([target, type, fn, o]); }

    function emit(kind, detail) {
      if (typeof opts.onEvent !== 'function' || S.disposed) return;
      try { opts.onEvent(kind, detail); } catch (err) { if (global.console) global.console.warn('[AndreyDesktop] onEvent falhou:', err); }
    }
    function callGame(method) {
      const g = S.game;
      if (!g || typeof g[method] !== 'function') return undefined;
      try { return g[method].apply(g, Array.prototype.slice.call(arguments, 1)); } catch (err) {
        if (global.console) global.console.warn('[AndreyDesktop] ' + (isGame(S.gameId) ? GAMES[S.gameId].nome : 'jogo') + '.' + method + ' falhou:', err);
        return undefined;
      }
    }

    /* ---------- marcação ---------- */
    function winMarkup(id, body) {
      const a = APPS[id];
      return '<section class="aos-win aos-win--' + id + '" data-win="' + id + '" role="region" aria-labelledby="' + uid + 't-' + id + '"' +
        ' style="width:' + a.w + 'px;height:' + a.h + 'px;left:' + a.x + 'px;top:' + a.y + 'px" hidden>' +
        '<header class="aos-titlebar" data-drag="' + id + '">' +
          '<span class="aos-titleicon">' + px(ICONS[a.icon], 26) + '</span>' +
          '<h2 class="aos-title" id="' + uid + 't-' + id + '">' + esc(a.title) + '</h2>' +
          '<span class="aos-grip" aria-hidden="true"></span>' +
          '<button type="button" class="aos-wbtn" data-act="min" aria-label="Minimizar ' + esc(a.title) + '">' + px(GLYPH.min, 16) + '</button>' +
          '<button type="button" class="aos-wbtn aos-wbtn--close" data-act="close" aria-label="Fechar ' + esc(a.title) + '">' + px(GLYPH.close, 16) + '</button>' +
        '</header>' +
        '<div class="aos-winbody">' + body + '</div>' +
      '</section>';
    }

    function wallMarkup() {
      return '<div class="aos-wall" aria-hidden="true">' +
        '<svg class="aos-wall-art" viewBox="0 0 1024 720" width="1024" height="720">' +
          '<defs>' +
            '<linearGradient id="' + uid + 'sung" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="aos-wall-s1"/><stop offset="1" class="aos-wall-s2"/></linearGradient>' +
            '<mask id="' + uid + 'sunm" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="720"><rect width="1024" height="720" fill="#fff"/>' +
              '<rect y="392" width="1024" height="7" fill="#000"/><rect y="418" width="1024" height="10" fill="#000"/>' +
              '<rect y="446" width="1024" height="13" fill="#000"/><rect y="476" width="1024" height="16" fill="#000"/></mask>' +
          '</defs>' +
          '<circle cx="660" cy="380" r="188" fill="url(#' + uid + 'sung)" mask="url(#' + uid + 'sunm)" class="aos-wall-sun"/>' +
          // Só no tema grafite (escondidos nos outros): estrelas e a serra ao fundo, em traço fino.
          '<g class="aos-wall-g aos-wall-sky">' +
            '<circle cx="118" cy="62" r="1.1"/><circle cx="262" cy="128" r=".9"/><circle cx="356" cy="44" r="1.2"/><circle cx="472" cy="170" r=".8"/>' +
            '<circle cx="548" cy="78" r="1"/><circle cx="642" cy="214" r=".8"/><circle cx="716" cy="52" r="1.2"/><circle cx="802" cy="140" r=".9"/>' +
            '<circle cx="884" cy="88" r="1.1"/><circle cx="958" cy="196" r=".8"/><circle cx="992" cy="36" r=".9"/><circle cx="420" cy="290" r=".7"/>' +
            '<circle cx="190" cy="250" r=".8"/><circle cx="868" cy="296" r=".7"/>' +
            '<path class="aos-wall-far" d="M0 474 C 110 446 230 452 340 466 S 560 476 700 448 S 920 418 1024 430"/>' +
          '</g>' +
          '<path class="aos-wall-h1" d="M0 512 C 150 466 300 474 430 508 S 720 556 1024 462 V720 H0Z"/>' +
          '<path class="aos-wall-h2" d="M0 598 C 190 556 380 586 560 606 S 860 598 1024 556 V720 H0Z"/>' +
          // Grafite: o contorno das colinas pega a luz do horizonte; um buriti e uma árvore torta do Cerrado.
          '<g class="aos-wall-g aos-wall-lines">' +
            '<path class="aos-wall-l1" d="M0 512 C 150 466 300 474 430 508 S 720 556 1024 462"/>' +
            '<path class="aos-wall-l2" d="M0 598 C 190 556 380 586 560 606 S 860 598 1024 556"/>' +
            '<g class="aos-wall-buriti">' +
              '<path class="aos-wall-trunk" d="M244 481 C 245 458 243 434 246 408"/>' +
              '<path d="M246 408 C 234 400 224 400 214 406 M246 408 C 236 396 228 390 218 389 M246 408 C 241 394 237 386 231 379 M246 408 C 248 394 250 385 252 377 M246 408 C 254 396 262 390 272 388 M246 408 C 256 400 266 400 276 406 M246 408 C 240 405 233 409 229 417 M246 408 C 252 405 259 409 263 417"/>' +
              '<path d="M240 414 L 238 424 M246 414 L 246 426 M252 414 L 254 424"/>' +
            '</g>' +
            // árvore torta do Cerrado: tronco retorcido, galhos abertos e copa em tufos achatados
            '<g class="aos-wall-tree" transform="translate(900 498) scale(1.3)">' +
              '<path class="aos-wall-trunk" d="M0 1 C -1 -10 5 -18 1 -28 C -2 -36 3 -44 8 -50"/>' +
              '<path d="M1 -27 C -7 -33 -16 -37 -27 -41 M4 -40 C -2 -47 -7 -53 -10 -61 M7 -49 C 15 -54 24 -57 34 -58 M8 -50 C 10 -58 13 -64 16 -70"/>' +
              '<path class="aos-wall-crown" d="M-47 -42 C -48 -49 -38 -52 -31 -50 C -24 -54 -13 -50 -14 -44 C -14 -39 -42 -37 -47 -42 Z"/>' +
              '<path class="aos-wall-crown" d="M-27 -62 C -27 -69 -16 -72 -9 -70 C -1 -73 9 -68 6 -62 C 4 -57 -23 -56 -27 -62 Z"/>' +
              '<path class="aos-wall-crown" d="M16 -58 C 15 -65 26 -68 33 -66 C 41 -69 52 -63 49 -57 C 47 -52 20 -52 16 -58 Z"/>' +
              '<path class="aos-wall-crown" d="M3 -72 C 3 -78 12 -81 18 -79 C 25 -81 33 -76 30 -71 C 28 -67 6 -66 3 -72 Z"/>' +
            '</g>' +
          '</g>' +
          '<text x="640" y="690" text-anchor="middle" class="aos-wall-text">AndreyOS <tspan class="aos-wall-24">24</tspan></text>' +
        '</svg></div>';
    }

    function iconsMarkup() {
      return '<div class="aos-icons" role="group" aria-label="Ícones da área de trabalho">' + APP_ORDER.map((id, i) => {
        // 132 px de largura: "sobre_mim.txt" cabe numa linha só em VT323 21px.
        const pos = id === 'lixeira' ? 'left:' + (W - 12 - 132) + 'px;top:' + (AREA_H - 12 - 104) + 'px' : 'left:6px;top:' + (10 + i * 112) + 'px';
        const label = id === 'sobre' ? 'sobre_mim.txt' : APPS[id].title;
        return '<button type="button" class="aos-icon' + (i === 0 ? ' is-selected' : '') + '" data-icon="' + id + '" data-idx="' + i + '" tabindex="' + (i === 0 ? '0' : '-1') +
          '" style="' + pos + '" aria-label="' + esc(label) + '. Dois cliques ou Enter abrem.">' + px(ICONS[APPS[id].icon], 64) +
          '<span>' + esc(label) + '</span></button>';
      }).join('') + '</div>';
    }

    function sobreBody() {
      return '<div class="aos-sobre">' +
        // Letreiro do tema sistema (escondido nos outros): "AndreyOS" em pixel com sombra listrada.
        '<div class="aos-sobre-logo" aria-hidden="true"><div class="aos-logo"><span class="aos-logo-txt" data-text="AndreyOS">AndreyOS</span>' +
          '<span class="aos-logo-24">24</span></div><p class="aos-sobre-sub"><span>feito por Andrey Bueno</span></p></div>' +
        '<div class="aos-docbar" aria-hidden="true"><span>sobre_mim.txt</span><span>só leitura</span></div>' +
        '<div class="aos-paper" tabindex="0" data-autofocus>' +
          '<p><strong class="aos-oi">Oi!</strong> Eu sou o Andrey Bueno, 24 anos, estudante de Engenharia de Software (4º período). ' +
          'Gosto de criar coisas com código: sites, sistemas, jogos e peças impressas em 3D.</p>' +
          '<p>Digite <button type="button" class="aos-code" data-run-term="projetos" aria-label="Rodar projetos no Terminal">projetos</button> no Terminal ou abra o Arcade.</p>' +
          '<p>Me acha no <a href="https://github.com/andreybueno-git" target="_blank" rel="noopener">GitHub</a> e no <a href="https://www.instagram.com/andreyb.bueno/" target="_blank" rel="noopener">Instagram @andreyb.bueno</a>.</p>' +
        '</div>' +
        '<div class="aos-actions">' +
          '<button type="button" class="aos-btn" data-open="terminal">' + px(ICONS.term, 26) + '<span>Terminal</span></button>' +
          '<button type="button" class="aos-btn" data-open="projetos">' + px(ICONS.folder, 26) + '<span>Projetos</span></button>' +
          '<button type="button" class="aos-btn aos-btn--primary" data-open="arcade">' + px(ICONS.joy, 26) + '<span>Arcade</span></button>' +
        '</div></div>';
    }

    function projetosBody() {
      return '<div class="aos-proj">' +
        '<div class="aos-pathbar"><span>andrey / projetos /</span><span>' + PROJETOS.length + ' itens</span></div>' +
        '<ul class="aos-proj-list" data-ref="projlist">' + PROJETOS.map((p, i) =>
          '<li class="aos-proj-row" data-proj="' + p.id + '">' +
            '<span class="aos-proj-n" aria-hidden="true">' + pad2(i + 1) + '</span>' +
            '<span class="aos-proj-txt"><strong>' + esc(p.nome) + '</strong><span>' + esc(p.linha) + '</span></span>' +
            '<span class="aos-proj-ano">' + p.ano + '</span>' +
            '<a class="aos-btn aos-btn--link" href="' + esc(p.url) + '" target="_blank" rel="noopener" data-link="' + p.id + '"' + (i === 0 ? ' data-autofocus' : '') +
              ' aria-label="Abrir ' + esc(p.nome + ', ' + p.linha) + ', numa aba nova">abrir ↗</a>' +
          '</li>').join('') + '</ul>' +
        '<p class="aos-foot">Os links abrem numa aba nova. O quarto continua aqui.</p></div>';
    }

    function blocosArt() {
      const pat = ['...bbb..', '....b...', '........', 'e......d', 'ee.cc.dd', 'eaaccadd'];
      let cells = '';
      pat.forEach(row => { for (let i = 0; i < row.length; i++) cells += '<i class="aos-cell' + (row[i] === '.' ? '' : ' aos-cell--' + row[i]) + '"></i>'; });
      return '<div class="aos-art aos-art--blocos" aria-hidden="true">' + cells + '</div>';
    }
    function cartMarkup(kind, title) {
      const art = kind === 'blocos' ? blocosArt() :
        kind === 'zumbis' ? '<div class="aos-art aos-art--zumbis" aria-hidden="true"><i class="z-moon"></i><i class="z-stone"></i><i class="z-hand"></i><i class="z-ground"></i></div>' :
        '<div class="aos-art aos-art--mundo" aria-hidden="true"><i class="m-sun"></i><i class="m-sea"></i><i class="m-island"></i><i class="m-tree"></i><i class="m-house"></i></div>';
      return '<div class="aos-cart aos-cart--' + kind + '"><div class="aos-cart-top" aria-hidden="true"></div><div class="aos-cart-label">' + art + '<strong>' + title + '</strong></div></div>';
    }
    function arcadeBody() {
      return '<div class="aos-arcade">' +
        '<div class="aos-carts" data-ref="carts">' +
          '<div class="aos-arcade-head"><span class="aos-arcade-logo" data-text="ARCADE">ARCADE</span>' +
            '<span class="aos-record">RECORDE BLOCOS <b data-ref="record">000000</b><span class="aos-rec-sep" aria-hidden="true"> · </span>ZUMBIS <b data-ref="recordz">000000</b></span></div>' +
          '<div class="aos-cart-row">' + GAME_ORDER.map((id, i) =>
            '<article class="aos-cartbox" data-cart="' + id + '">' + cartMarkup(id, GAMES[id].nome) + '<p data-cartline>' + esc(GAMES[id].linha) + '</p>' +
              '<button type="button" class="aos-btn aos-btn--primary" data-play="' + id + '"' + (i === 0 ? ' data-autofocus' : '') +
                ' aria-label="Jogar ' + esc(GAMES[id].nome) + '">Jogar</button></article>').join('') +
          '</div>' +
          '<p class="aos-arcade-msg" data-ref="arcademsg" role="status">' + esc(ARCADE_MSG) + '</p>' +
        '</div>' +
        '<div class="aos-game" data-ref="game" hidden>' +
          '<div class="aos-game-bar"><button type="button" class="aos-btn" data-act="carts">‹ Cartuchos</button>' +
            '<span class="aos-game-name" data-ref="gamename">BLOCOS</span>' +
            '<span class="aos-record" data-ref="gamerec">RECORDE <b data-ref="record2">000000</b></span>' +
            '<span class="aos-record" data-ref="gamesave" hidden>SALVO NESTE NAVEGADOR</span></div>' +
          '<div class="aos-game-host" data-ref="gamehost" tabindex="-1" aria-label="BLOCOS"></div>' +
        '</div></div>';
    }
    function loadingMarkup(id, msg) {
      const g = isGame(id) ? id : 'blocos';
      return '<div class="aos-loading" role="status">' + cartMarkup(g, GAMES[g].nome) +
        '<p>' + esc(msg || 'carregando…') + '</p>' +
        (msg ? '<button type="button" class="aos-btn" data-play="' + g + '">Tentar de novo</button>' : '') + '</div>';
    }

    function terminalBody() {
      return '<div class="aos-term">' +
        '<div class="aos-term-log" data-ref="log" role="log" aria-live="polite" aria-label="Saída do terminal"></div>' +
        '<form class="aos-term-form" data-ref="form" autocomplete="off">' +
          '<label class="aos-prompt" for="' + uid + 'in">andrey@quarto ~ $</label>' +
          '<input class="aos-term-input" id="' + uid + 'in" data-ref="input" data-autofocus type="text" maxlength="' + INPUT_MAX + '"' +
            ' autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Comando do terminal">' +
          // Cursor em bloco desenhado (só aparece nos temas que pedem; ver caretSync).
          '<span class="aos-caret" data-ref="caret" aria-hidden="true"></span>' +
        '</form></div>';
    }

    function temasBody() {
      return '<div class="aos-temas">' +
        '<p class="aos-lead">Escolha a pele do AndreyOS. A luz da tela no quarto muda junto.</p>' +
        '<div class="aos-swatches">' + THEME_ORDER.map(t =>
          '<button type="button" class="aos-swatch aos-swatch--' + t + '" data-theme-pick="' + t + '" aria-pressed="' + (t === S.theme) + '">' +
            '<span class="aos-prev aos-prev--' + t + '" aria-hidden="true"><i class="pv-win"><i class="pv-bar"></i><i class="pv-l1"></i><i class="pv-l2"></i></i><i class="pv-task"></i></span>' +
            '<span class="aos-swatch-txt"><strong>' + THEMES[t].nome + '</strong><small>' + THEMES[t].desc + '</small></span>' +
          '</button>').join('') + '</div>' +
        '<p class="aos-foot">No Terminal também dá: <button type="button" class="aos-code" data-run-term="tela fosforo">tela fosforo</button></p></div>';
    }

    function lixeiraBody() {
      return '<div class="aos-lixo">' +
        '<div class="aos-pathbar"><span>lixeira / primeiros_codigos /</span><span>' + LIXO.length + ' arquivos</span></div>' +
        '<ul class="aos-files">' + LIXO.map((f, i) =>
          '<li><button type="button" class="aos-file" data-file="' + i + '"' + (i === 0 ? ' data-autofocus' : '') + ' aria-pressed="false">' +
            px(ICONS.doc, 32) + '<span>' + esc(f.nome) + '</span><small>' + f.tam + '</small></button></li>').join('') + '</ul>' +
        '<pre class="aos-preview" data-ref="preview" tabindex="0" aria-label="Conteúdo do arquivo">Clique num arquivo para espiar.</pre>' +
        '<div class="aos-actions"><button type="button" class="aos-btn" data-act="restore">Restaurar</button>' +
          '<button type="button" class="aos-btn" data-act="empty">Esvaziar lixeira</button>' +
          '<span class="aos-status" data-ref="trashstatus" role="status"></span></div></div>';
    }

    function menuMarkup() {
      return '<div class="aos-menu" id="' + uid + 'menu" data-ref="menu" role="menu" aria-label="Iniciar" hidden>' +
        '<div class="aos-menu-banner" aria-hidden="true"><span>AndreyOS <b>24</b></span></div>' +
        '<div class="aos-menu-list">' + APP_ORDER.map(id =>
          '<button type="button" role="menuitem" tabindex="-1" class="aos-mi" data-open="' + id + '">' + px(ICONS[APPS[id].icon], 32) + '<span>' + esc(APPS[id].menu) + '</span></button>').join('') +
          '<div class="aos-menu-sep" role="separator"></div>' +
          '<button type="button" role="menuitem" tabindex="-1" class="aos-mi" data-act="shutdown">' + px(ICONS.moon, 32) + '<span>Desligar</span></button>' +
        '</div></div>';
    }

    function build() {
      el.className = 'aos';
      el.dataset.theme = S.theme;
      el.tabIndex = -1;
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', 'AndreyOS 24, a área de trabalho do computador');
      el.innerHTML =
        wallMarkup() +
        iconsMarkup() +
        '<div class="aos-windows">' +
          winMarkup('sobre', sobreBody()) + winMarkup('projetos', projetosBody()) + winMarkup('arcade', arcadeBody()) +
          winMarkup('terminal', terminalBody()) + winMarkup('temas', temasBody()) + winMarkup('lixeira', lixeiraBody()) +
        '</div>' +
        '<div class="aos-errors" data-ref="errors"></div>' +
        '<div class="aos-capi" data-ref="capi">' +
          '<div class="aos-bubble" data-ref="bubble" hidden><p data-ref="bubbletext"></p>' +
            '<div class="aos-bubble-row"><button type="button" class="aos-mini" data-act="capi-tip">outra dica</button>' +
            '<button type="button" class="aos-mini" data-act="capi-bye">tchau, guará</button></div></div>' +
          '<button type="button" class="aos-capi-btn" data-act="capi" aria-label="guara.exe, o lobo-guará. Clique para uma dica.">' + GUARA_IMG +
            '<span class="aos-capi-name">guara.exe</span></button>' +
        '</div>' +
        '<div class="aos-taskbar">' +
          '<button type="button" class="aos-start" data-act="start" aria-haspopup="menu" aria-expanded="false" aria-controls="' + uid + 'menu">' +
            px(ICONS.logo, 30) + '<span>Iniciar</span></button>' +
          // Só no tema sistema (escondida nos outros): a barra de menus do Mac clássico.
          '<nav class="aos-mbar" data-ref="mbar" aria-label="Menus">' + MENUS.map(m =>
            '<button type="button" class="aos-mt aos-mt--' + m + '" data-menu="' + m + '" aria-haspopup="menu" aria-expanded="false" aria-controls="' + uid + 'drop">' +
              (m === 'os' ? px(ICONS.guara, 24, 'aos-mt-guara') : '') + '<span>' + MENU_NOME[m] + '</span></button>').join('') +
          '</nav>' +
          '<div class="aos-tasks" data-ref="tasks" role="group" aria-label="Janelas abertas"></div>' +
          '<div class="aos-tray">' +
            '<button type="button" class="aos-traybtn" data-act="expand" data-ref="expand" aria-label="Ampliar a tela do computador">' + px(GLYPH.expand, 16) + '</button>' +
            '<time class="aos-clock" data-ref="clock"></time>' +
          '</div>' +
        '</div>' +
        menuMarkup() +
        '<div class="aos-drop" id="' + uid + 'drop" data-ref="drop" role="menu" hidden></div>' +
        '<div class="aos-fade" data-ref="fade" aria-hidden="true"></div>' +
        '<div class="aos-crt" aria-hidden="true"></div>' +
        '<p class="aos-sr" data-ref="sr" role="status" aria-live="polite"></p>';
      host.appendChild(el);
    }

    build();

    /* ---------- cursor do AndreyOS: desenhado dentro da tela ----------
       O cursor de imagem do sistema nem sempre aparece (navegadores recusam alguns, e dentro de um
       iframe às vezes nem carrega). Este fica dentro do .aos, então anda junto com a perspectiva do CRT:
       seta no fundo, mãozinha no que é clicável, I no campo de texto. Só com mouse; no toque some.
       Em cima do NOITE DOS ZUMBIS ele se esconde: o jogo desenha a própria mira no lugar. */
    const softCur = doc.createElement('div');
    softCur.className = 'aos-cursor'; softCur.setAttribute('aria-hidden', 'true');
    const CLICAVEL = 'button, a, [role=button], [role=menuitem], .aos-icon, .aos-capi-btn, .aos-cartbox, [data-open], [data-act], [data-play], [data-theme-pick], [data-file], [data-run-term], [data-link], [data-task]';
    function moveCursor(e) {
      if (e.pointerType && e.pointerType !== 'mouse') { el.classList.remove('has-soft-cursor'); return; }
      if (!softCur.isConnected) el.appendChild(softCur);
      const p = desktopPoint(e.clientX, e.clientY), t = e.target;
      const kind = !t.closest ? 'arrow' : t.closest('.zmb-canvas') ? 'game' :
        t.closest('input, textarea') ? 'text' : (t.closest(CLICAVEL) ? 'hand' : 'arrow');
      softCur.style.transform = 'translate(' + Math.round(p.x) + 'px,' + Math.round(p.y) + 'px)';
      if (softCur.dataset.kind !== kind) softCur.dataset.kind = kind;
      el.classList.add('has-soft-cursor');
    }
    const refs = {};
    el.querySelectorAll('[data-ref]').forEach(n => { refs[n.dataset.ref] = n; });
    const wins = {};
    el.querySelectorAll('[data-win]').forEach(n => { wins[n.dataset.win] = n; });
    APP_ORDER.forEach(id => { S.pos[id] = { x: APPS[id].x, y: APPS[id].y }; });
    const startBtn = el.querySelector('.aos-start');
    const input = refs.input;

    /* ---------- movimento reduzido ---------- */
    const mq = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
    function onMotion() {
      S.reduced = !!(mq && mq.matches);
      el.classList.toggle('aos-reduced', S.reduced);
      // Ligou no meio do caminho: o vapor do café para onde está e a pane aparece inteira.
      if (S.reduced) { clearLater('cafe'); if (S.paneQueue.length) flushPane(); }
    }
    onMotion();
    if (mq) { try { mq.addEventListener('change', onMotion); } catch (err) { try { mq.addListener(onMotion); } catch (err2) { /* sem aviso */ } } }

    /* ---------- homografia: ponteiro da viewport -> ponto do desktop ---------- */
    // Origem da caixa do desktop SEM o transform (o transform é aplicado a partir dela).
    function layoutOrigin() {
      const cs = global.getComputedStyle(el);
      const p = el.offsetParent;
      if (cs.position === 'fixed' || !p) return { x: el.offsetLeft, y: el.offsetTop };
      if (p === doc.body || p === doc.documentElement) return { x: el.offsetLeft - (global.scrollX || 0), y: el.offsetTop - (global.scrollY || 0) };
      const r = p.getBoundingClientRect();
      return { x: r.left + p.clientLeft + el.offsetLeft - p.scrollLeft, y: r.top + p.clientTop + el.offsetTop - p.scrollTop };
    }
    function desktopPoint(clientX, clientY) {
      const cs = global.getComputedStyle(el);
      const css = cs.transform;
      if (css && css !== 'none' && global.DOMMatrix) {
        // O transform vale a partir de transform-origin (o contrato usa 0 0, mas lemos o real).
        const m = new global.DOMMatrix(css);
        const o = layoutOrigin();
        const tor = (cs.transformOrigin || '0 0').split(' ').map(parseFloat);
        const ox = tor[0] || 0;
        const oy = tor[1] || 0;
        const x = clientX - o.x - ox;
        const y = clientY - o.y - oy;
        // X = (m11 u + m21 v + m41) / (m14 u + m24 v + m44); idem para Y. Resolve o sistema 2×2 em (u, v).
        const a = m.m11 - x * m.m14, b = m.m21 - x * m.m24, c = x * m.m44 - m.m41;
        const d = m.m12 - y * m.m14, e = m.m22 - y * m.m24, f = y * m.m44 - m.m42;
        const det = a * e - b * d;
        if (Math.abs(det) > 1e-10) return { x: (c * e - b * f) / det + ox, y: (a * f - c * d) / det + oy };
      }
      const r = el.getBoundingClientRect();
      return { x: (clientX - r.left) * W / (r.width || W), y: (clientY - r.top) * H / (r.height || H) };
    }

    /* ---------- vida útil: rodando = visível, na vista e aba aberta ---------- */
    function isRunning() { return S.visible && !S.hostHidden && !doc.hidden && !S.disposed; }

    // O integrador também esconde a camada sozinho, com style.visibility = 'hidden', quando a
    // tela do CRT sai da vista (câmera na estante, no mural...), sem chamar setVisible(false).
    // Sem isto o BLOCOS continuava caindo peça e os timers rodando com o desktop invisível.
    // Tratamos como "fora da vista": pausa como na aba oculta, mas S.visible não muda.
    // Uma piscada curta (fechar o modo ampliado, câmera cruzando a borda) não conta: só
    // pausamos se a camada continuar escondida por HOST_GRACE ms.
    const HOST_GRACE = 400;
    let hostTimer = 0;
    let fadeSafe = 0;
    function hostHides() { return el.style.visibility === 'hidden' || el.style.display === 'none'; }
    function onHostStyle() {
      if (S.disposed) return;
      // O transform muda a cada quadro (o mesmo atributo style); só a visibilidade importa.
      if (!hostHides()) {
        if (hostTimer) { global.clearTimeout(hostTimer); hostTimer = 0; }
        if (S.hostHidden) { S.hostHidden = false; syncRunning(); }
        return;
      }
      if (S.hostHidden || hostTimer) return;
      hostTimer = global.setTimeout(() => {
        hostTimer = 0;
        if (S.disposed || !hostHides()) return;
        S.hostHidden = true;
        closeMenu(false);
        closeDrop(false);
        if (el.contains(doc.activeElement)) { try { doc.activeElement.blur(); } catch (err) { /* nada */ } }
        syncRunning();
      }, HOST_GRACE);
    }
    const hostObs = global.MutationObserver ? new global.MutationObserver(onHostStyle) : null;
    if (hostObs) hostObs.observe(el, { attributes: true, attributeFilter: ['style'] });
    function syncRunning() {
      const run = isRunning();
      if (run !== S.running) {
        S.running = run;
        el.classList.toggle('aos-paused', !run);
        if (!run) {
          clearAllTimers();
          finishCafe();
          flushPane();
          if (S.byePending) finishBye();
          endDrag();
        } else {
          startClock();
          if (S.shown) {
            S.lastAct = Date.now();
            armIdle();
            if (!S.greeted) later('greet', 1200, greet);
            if (S.bubbleOn) later('bubble', 5000, hideBubble);
          }
          if (S.arcadeView === 'game' && S.gameId && !S.game && isShowing('arcade')) mountGame(false);
        }
      }
      updateGameVisibility();
    }
    function isShowing(id) { return S.open.indexOf(id) >= 0 && !S.min.has(id); }

    /* ---------- relógio ---------- */
    function renderClock() {
      const d = new Date();
      refs.clock.textContent = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
      refs.clock.dateTime = d.toISOString();
      refs.clock.title = longDate(d);
    }
    function startClock() {
      renderClock();
      const d = new Date();
      later('clock', 60050 - (d.getSeconds() * 1000 + d.getMilliseconds()), startClock);
    }

    /* ---------- leitor de tela ---------- */
    function announce(text) { refs.sr.textContent = ''; refs.sr.textContent = text; }

    /* ---------- janelas ---------- */
    function resolveApp(raw) {
      const s = norm(raw);
      if (!s) return null;
      if (APPS[s]) return { app: s };
      if (s === 'sobre_mim' || s === 'sobre_mim.txt' || s === 'sobremim' || s === 'sobre mim') return { app: 'sobre' };
      if (s === 'jogo' || s === 'jogar') return { app: 'arcade', play: 'blocos' };
      // Nome exato do cartucho (ou 'arcade:<jogo>'): abre o Arcade já jogando.
      const gs = slug(s.indexOf('arcade:') === 0 ? s.slice(7) : s).replace(/[:._]/g, '');
      if (isGame(gs)) return { app: 'arcade', play: gs };
      if (gs === 'zumbi' || gs === 'noitedoszumbis') return { app: 'arcade', play: 'zumbis' };
      if (gs === 'minimundo') return { app: 'arcade', play: 'mundo' };
      if (s.indexOf('proj:') === 0) {
        const pid = slug(s.slice(5));
        if (/cartucho|jogo|game|cart|blocos|zumbi|mundo|arcade/.test(pid)) return { app: 'arcade' };
        const p = findProject(pid);
        return { app: 'projetos', proj: p ? p.id : null };
      }
      if (s === 'projeto' || s === 'pasta') return { app: 'projetos' };
      if (s === 'tema' || s === 'cores') return { app: 'temas' };
      if (s === 'lixo') return { app: 'lixeira' };
      return null;
    }
    function topVisible() {
      for (let i = S.z.length - 1; i >= 0; i--) if (!S.min.has(S.z[i])) return S.z[i];
      return null;
    }
    function autofocusTarget(id) {
      if (id === 'arcade' && S.arcadeView === 'game') return null;
      return wins[id].querySelector('[data-autofocus]') || wins[id].querySelector('button');
    }
    // Reinicia uma animação curta de CSS (abrir janela, imagem subindo no CRT).
    // A classe sai sozinha no animationend (ver ONCE). Movimento reduzido não anima.
    function replay(n, cls) {
      n.classList.remove(cls);
      if (S.reduced) return;
      void n.offsetWidth;
      n.classList.add(cls);
    }
    function focusEl(n) { if (n && S.visible) { try { n.focus({ preventScroll: true }); } catch (err) { n.focus(); } } }
    function refreshActive() {
      S.z.forEach((wid, i) => { wins[wid].style.zIndex = String(10 + i); });
      APP_ORDER.forEach(w => wins[w].classList.toggle('is-active', w === S.active));
      renderTasks();
    }
    function focusWin(id, moveFocus) {
      if (!wins[id]) return;
      S.z = S.z.filter(x => x !== id);
      S.z.push(id);
      S.active = id;
      refreshActive();
      if (moveFocus && !wins[id].contains(doc.activeElement)) {
        if (id === 'arcade' && S.arcadeView === 'game') focusGame();
        else focusEl(autofocusTarget(id));
      }
    }
    // Altura da área das janelas: acima da barra de tarefas (48 px embaixo) ou, no tema sistema,
    // abaixo da barra de menus (o contêiner .aos-windows desce MENU_H px no CSS).
    function areaH() { return S.theme === 'sistema' ? H - MENU_H : AREA_H; }
    function setPos(id, x, y) {
      const w = wins[id];
      const ww = w.offsetWidth || APPS[id].w;
      const wh = w.offsetHeight || APPS[id].h;
      const nx = Math.round(clamp(x, 0, Math.max(0, W - ww)));
      const ny = Math.round(clamp(y, 0, Math.max(0, areaH() - wh)));
      S.pos[id] = { x: nx, y: ny };
      w.style.left = nx + 'px';
      w.style.top = ny + 'px';
    }

    function openApp(raw, o) {
      if (S.disposed) return false;
      o = o || {};
      const r = resolveApp(raw);
      if (!r) return false;
      const id = r.app;
      closeMenu(false);
      const wasOpen = S.open.indexOf(id) >= 0;
      const wasMin = S.min.has(id);
      if (!wasOpen) {
        S.open.push(id);
        setPos(id, APPS[id].x, APPS[id].y);
      }
      S.min.delete(id);
      wins[id].hidden = false;
      if (!wasOpen || wasMin) replay(wins[id], 'is-opening');
      focusWin(id, o.focus !== false);
      if (r.proj) highlightProject(r.proj);
      if (id === 'arcade' && !r.play && (!wasOpen || wasMin)) renderSave();
      if (r.play) play(r.play, o.focus !== false);
      updateGameVisibility();
      if (id === 'terminal') caretSync(false); // a janela acabou de ganhar layout
      if (!wasOpen || wasMin) {
        announce(APPS[id].title + ' aberto.');
        if (!o.silent) emit('open', { app: id });
        // Abrindo direto num jogo (Terminal 'abrir zumbis', openApp('mundo')) o balão do Arcade
        // cairia por cima do canto do jogo (o joystick, no toque): fica quieto.
        if (!wasOpen && !o.silent && !r.play) capiSay(CAPI.open[id]);
      }
      return true;
    }
    function hideWindowWork(id) {
      if (id === 'terminal') finishCafe();
      if (id === 'arcade') clearLater('retry');
    }
    // Depois de fechar/minimizar: a próxima janela vira a ativa. O foco só anda
    // se estava dentro da janela que sumiu (fechar por fora não rouba o foco).
    function afterHide(id, hadFocus, focusIcon) {
      S.active = topVisible();
      refreshActive();
      updateGameVisibility();
      if (!S.visible || !hadFocus) return;
      if (S.active) {
        if (S.active === 'arcade' && S.arcadeView === 'game') focusGame();
        else focusEl(autofocusTarget(S.active));
      } else if (focusIcon) {
        selectIcon(APP_ORDER.indexOf(id), true);
      } else {
        focusEl(el);
      }
    }
    function closeApp(raw) {
      if (S.disposed) return false;
      const r = resolveApp(raw);
      if (!r) return false;
      const id = r.app;
      if (S.open.indexOf(id) < 0) return false;
      const hadFocus = wins[id].contains(doc.activeElement);
      hideWindowWork(id);
      if (id === 'arcade') disposeGame();
      S.open = S.open.filter(x => x !== id);
      S.z = S.z.filter(x => x !== id);
      S.min.delete(id);
      wins[id].hidden = true;
      afterHide(id, hadFocus, true);
      announce(APPS[id].title + ' fechado.');
      emit('close', { app: id });
      return true;
    }
    function minimizeApp(id) {
      if (S.open.indexOf(id) < 0 || S.min.has(id)) return false;
      hideWindowWork(id);
      const hadFocus = wins[id].contains(doc.activeElement);
      S.min.add(id);
      wins[id].hidden = true;
      afterHide(id, hadFocus && !!topVisible(), false);
      if (hadFocus && !S.active) focusEl(S.theme === 'sistema' ? mtitle('arquivo') : refs.tasks.querySelector('[data-task="' + id + '"]'));
      announce(APPS[id].title + ' minimizado.');
      emit('minimize', { app: id });
      return true;
    }
    function renderTasks() {
      const focusedTask = doc.activeElement && doc.activeElement.dataset && refs.tasks.contains(doc.activeElement) ? doc.activeElement.dataset.task : null;
      refs.tasks.innerHTML = S.open.map(id => {
        const on = id === S.active && !S.min.has(id);
        const min = S.min.has(id);
        return '<button type="button" class="aos-task' + (on ? ' is-on' : '') + (min ? ' is-min' : '') + '" data-task="' + id + '" aria-pressed="' + on + '"' +
          ' aria-label="' + esc(APPS[id].title) + (min ? ', minimizada' : '') + '">' + px(ICONS[APPS[id].icon], 24) + '<span>' + esc(APPS[id].title) + '</span></button>';
      }).join('');
      if (focusedTask) focusEl(refs.tasks.querySelector('[data-task="' + focusedTask + '"]'));
    }
    function taskClick(id) {
      if (S.min.has(id)) openApp(id);
      else if (S.active === id) minimizeApp(id);
      else focusWin(id, true);
    }

    /* ---------- ícones ---------- */
    function selectIcon(i, moveFocus) {
      const icons = el.querySelectorAll('.aos-icon');
      if (i < 0) { icons.forEach(n => n.classList.remove('is-selected')); return; }
      S.sel = clamp(i, 0, icons.length - 1);
      icons.forEach((n, k) => {
        n.classList.toggle('is-selected', k === S.sel);
        n.tabIndex = k === S.sel ? 0 : -1;
      });
      if (moveFocus) focusEl(icons[S.sel]);
    }
    function iconKey(k, moveFocus) {
      const n = APP_ORDER.length;
      if (k === 'ArrowDown' || k === 'ArrowRight') { selectIcon((S.sel + 1) % n, moveFocus); return true; }
      if (k === 'ArrowUp' || k === 'ArrowLeft') { selectIcon((S.sel - 1 + n) % n, moveFocus); return true; }
      if (k === 'Home') { selectIcon(0, moveFocus); return true; }
      if (k === 'End') { selectIcon(n - 1, moveFocus); return true; }
      if (k === 'Enter') { openApp(APP_ORDER[S.sel]); return true; }
      return false;
    }

    /* ---------- menu Iniciar ---------- */
    function menuItems() { return Array.prototype.slice.call(refs.menu.querySelectorAll('.aos-mi')); }
    function openMenu(moveFocus) {
      closeDrop(false);
      S.menu = true;
      refs.menu.hidden = false;
      startBtn.setAttribute('aria-expanded', 'true');
      startBtn.classList.add('is-pressed');
      S.menuIdx = 0;
      hotMenu(moveFocus);
    }
    function closeMenu(returnFocus) {
      if (!S.menu) return;
      S.menu = false;
      refs.menu.hidden = true;
      startBtn.setAttribute('aria-expanded', 'false');
      startBtn.classList.remove('is-pressed');
      menuItems().forEach(n => n.classList.remove('is-hot'));
      if (returnFocus) focusEl(startBtn);
    }
    function hotMenu(moveFocus) {
      const items = menuItems();
      items.forEach((n, i) => n.classList.toggle('is-hot', i === S.menuIdx));
      if (moveFocus) focusEl(items[S.menuIdx]);
    }
    function menuKey(k, native) {
      const items = menuItems();
      if (k === 'ArrowDown') { S.menuIdx = (S.menuIdx + 1) % items.length; hotMenu(true); return true; }
      if (k === 'ArrowUp') { S.menuIdx = (S.menuIdx - 1 + items.length) % items.length; hotMenu(true); return true; }
      if (k === 'Home') { S.menuIdx = 0; hotMenu(true); return true; }
      if (k === 'End') { S.menuIdx = items.length - 1; hotMenu(true); return true; }
      if ((k === 'Enter' || k === ' ') && !native) { items[S.menuIdx].click(); return true; }
      if (k === 'Tab') { closeMenu(false); return false; }
      return false;
    }

    /* ---------- barra de menus do tema sistema (menus suspensos estilo Mac) ---------- */
    function mtitle(name) { return refs.mbar.querySelector('[data-menu="' + name + '"]'); }
    // Itens de cada menu. Cada ação reaproveita o que o desktop já sabe fazer (ver runDrop).
    function dropList(name) {
      if (name === 'os') return [{ act: 'open:sobre', label: 'Sobre mim…' }, 'sep', { act: 'shutdown', label: 'Desligar' }];
      if (name === 'arquivo') {
        const it = APP_ORDER.filter(id => id === 'projetos' || id === 'terminal' || id === 'lixeira').map(id => ({ act: 'open:' + id, label: APPS[id].menu }));
        // Sem barra de tarefas, é aqui que se volta a uma janela (inclusive minimizada).
        if (S.open.length) {
          it.push('sep', 'head:Janelas abertas');
          S.open.forEach(id => {
            const min = S.min.has(id);
            it.push({ act: 'win:' + id, label: APPS[id].title, check: id === S.active && !min, note: min ? 'minimizada' : '',
              aria: APPS[id].title + (min ? ', minimizada' : id === S.active ? ', na frente' : '') });
          });
        }
        it.push('sep', { act: 'close-active', label: 'Fechar janela', disabled: !S.active });
        return it;
      }
      if (name === 'tela') {
        return THEME_ORDER.map(t => ({ act: 'theme:' + t, label: THEMES[t].nome, check: t === S.theme, radio: true }))
          .concat(['sep', { act: 'expand', label: S.expanded ? 'Voltar ao quarto' : 'Ampliar a tela' }]);
      }
      if (name === 'especial') return [{ act: 'open:arcade', label: 'Arcade' }].concat(GAME_ORDER.map(id => ({ act: 'play:' + id, label: 'Jogar ' + GAMES[id].nome })));
      return [{ act: 'help', label: 'Comandos do terminal' }, { act: 'tip', label: 'Dica do guará' }];
    }
    function dropMarkup(name) {
      return dropList(name).map(it => it === 'sep' ? '<div class="aos-dsep" role="separator"></div>' :
        typeof it === 'string' ? '<div class="aos-dhead" role="presentation">' + esc(it.slice(5)) + '</div>' :
        '<button type="button" tabindex="-1" class="aos-di" data-di="' + it.act + '" role="' + (it.radio ? 'menuitemradio' : 'menuitem') + '"' +
          (it.radio ? ' aria-checked="' + !!it.check + '"' : '') + (it.disabled ? ' aria-disabled="true"' : '') + (it.aria ? ' aria-label="' + esc(it.aria) + '"' : '') + '>' +
          '<span class="aos-di-ck" aria-hidden="true">' + (it.check ? px(GLYPH.check, 16) : '') + '</span>' +
          '<span class="aos-di-t">' + esc(it.label) + '</span>' + (it.note ? '<small aria-hidden="true">' + esc(it.note) + '</small>' : '') +
        '</button>').join('');
    }
    function dropItems() { return Array.prototype.slice.call(refs.drop.querySelectorAll('.aos-di:not([aria-disabled="true"])')); }
    function openDrop(name, moveFocus) {
      if (S.disposed || S.theme !== 'sistema' || !mtitle(name)) return;
      if (S.menu) closeMenu(false);
      const t = mtitle(name);
      refs.mbar.querySelectorAll('[data-menu]').forEach(b => { const on = b === t; b.classList.toggle('is-open', on); b.setAttribute('aria-expanded', String(on)); });
      S.drop = name;
      refs.drop.innerHTML = dropMarkup(name);
      refs.drop.setAttribute('aria-label', MENU_NOME[name]);
      refs.drop.hidden = false;
      // Logo abaixo do título do menu, sem sair da tela pela direita.
      refs.drop.style.left = Math.max(0, Math.min(t.offsetLeft, W - refs.drop.offsetWidth - 4)) + 'px';
      S.dropIdx = moveFocus ? 0 : -1;
      hotDrop(moveFocus);
    }
    function closeDrop(returnFocus) {
      if (!S.drop) return;
      const t = mtitle(S.drop);
      S.drop = null;
      S.dropIdx = -1;
      refs.drop.hidden = true;
      refs.drop.innerHTML = '';
      refs.mbar.querySelectorAll('[data-menu]').forEach(b => { b.classList.remove('is-open'); b.setAttribute('aria-expanded', 'false'); });
      if (returnFocus) focusEl(t);
    }
    function hotDrop(moveFocus) {
      const items = dropItems();
      items.forEach((n, i) => n.classList.toggle('is-hot', i === S.dropIdx));
      if (moveFocus && items[S.dropIdx]) focusEl(items[S.dropIdx]);
    }
    function nextMenu(dir) { return MENUS[(MENUS.indexOf(S.drop) + dir + MENUS.length) % MENUS.length]; }
    function dropKey(k, native) {
      const items = dropItems();
      const n = items.length;
      if (!n) return k !== 'Tab';
      if (k === 'ArrowDown') { S.dropIdx = (S.dropIdx + 1) % n; hotDrop(true); return true; }
      if (k === 'ArrowUp') { S.dropIdx = S.dropIdx < 0 ? n - 1 : (S.dropIdx - 1 + n) % n; hotDrop(true); return true; }
      if (k === 'Home') { S.dropIdx = 0; hotDrop(true); return true; }
      if (k === 'End') { S.dropIdx = n - 1; hotDrop(true); return true; }
      if (k === 'ArrowRight' || k === 'ArrowLeft') { openDrop(nextMenu(k === 'ArrowRight' ? 1 : -1), true); return true; }
      if ((k === 'Enter' || k === ' ') && !native) { if (items[S.dropIdx]) items[S.dropIdx].click(); return true; }
      if (k === 'Tab') { closeDrop(false); return false; }
      return false;
    }
    function runDrop(act) {
      const i = act.indexOf(':');
      const verb = i < 0 ? act : act.slice(0, i);
      const arg = i < 0 ? '' : act.slice(i + 1);
      // O foco volta ao título do menu quando a ação não abre janela (tema, dica, ampliar).
      const hadFocus = refs.drop.contains(doc.activeElement);
      const opens = verb === 'open' || verb === 'win' || verb === 'play' || verb === 'help';
      closeDrop(hadFocus && !opens);
      switch (verb) {
        case 'open': case 'win': openApp(arg); break;
        case 'play': play(arg, true); break;
        case 'close-active': if (S.active) closeApp(S.active); break;
        case 'theme':
          applyTheme(arg, true);
          if (hadFocus && S.theme !== 'sistema') focusEl(startBtn); // a barra de menus sumiu junto com o tema
          break;
        case 'expand': requestExpand(); break;
        case 'help': openApp('terminal'); runCommand('ajuda'); if (S.active === 'terminal') focusEl(input); break;
        case 'tip': if (!S.capiOn) capiBack(); else capiTip(); break;
        case 'shutdown': capiSay(CAPI.shutdown, 3000); emit('shutdown'); break;
        default: break;
      }
    }

    /* ---------- Esc: menu, pane, janela ativa (nunca a página) ---------- */
    function handleEscape() {
      if (S.menu) { closeMenu(true); return true; }
      if (S.drop) { closeDrop(true); return true; }
      if (S.pane.length || S.paneQueue.length) { fixPane(); return true; }
      // Esc com um jogo rodando pausa a partida em vez de fechar o Arcade (e perder o jogo).
      // O NOITE DOS ZUMBIS já pausa sozinho com o Esc no canvas; pausado, o Esc chega aqui e fecha.
      if (S.active === 'arcade' && S.arcadeView === 'game' && S.game && callGame('isRunning')) { callGame('pause'); return true; }
      if (S.active) { closeApp(S.active); return true; }
      return false;
    }

    /* ---------- temas ---------- */
    function applyTheme(name, fromUser) {
      if (S.disposed) return false;
      const t = normTheme(name);
      if (!t) return false;
      const changed = t !== S.theme;
      if (changed) { closeMenu(false); closeDrop(false); }
      S.theme = t;
      el.dataset.theme = t;
      // A área útil muda com o tema (barra embaixo ou menus no topo): janelas abertas cabem nela.
      if (changed) S.open.forEach(id => setPos(id, S.pos[id].x, S.pos[id].y));
      el.querySelectorAll('[data-theme-pick]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themePick === t)));
      caretSync(false);
      if (fromUser) {
        saveTheme(t);
        emit('theme', t);
        if (changed && Object.prototype.hasOwnProperty.call(CAPI.theme, t)) capiSay(CAPI.theme[t]);
        announce('Tema ' + THEMES[t].nome + '.');
      }
      return true;
    }

    /* ---------- capi.exe ---------- */
    function capiSay(text, ms) {
      if (!S.capiOn || S.disposed || !text) return;
      refs.bubbletext.textContent = text;
      refs.bubble.hidden = false;
      S.bubbleOn = true;
      S.bubbleAt = Date.now();
      const c = refs.capi;
      c.classList.remove('is-hop');
      if (!S.reduced) { void c.offsetWidth; c.classList.add('is-hop'); }
      if (S.running) later('bubble', ms || 6500, hideBubble);
    }
    function hideBubble() { refs.bubble.hidden = true; S.bubbleOn = false; clearLater('bubble'); }
    // O balão sai do caminho quando a pessoa volta a mexer (mas não no mesmo gesto que o abriu).
    function dismissBubbleOnActivity() {
      if (S.bubbleOn && Date.now() - S.bubbleAt > 600) hideBubble();
    }
    // Com um jogo na tela o "oi" cairia em cima dele: o guará cumprimenta calado (fica para a próxima).
    function greet() { S.greeted = true; if (!gameInView()) capiSay(CAPI.greet, 7500); }
    function capiTip() {
      let tip = TIPS[S.tip % TIPS.length];
      if (S.theme === 'sistema' && tip.indexOf('Iniciar') >= 0) tip = 'dica: o menu do guará, lá em cima, tem tudo. até o desligar.';
      capiSay(tip, 7000);
      S.tip++;
    }
    function capiBye() {
      if (!S.capiOn) return;
      capiSay(CAPI.bye, 2000);
      S.byePending = true;
      if (S.running) later('bye', 1700, finishBye); else finishBye();
    }
    function finishBye() {
      S.byePending = false;
      S.capiOn = false;
      hideBubble();
      refs.capi.hidden = true;
      clearLater('idle');
      emit('capi', { visible: false });
    }
    function capiBack() {
      clearLater('bye');
      const wasOff = !S.capiOn || S.byePending;
      S.byePending = false;
      S.capiOn = true;
      refs.capi.hidden = false;
      capiSay(wasOff ? CAPI.back : CAPI.pet);
      if (wasOff) emit('capi', { visible: true });
      return wasOff;
    }

    /* ---------- parado por 30 s ---------- */
    function bump() {
      S.lastAct = Date.now();
      if (!S.shown) { S.shown = true; if (S.running && !S.greeted) later('greet', 1200, greet); }
      if (S.running && !timers.has('idle') && S.capiOn) armIdle();
    }
    function armIdle() {
      if (!S.capiOn) return;
      const left = Math.max(500, IDLE_MS - (Date.now() - S.lastAct));
      later('idle', left, () => {
        // Com o Arcade aberto o balão cairia por cima dos jogos (e dos botões de toque): fica quieto.
        if (S.active === 'arcade') return;
        if (Date.now() - S.lastAct >= IDLE_MS - 50) capiSay(CAPI.idle, 8000); // só volta a armar com nova atividade
        else armIdle();
      });
    }

    /* ---------- pane ---------- */
    function addError(i, msg) {
      const box = doc.createElement('div');
      box.className = 'aos-err' + (S.reduced ? '' : ' is-new');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', 'Erro do sistema');
      box.style.left = (96 + i * 52) + 'px';
      box.style.top = (40 + i * 44) + 'px';
      box.style.zIndex = String(i + 1);
      box.innerHTML = '<div class="aos-err-bar"><span>Erro do sistema</span>' +
        '<button type="button" class="aos-wbtn" data-act="err-close" aria-label="Fechar este erro">' + px(GLYPH.close, 16) + '</button></div>' +
        '<div class="aos-err-body">' + px(ICONS.err, 48) + '<p>' + esc(msg) + '</p></div>' +
        '<div class="aos-err-foot"><button type="button" class="aos-btn" data-act="err-close">OK</button></div>';
      refs.errors.appendChild(box);
      S.pane.push(box);
      emit('error', { source: 'pane' });
    }
    function startPane() {
      clearPane();
      S.paneQueue = PANE.slice();
      let i = 0;
      const step = () => {
        if (!S.paneQueue.length) return;
        addError(i++, S.paneQueue.shift());
        if (!S.paneQueue.length) return;
        if (S.reduced || !S.running) step(); else later('pane', 150, step);
      };
      step();
      announce(PANE.length + ' janelas de erro. Esc ou consertar remove todas.');
      emit('pane', { count: PANE.length });
      capiSay(CAPI.pane);
    }
    function flushPane() {
      clearLater('pane');
      while (S.paneQueue.length) addError(S.pane.length, S.paneQueue.shift());
    }
    function clearPane() {
      clearLater('pane');
      const n = S.pane.length + S.paneQueue.length;
      S.paneQueue = [];
      S.pane.forEach(b => b.remove());
      S.pane = [];
      return n;
    }
    function fixPane() {
      const n = clearPane();
      if (n) { emit('fix', { count: n }); capiSay(CAPI.fix); announce('Pane resolvida.'); }
      return n;
    }
    function closeOneError(box) {
      const i = S.pane.indexOf(box);
      if (i < 0) return;
      S.pane.splice(i, 1);
      box.remove();
      if (!S.pane.length && !S.paneQueue.length) { emit('fix', { count: 1 }); capiSay(CAPI.fix); }
    }

    /* ---------- Arcade: um cartucho por vez no gamehost ---------- */
    function pad6(n) { return String(n).padStart(6, '0'); }
    function renderRecord() {
      refs.record.textContent = pad6(S.recs.blocos);
      refs.recordz.textContent = pad6(S.recs.zumbis);
      const g = isGame(S.gameId) ? GAMES[S.gameId] : null;
      refs.record2.textContent = pad6(g && g.recorde ? S.recs[S.gameId] || 0 : 0);
    }
    // O jogo está na frente da pessoa (Arcade aberto, na vista do jogo, com um cartucho dentro).
    function gameInView() { return !!S.gameId && S.arcadeView === 'game' && isShowing('arcade'); }
    // Barra de cima do jogo: nome do cartucho e o recorde dele (o MINI MUNDO não tem placar).
    function renderGameBar() {
      const g = GAMES[isGame(S.gameId) ? S.gameId : 'blocos'];
      refs.gamename.textContent = g.nome;
      refs.gamehost.setAttribute('aria-label', g.nome);
      refs.gamerec.hidden = !g.recorde;
      refs.gamesave.hidden = !!g.recorde;
      renderRecord();
      renderSave();
    }
    // MINI MUNDO: a ilha fica guardada neste navegador? O jogo montado sabe (getState().salvaOk,
    // inclusive se uma gravação falhou depois); sem ele, AndreyMundo.podeSalvar() testa o armazenamento.
    function mundoSalva() {
      if (S.game && S.gameId === 'mundo') {
        const st = callGame('getState');
        if (st && typeof st.salvaOk === 'boolean') return st.salvaOk;
      }
      const L = global.AndreyMundo;
      if (L && typeof L.podeSalvar === 'function') { try { return !!L.podeSalvar(); } catch (err) { return false; } }
      return canStore();
    }
    function renderSave() {
      const ok = mundoSalva();
      const bar = ok ? 'SALVO NESTE NAVEGADOR' : 'NÃO DÁ PARA SALVAR NESTE NAVEGADOR';
      if (refs.gamesave.textContent !== bar) refs.gamesave.textContent = bar;
      refs.gamesave.classList.toggle('is-warn', !ok);
      const p = el.querySelector('[data-cart="mundo"] [data-cartline]');
      const linha = ok ? GAMES.mundo.linha : GAMES.mundo.linhaSemSalvar;
      if (p && p.textContent !== linha) p.textContent = linha;
    }
    // Nos cartuchos, o que está na tela pausado diz "Continuar" (volta de onde parou).
    function renderCarts() {
      el.querySelectorAll('[data-play]').forEach(b => {
        if (!b.closest('.aos-cartbox')) return;
        const id = b.dataset.play;
        const cont = !!S.game && S.gameId === id;
        b.textContent = cont ? 'Continuar' : 'Jogar';
        b.setAttribute('aria-label', (cont ? 'Continuar ' : 'Jogar ') + GAMES[id].nome);
      });
    }
    function showArcade(view) {
      S.arcadeView = view;
      refs.carts.hidden = view !== 'carts';
      refs.game.hidden = view !== 'game';
      if (view === 'carts') { clearLater('retry'); renderCarts(); renderSave(); }
      updateGameVisibility();
    }
    function play(game, moveFocus) {
      if (!isGame(game)) return false;
      if (S.open.indexOf('arcade') < 0 || S.min.has('arcade')) openApp('arcade', { focus: false });
      else focusWin('arcade', false);
      // Trocar de cartucho tira o anterior inteiro (dispose: para o laço, solta o teclado,
      // libera o canvas e, no MINI MUNDO, o contexto WebGL). O mesmo cartucho só volta à vista.
      if (S.gameId && S.gameId !== game) unmountGame();
      S.gameId = game;
      S.lastGame = game;
      renderGameBar();
      showArcade('game');
      // O balão do guará cobre o canto de baixo do jogo (e o joystick do toque): sai da frente.
      hideBubble();
      S.retries = 0;
      mountGame(moveFocus !== false);
      return true;
    }
    function focusGame() {
      if (S.game && typeof S.game.focus === 'function') { if (S.visible) callGame('focus'); }
      else focusEl(refs.gamehost);
    }
    function mountGame(moveFocus) {
      const id = S.gameId;
      if (!isGame(id)) return;
      const gh = refs.gamehost;
      if (S.game) { updateGameVisibility(); if (moveFocus) focusGame(); return; }
      const L = global[GAMES[id].lib];
      if (!L || typeof L.create !== 'function') {
        // O script do jogo ainda não chegou (rede lenta): mostra o cartucho carregando e tenta de novo.
        if (S.retries < 60) {
          if (!gh.querySelector('.aos-loading') || gh.querySelector('.aos-loading button')) gh.innerHTML = loadingMarkup(id);
          if (S.running) { S.retries++; later('retry', 500, () => { if (S.arcadeView === 'game' && S.gameId === id && isShowing('arcade')) mountGame(false); }); }
        } else {
          gh.innerHTML = loadingMarkup(id, 'o cartucho não encaixou. tente de novo daqui a pouco.');
        }
        if (moveFocus) focusEl(gh);
        return;
      }
      clearLater('retry');
      S.retries = 0;
      gh.innerHTML = '';
      // Cada montagem tem a sua ficha: aviso que chega de um jogo que já saiu (dispose no meio
      // do aviso, troca de cartucho) é descartado em vez de mexer no placar do jogo novo.
      const tok = {};
      S.gameTok = tok;
      let api = null;
      try {
        api = L.create(gh, { onEvent: (kind, detail) => { if (S.gameTok === tok) onGameEvent(id, kind, detail); } });
      } catch (err) {
        if (global.console) global.console.warn('[AndreyDesktop] ' + GAMES[id].nome + ' não ligou:', err);
        api = null;
      }
      if (S.gameTok !== tok) {
        // Um aviso de dentro do create fechou o Arcade ou trocou de cartucho: este jogo não fica.
        if (api && typeof api.dispose === 'function') { try { api.dispose(); } catch (err) { /* nada */ } }
        return;
      }
      if (!api) {
        S.gameTok = null;
        gh.innerHTML = loadingMarkup(id, 'o cartucho falhou. feche e abra o Arcade de novo.');
        return;
      }
      S.game = api;
      S.gameVis = null;
      updateGameVisibility();
      if (!GAMES[id].titulo) callGame('start');
      if (S.gameTok !== tok) return;
      renderSave();
      if (moveFocus && S.gameTok === tok) focusGame();
    }
    // Tira o jogo do gamehost (dispose), mas o Arcade continua na vista em que estava.
    function unmountGame() {
      clearLater('retry');
      const g = S.game;
      S.game = null;
      S.gameTok = null;
      S.gameVis = null;
      if (g && typeof g.dispose === 'function') {
        try { g.dispose(); } catch (err) { if (global.console) global.console.warn('[AndreyDesktop] dispose do jogo falhou:', err); }
      }
      refs.gamehost.innerHTML = '';
      // O dispose grava o placar: relê o salvo para a fileira de cartuchos e a barra não ficarem para trás.
      GAME_ORDER.forEach(gid => { if (GAMES[gid].recorde) S.recs[gid] = Math.max(S.recs[gid], readRecord(gid)); });
      renderRecord();
    }
    // Fechar o Arcade (ou o desktop): o cartucho sai e a janela volta para a fileira de cartuchos.
    function disposeGame() {
      unmountGame();
      S.gameId = null;
      showArcade('carts');
    }
    function updateGameVisibility() {
      if (!S.game) { S.gameVis = null; return; }
      const v = S.running && isShowing('arcade') && S.arcadeView === 'game';
      if (v === S.gameVis) return;
      S.gameVis = v;
      callGame('setVisible', v);
    }
    function scoreOf(d) {
      if (typeof d === 'number') return d;
      if (!d || typeof d !== 'object') return null;
      const v = d.recorde != null ? d.recorde : d.record != null ? d.record : d.score != null ? d.score : d.pontos;
      const n = Number(v);
      return isFinite(n) ? n : null;
    }
    function onGameEvent(id, kind, detail) {
      emit(id, { kind: kind, detail: detail });
      // Começou ou voltou a jogar: um balão do guará que estava por cima do jogo sai da frente.
      if ((kind === 'start' || kind === 'resume') && S.bubbleOn && gameInView()) hideBubble();
      if (id === 'mundo' && (kind === 'save' || kind === 'start')) renderSave();
      if (!GAMES[id].recorde) return;
      if (kind === 'record') {
        const sc = scoreOf(detail);
        if (sc != null && sc > S.recs[id]) { S.recs[id] = Math.floor(sc); renderRecord(); }
        // No meio da partida o balão cairia em cima do jogo; ele só aparece com o jogo parado
        // (o primeiro recorde sai logo depois do fim de jogo).
        if (!(gameInView() && callGame('isRunning'))) capiSay(CAPI.record);
        emit('record', { score: S.recs[id], game: id });
      } else if (kind === 'hit' || kind === 'pickup') {
        // Os pontos da partida passaram do recorde: o RECORDE da barra do jogo e o da fileira
        // de cartuchos acompanham (o 'record' do jogo sai uma vez só por partida).
        const t = detail && typeof detail === 'object' ? Number(detail.total) : NaN;
        if (isFinite(t) && t > S.recs[id]) { S.recs[id] = Math.floor(t); renderRecord(); }
      } else if (kind === 'gameover' || kind === 'start') {
        const r = detail && typeof detail === 'object' ? Number(detail.recorde) : NaN;
        const best = Math.max(S.recs[id], readRecord(id), isFinite(r) ? Math.floor(r) : 0);
        if (best > S.recs[id]) { S.recs[id] = best; renderRecord(); }
      }
    }
    function arcadeMsg(text) { if (refs.arcademsg.textContent !== text) refs.arcademsg.textContent = text; }

    /* ---------- Projetos ---------- */
    function highlightProject(pid) {
      const list = refs.projlist;
      list.querySelectorAll('.aos-proj-row').forEach(r => r.classList.toggle('is-hl', r.dataset.proj === pid));
      const row = pid ? list.querySelector('[data-proj="' + pid + '"]') : null;
      if (row) {
        const top = row.offsetParent === list ? row.offsetTop : row.offsetTop - list.offsetTop;
        list.scrollTop = Math.max(0, top - 8);
        focusEl(row.querySelector('a'));
      }
    }
    function openLink(p) {
      try { global.open(p.url, '_blank', 'noopener'); } catch (err) { /* o link impresso no terminal resolve */ }
      emit('link', { id: p.id, url: p.url });
    }

    /* ---------- Lixeira ---------- */
    function showFile(i) {
      const f = LIXO[i];
      if (!f) return;
      S.trashSel = i;
      el.querySelectorAll('.aos-file').forEach((b, k) => { b.classList.toggle('is-selected', k === i); b.setAttribute('aria-pressed', String(k === i)); });
      refs.preview.textContent = f.txt;
      refs.trashstatus.textContent = f.nome;
    }

    /* ---------- Terminal ---------- */
    const log = refs.log;
    function trimLog() { while (log.childElementCount > LOG_MAX) log.firstElementChild.remove(); }
    function scrollLog() { log.scrollTop = log.scrollHeight; }
    function line(text, cls) {
      const p = doc.createElement('div');
      p.className = 'aos-tl' + (cls ? ' aos-tl--' + cls : '');
      p.textContent = text;
      log.appendChild(p);
      trimLog();
      scrollLog();
      return p;
    }
    function node(n) { log.appendChild(n); trimLog(); scrollLog(); return n; }
    function cmdButton(label, run, fill) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'aos-cmdbtn';
      b.textContent = label;
      if (fill) b.dataset.fill = run; else b.dataset.run = run;
      return b;
    }
    function buttonsLine(prefix, items) {
      const p = doc.createElement('div');
      p.className = 'aos-tl aos-tl--btns';
      if (prefix) p.appendChild(doc.createTextNode(prefix));
      items.forEach(it => p.appendChild(cmdButton(it[0], it[1], it[2])));
      return node(p);
    }
    function echo(cmd) {
      const p = doc.createElement('div');
      p.className = 'aos-tl aos-tl--echo';
      const s = doc.createElement('span');
      s.className = 'aos-tp';
      s.textContent = 'andrey@quarto ~ $';
      p.appendChild(s);
      p.appendChild(doc.createTextNode(' ' + cmd));
      node(p);
    }
    function pre(text, cls) {
      const p = doc.createElement('pre');
      p.className = 'aos-pre' + (cls ? ' ' + cls : '');
      p.textContent = text;
      return node(p);
    }
    function welcome() {
      line('AndreyOS 24 · terminal', 'title');
      line('Bem-vindo ao quarto do Andrey. Digite help ou clique num comando:', 'dim');
      buttonsLine('', [['help', 'help'], ['sobre', 'sobre'], ['projetos', 'projetos'], ['jogar', 'jogar'], ['cafe', 'cafe']]);
    }

    function printHelp() {
      line('Comandos do AndreyOS (clique para usar):', 'dim');
      const g = doc.createElement('div');
      g.className = 'aos-help';
      HELP.forEach(h => {
        g.appendChild(cmdButton(h.label, h.fill ? h.cmd + ' ' : h.cmd, h.fill));
        const d = doc.createElement('span');
        d.textContent = h.desc;
        g.appendChild(d);
      });
      node(g);
    }

    const CUP = [
      '     .-------------.',
      '     |             |--.',
      '     |  AndreyOS   |  |',
      '     |     24      |--\'',
      '     \'-------------\'',
      '      \\___________/'
    ];
    const STEAM = [
      ['        (  )   (', '         )  (   )', '        (   )  ('],
      ['         )  (  )', '        (   ) (', '         ) (   )'],
      ['        (   ) (', '         ) (   )', '        (  )   ('],
      ['         ( )  (', '        )  (  )', '         (  ) (']
    ];
    function cafeFrame(f) { return STEAM[f % STEAM.length].concat(CUP).join('\n'); }
    function startCafe() {
      finishCafe();
      const p = pre(cafeFrame(0), 'aos-cafe');
      p.setAttribute('aria-label', 'Uma xícara de café fumegante desenhada com letras.');
      S.cafe = { pre: p, f: 0 };
      line('café servido. cuidado que está quente.', 'ok');
      if (!S.reduced && S.running && isShowing('terminal')) {
        every('cafe', 420, () => {
          if (!S.cafe) return;
          S.cafe.f++;
          S.cafe.pre.textContent = cafeFrame(S.cafe.f);
          if (S.cafe.f >= 11) finishCafe();
        });
      }
    }
    function finishCafe() {
      clearLater('cafe');
      S.cafe = null;
    }

    function cmdProjetos() {
      line('Projetos (clique no nome para abrir):', 'dim');
      PROJETOS.forEach(p => {
        const r = doc.createElement('div');
        r.className = 'aos-tl aos-tl--proj';
        r.appendChild(cmdButton(p.id, 'abrir ' + p.id));
        const s = doc.createElement('span');
        s.textContent = p.nome + ': ' + p.linha;
        r.appendChild(s);
        node(r);
      });
      line('abrindo a pasta Projetos…', 'dim');
      openApp('projetos');
    }
    function cmdAbrir(arg) {
      if (!arg) {
        line('abrir o quê? escolha um:', 'warn');
        buttonsLine('', PROJETOS.map(p => [p.id, 'abrir ' + p.id]));
        return;
      }
      const p = findProject(arg);
      if (p) {
        openLink(p);
        const r = doc.createElement('div');
        r.className = 'aos-tl aos-tl--ok';
        r.appendChild(doc.createTextNode('abrindo ' + p.nome + ' (' + p.linha + ') numa aba nova. Não abriu? '));
        const a = doc.createElement('a');
        a.href = p.url; a.target = '_blank'; a.rel = 'noopener'; a.className = 'aos-cmdbtn'; a.textContent = 'clique aqui ↗';
        r.appendChild(a);
        node(r);
        return;
      }
      const app = resolveApp(arg);
      if (app) { line('abrindo ' + APPS[app.app].title + '…', 'ok'); openApp(arg); return; }
      line('não achei “' + arg + '”. Os projetos são:', 'warn');
      buttonsLine('', PROJETOS.map(pp => [pp.id, 'abrir ' + pp.id]));
    }
    function cmdJogar(argS) {
      const cartuchos = GAME_ORDER.map(id => [id, 'jogar ' + id]);
      if (!argS) { buttonsLine('jogar o quê? ', cartuchos); return; }
      const id = gameFrom(argS);
      if (id) { line('inserindo o cartucho ' + GAMES[id].nome + '…', 'ok'); play(id, true); return; }
      buttonsLine('não conheço esse cartucho. Tente: ', cartuchos).classList.add('aos-tl--warn');
    }
    function cmdTela(arg) {
      const t = normTheme(arg);
      if (!t) {
        line((arg ? 'tema “' + arg + '” não existe. ' : '') + 'tema atual: ' + S.theme + '. Opções:', arg ? 'warn' : 'dim');
        buttonsLine('', THEME_ORDER.map(x => [x, 'tela ' + x]));
        return;
      }
      applyTheme(t, true);
      line('tela ' + t + ': ' + THEMES[t].desc + '.', 'ok');
    }
    function cmdTour(argS) {
      const stop = TOUR[argS];
      if (!stop) {
        line((argS ? 'não conheço esse lugar. ' : '') + 'para onde? ', argS ? 'warn' : 'dim');
        buttonsLine('', ['mesa', 'estante', 'mural', 'janela'].map(x => [x, 'tour ' + x]));
        return;
      }
      line('levando a câmera até ' + TOUR_NOME[argS] + '…', 'ok');
      if (typeof opts.onTour === 'function') {
        try { opts.onTour(stop); } catch (err) { if (global.console) global.console.warn('[AndreyDesktop] onTour falhou:', err); }
      }
    }
    function cmdData() {
      const d = new Date();
      line(longDate(d) + ', ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + '.');
    }

    function runCommand(raw) {
      const text = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, INPUT_MAX);
      echo(text);
      if (!text) return;
      if (S.hist[S.hist.length - 1] !== text) S.hist.push(text);
      if (S.hist.length > 50) S.hist.shift();
      S.histIdx = S.hist.length;
      S.draft = '';
      emit('command', { command: text });
      const parts = text.split(' ');
      const cmd = slug(parts[0]);
      const arg = parts.slice(1).join(' ');
      const argS = slug(arg);
      switch (cmd) {
        case 'help': case 'ajuda': case '?': printHelp(); break;
        case 'sobre':
          line('Oi! Eu sou o Andrey Bueno, 24 anos, estudante de Engenharia de Software (4º período). Gosto de criar coisas com código: sites, sistemas, jogos e peças impressas em 3D.');
          buttonsLine('Quer ler com calma? ', [['abrir sobre_mim.txt', 'abrir sobre']]);
          break;
        case 'projetos': cmdProjetos(); break;
        case 'abrir': case 'open': cmdAbrir(arg); break;
        case 'jogar': case 'play': cmdJogar(argS); break;
        case 'tela': case 'tema': cmdTela(arg); break;
        case 'cafe': case 'coffee': startCafe(); break;
        case 'pet': case 'capi': case 'guara': case 'lobo':
          if (capiBack()) line('guara.exe voltou para o canto da tela.', 'ok');
          else line('guara.exe está no canto da tela. Clique nele para uma dica.', 'ok');
          break;
        case 'contato': case 'insta': case 'instagram': case 'github':
          line('GitHub: github.com/andreybueno-git · Instagram: @andreyb.bueno');
          (function () {
            const p = doc.createElement('div');
            p.className = 'aos-tl';
            [['GitHub ↗', 'https://github.com/andreybueno-git'], ['Instagram ↗', 'https://www.instagram.com/andreyb.bueno/']].forEach(function (l, i) {
              if (i) p.appendChild(doc.createTextNode(' · '));
              const a = doc.createElement('a'); a.href = l[1]; a.target = '_blank'; a.rel = 'noopener'; a.textContent = l[0];
              p.appendChild(a);
            });
            node(p);
          })();
          break;
        case 'tour': cmdTour(argS); break;
        case 'pane': line('ih.', 'warn'); startPane(); break;
        case 'consertar': {
          const n = fixPane();
          line(n ? 'pronto. ' + n + ' erros varridos para debaixo do tapete.' : 'nada quebrado. por enquanto.', 'ok');
          break;
        }
        case 'sudo': line('nem com sudo.', 'warn'); break;
        case 'limpar': case 'clear': case 'cls': log.textContent = ''; break;
        case 'data': case 'date': case 'hora': cmdData(); break;
        case 'quem': case 'whoami':
          line('você: visitante curioso, logado como convidado.');
          line('dono do quarto: Andrey Bueno.', 'dim');
          break;
        case 'ls': case 'dir':
          line('sobre_mim.txt  Projetos/  Arcade/  Terminal  Temas  Lixeira/');
          break;
        case 'sair': case 'exit':
          line('até mais.', 'dim');
          closeApp('terminal');
          break;
        default:
          line('Hmm, não conheço “' + parts[0] + '”. Digite help para ver o que eu sei fazer.', 'warn');
          buttonsLine('', [['help', 'help']]);
          emit('error', { source: 'terminal' });
      }
    }

    function histMove(dir) {
      if (!S.hist.length) return;
      if (S.histIdx === S.hist.length) S.draft = input.value;
      S.histIdx = clamp(S.histIdx + dir, 0, S.hist.length);
      input.value = S.histIdx === S.hist.length ? S.draft : S.hist[S.histIdx];
      const n = input.value.length;
      try { input.setSelectionRange(n, n); } catch (err) { /* sem cursor */ }
      caretSync(true);
    }
    function commonPrefix(list) {
      if (!list.length) return '';
      let p = list[0];
      list.forEach(s => { while (s.indexOf(p) !== 0) p = p.slice(0, -1); });
      return p;
    }
    function complete() {
      const v = input.value.replace(/^\s+/, '');
      const sp = v.indexOf(' ');
      if (sp < 0) {
        const base = norm(v);
        const c = COMMANDS.filter(x => x.indexOf(base) === 0);
        if (c.length === 1) input.value = c[0] + (ARGS[c[0]] ? ' ' : '');
        else if (c.length > 1) {
          const p = commonPrefix(c);
          if (p.length > base.length) input.value = p;
          else line(c.join('  '), 'dim');
        }
      } else {
        const cmd = slug(v.slice(0, sp));
        const rest = norm(v.slice(sp + 1));
        const list = ARGS[cmd] || [];
        const c = list.filter(x => x.indexOf(rest) === 0);
        if (c.length === 1) input.value = cmd + ' ' + c[0];
        else if (c.length > 1) {
          const p = commonPrefix(c);
          if (p.length > rest.length) input.value = cmd + ' ' + p;
          else line(c.join('  '), 'dim');
        }
      }
      const n = input.value.length;
      try { input.setSelectionRange(n, n); } catch (err) { /* sem cursor */ }
      caretSync(true);
    }
    function submitInput() {
      const v = input.value;
      input.value = '';
      runCommand(v);
      caretSync(true);
    }
    // Cursor em bloco (tema grafite): o campo é um <input> de verdade (foco, colar, leitor de tela);
    // o caret nativo fica transparente e este bloco é posicionado na coluna do cursor. A fonte é
    // monoespaçada, então a coluna vezes a largura de um caractere dá o x exato.
    const CARET_THEMES = { grafite: true, sistema: true };
    let caretCtx = null;
    function charWidth() {
      const cs = global.getComputedStyle(input);
      try {
        caretCtx = caretCtx || doc.createElement('canvas').getContext('2d');
        caretCtx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
        const w = caretCtx.measureText('0000000000').width / 10;
        if (w > 0) return w;
      } catch (err) { /* sem canvas: estima pela fonte */ }
      return parseFloat(cs.fontSize) * 0.6;
    }
    function caretSync(typing) {
      const c = refs.caret;
      if (!c || S.disposed || !CARET_THEMES[S.theme] || !input.offsetParent) return;
      const a = input.selectionStart, b = input.selectionEnd;
      const col = a == null ? input.value.length : a;
      const cw = charWidth();
      const padL = parseFloat(global.getComputedStyle(input).paddingLeft) || 0;
      const min = input.offsetLeft + padL;
      const max = input.offsetLeft + input.clientWidth - cw;
      c.style.width = cw.toFixed(2) + 'px';
      c.style.left = clamp(min + col * cw - input.scrollLeft, min, Math.max(min, max)).toFixed(2) + 'px';
      c.style.top = (input.offsetTop + input.offsetHeight / 2) + 'px';
      c.classList.toggle('is-range', a !== b);
      // Enquanto digita, o bloco fica aceso (como num terminal); volta a piscar logo depois.
      if (typing) { c.classList.add('is-busy'); later('caret', 700, () => c.classList.remove('is-busy')); }
    }
    // Tecla para o terminal quando o foco não está no campo (veio de fora ou do log).
    function termKey(k) {
      if (k === 'Enter') { submitInput(); return true; }
      if (k === 'Backspace') { input.value = input.value.slice(0, -1); caretSync(true); return true; }
      if (k === 'ArrowUp') { histMove(-1); return true; }
      if (k === 'ArrowDown') { histMove(1); return true; }
      if (k === 'Tab') { complete(); return true; }
      if (k.length === 1) { if (input.value.length < INPUT_MAX) input.value += k; caretSync(true); return true; }
      return false;
    }
    function onInputKey(e) {
      const k = e.key;
      if (e.isComposing) return;
      if (k === 'Enter') { e.preventDefault(); submitInput(); emit('key', { key: k, app: 'terminal' }); return; }
      if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); histMove(k === 'ArrowUp' ? -1 : 1); return; }
      if (k === 'Tab' && !e.shiftKey && input.value.trim()) { e.preventDefault(); complete(); return; }
      if (!e.repeat && !e.metaKey && !e.ctrlKey && (k.length === 1 || k === 'Backspace')) emit('key', { key: k, app: 'terminal' });
    }

    /* ---------- teclas por app ---------- */
    function appKey(id, k, external) {
      if (id === 'terminal') {
        const used = termKey(k);
        if (used) {
          if (k !== 'Enter' && k !== 'Tab' && k !== 'ArrowUp' && k !== 'ArrowDown') emit('key', { key: k, app: 'terminal' });
          if (S.active === 'terminal') focusEl(input); // Enter pode ter aberto outra janela
        }
        return used;
      }
      if (id === 'arcade') {
        if (S.arcadeView === 'game' && S.game) {
          const used = !!callGame('handleKey', k);
          const inGame = !!(doc.activeElement && refs.gamehost.contains(doc.activeElement));
          // (teclas nascidas dentro do jogo já foram avisadas na captura)
          if (used && !(inGame && !external)) emit('key', { key: k, app: 'arcade' });
          // O 1º keydown chega aqui como um toque curto; com o foco no jogo, a repetição e o
          // keyup da tecla segurada vão direto para ele (andar e atirar sem parar, soltar certo).
          if (used && (external || !inGame)) focusGame();
          return used;
        }
        if (S.arcadeView === 'carts' && k === 'Enter') { play(S.lastGame, true); return true; }
        return false;
      }
      // Apps sem uso de teclado: quem começa a digitar cai no terminal.
      if (k.length === 1 && k !== ' ') { openApp('terminal'); return appKey('terminal', k, external); }
      return false;
    }

    function typeKey(key) {
      if (S.disposed || typeof key !== 'string' || !key) return false;
      bump();
      if (key === 'Escape' || key === 'Esc') return handleEscape();
      if (S.menu) return menuKey(key, false);
      if (S.drop) return dropKey(key, false);
      if (S.pane.length && key === 'Enter') { closeOneError(S.pane[S.pane.length - 1]); return true; }
      if (!S.active) {
        if (iconKey(key, false)) return true;
        // Ninguém aberto e a pessoa começou a digitar: o terminal assume.
        if (key.length === 1 && key !== ' ') { openApp('terminal'); return appKey('terminal', key, true); }
        return false;
      }
      return appKey(S.active, key, true);
    }

    /* ---------- arrasto ---------- */
    function startDrag(e, id) {
      const p = desktopPoint(e.clientX, e.clientY);
      if (!p || !isFinite(p.x) || !isFinite(p.y)) return;
      const bar = e.target.closest('.aos-titlebar');
      drag = { id: id, pid: e.pointerId, sx: p.x, sy: p.y, x0: S.pos[id].x, y0: S.pos[id].y, bar: bar };
      try { bar.setPointerCapture(e.pointerId); } catch (err) { /* segue sem captura */ }
      wins[id].classList.add('is-dragging');
    }
    function moveDrag(e) {
      if (!drag || e.pointerId !== drag.pid) return;
      const p = desktopPoint(e.clientX, e.clientY);
      if (!p || !isFinite(p.x) || !isFinite(p.y)) return;
      setPos(drag.id, drag.x0 + p.x - drag.sx, drag.y0 + p.y - drag.sy);
    }
    function endDrag(e) {
      if (!drag) return;
      if (e && e.pointerId !== drag.pid) return;
      try { if (drag.bar.hasPointerCapture && drag.bar.hasPointerCapture(drag.pid)) drag.bar.releasePointerCapture(drag.pid); } catch (err) { /* nada */ }
      if (wins[drag.id]) wins[drag.id].classList.remove('is-dragging');
      drag = null;
    }

    /* ---------- eventos da raiz ---------- */
    function requestExpand() {
      if (typeof opts.onExpandRequest !== 'function') return;
      try { opts.onExpandRequest(); } catch (err) { if (global.console) global.console.warn('[AndreyDesktop] onExpandRequest falhou:', err); }
    }
    function stop(e) { e.stopPropagation(); }
    ['pointerup', 'click', 'dblclick', 'keyup', 'contextmenu'].forEach(t => listen(el, t, stop));
    ['wheel', 'touchstart', 'touchmove'].forEach(t => listen(el, t, stop, { passive: true }));

    listen(el, 'pointerdown', e => {
      e.stopPropagation();
      bump();
      S.pointerType = e.pointerType || 'mouse';
      const t = e.target;
      if (!t.closest('.aos-capi')) dismissBubbleOnActivity();
      if (S.menu && !t.closest('.aos-menu') && !t.closest('.aos-start')) closeMenu(false);
      if (S.drop && !t.closest('.aos-drop') && !t.closest('.aos-mbar')) closeDrop(false);
      const w = t.closest('.aos-win');
      if (w) focusWin(w.dataset.win, false);
      const bar = t.closest('.aos-titlebar');
      if (bar && !t.closest('button') && (e.button === 0 || e.pointerType !== 'mouse')) {
        e.preventDefault(); // sem seleção de texto; o foco vai para dentro da janela arrastada
        startDrag(e, bar.dataset.drag);
        focusWin(bar.dataset.drag, true);
        return;
      }
      if (t === el || t.closest('.aos-wall')) {
        selectIcon(-1);
        focusEl(el);
      }
    });
    listen(el, 'pointermove', e => { if (drag) moveDrag(e); moveCursor(e); });
    listen(el, 'pointerover', e => {
      moveCursor(e);
      if (!S.drop || !e.target.closest) return;
      const mt = e.target.closest('[data-menu]');
      if (mt && mt.dataset.menu !== S.drop) { openDrop(mt.dataset.menu, false); S.dropHoverAt = Date.now(); return; }
      const di = e.target.closest('.aos-di');
      if (di) { const i = dropItems().indexOf(di); if (i >= 0 && i !== S.dropIdx) { S.dropIdx = i; hotDrop(false); } }
    });
    listen(el, 'pointerleave', () => el.classList.remove('has-soft-cursor'));
    // Nos cartuchos, apontar ou focar um deles mostra os controles dele na linha de baixo.
    function cartHint(t) {
      const box = t && t.closest ? t.closest('.aos-cartbox') : null;
      if (box && isGame(box.dataset.cart)) arcadeMsg(GAMES[box.dataset.cart].dica);
    }
    listen(refs.carts, 'pointerover', e => { if (e.pointerType === 'mouse' || !e.pointerType) cartHint(e.target); });
    listen(refs.carts, 'focusin', e => cartHint(e.target));
    listen(el, 'pointerup', endDrag);
    listen(el, 'pointercancel', endDrag);
    listen(el, 'lostpointercapture', endDrag);

    listen(el, 'focusin', e => {
      const icon = e.target.closest && e.target.closest('.aos-icon');
      if (icon) selectIcon(Number(icon.dataset.idx), false); // a seleção segue o foco (Tab ou programático)
      const w = e.target.closest && e.target.closest('.aos-win');
      if (w && S.active !== w.dataset.win && !S.min.has(w.dataset.win)) focusWin(w.dataset.win, false);
    });
    // Os jogos consomem as próprias teclas (stopPropagation); na captura só avisamos a cena
    // para o teclado 3D afundar uma tecla. Quem decide o que a tecla faz continua sendo o jogo.
    listen(el, 'keydown', e => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.key === 'Escape' || e.key === 'Tab') return;
      if (refs.gamehost.contains(e.target)) emit('key', { key: e.key, app: 'arcade' });
    }, true);
    listen(refs.form, 'submit', e => { e.preventDefault(); submitInput(); });
    listen(input, 'keydown', onInputKey);
    listen(input, 'input', () => caretSync(true));
    listen(input, 'focus', () => caretSync(false));
    listen(input, 'blur', () => caretSync(false));
    // Setas, Home/End e clique movem o cursor sem 'input'; o rAF espera o campo rolar.
    listen(doc, 'selectionchange', () => { if (doc.activeElement === input) global.requestAnimationFrame(() => caretSync(false)); });
    if (doc.fonts && doc.fonts.addEventListener) listen(doc.fonts, 'loadingdone', () => caretSync(false));

    listen(el, 'dblclick', e => {
      const icon = e.target.closest('.aos-icon');
      if (icon) openApp(icon.dataset.icon);
    });

    listen(el, 'click', e => {
      const t = e.target;
      const mt = t.closest('[data-menu]');
      if (mt) {
        // O mouse que passou por cima já abriu este menu: o clique logo em seguida não o fecha.
        if (S.drop !== mt.dataset.menu) openDrop(mt.dataset.menu, e.detail === 0);
        else if (e.detail === 0 || Date.now() - S.dropHoverAt > 500) closeDrop(false);
        return;
      }
      const di = t.closest('[data-di]');
      if (di) { if (di.getAttribute('aria-disabled') !== 'true') runDrop(di.dataset.di); return; }
      const b = t.closest('[data-act],[data-open],[data-play],[data-theme-pick],[data-task],[data-run],[data-fill],[data-file],[data-run-term],[data-link],.aos-icon');
      if (!b) {
        // O cartucho inteiro (arte, nome e descrição) joga: no celular o botão Jogar é minúsculo.
        const cb = t.closest('.aos-cartbox');
        if (cb && isGame(cb.dataset.cart)) { play(cb.dataset.cart, true); return; }
        // Clique no corpo do terminal leva o foco ao prompt (sem atrapalhar seleção de texto).
        const tw = t.closest('.aos-win--terminal .aos-winbody');
        const sel = global.getSelection ? String(global.getSelection()) : '';
        if (tw && !sel) focusEl(input);
        return;
      }
      if (b.classList.contains('aos-icon')) {
        const i = Number(b.dataset.idx);
        selectIcon(i, false);
        // Um clique abre (o cursor vira mãozinha no ícone); o duplo clique antigo continua funcionando.
        if (e.detail <= 1) openApp(b.dataset.icon);
        return;
      }
      if (b.dataset.open) { openApp(b.dataset.open); return; }
      if (b.dataset.play) { play(b.dataset.play, true); return; }
      if (b.dataset.themePick) { applyTheme(b.dataset.themePick, true); return; }
      if (b.dataset.task) { taskClick(b.dataset.task); return; }
      if (b.dataset.file != null) { showFile(Number(b.dataset.file)); return; }
      if (b.dataset.link) {
        const p = PROJETOS.find(x => x.id === b.dataset.link);
        if (p) emit('link', { id: p.id, url: p.url });
        return;
      }
      // Depois do comando, o foco só volta ao prompt se o terminal continuar na frente:
      // "projetos", "jogar blocos" e "abrir sobre" trazem outra janela e ela tem de ficar no topo.
      if (b.dataset.runTerm) { openApp('terminal'); runCommand(b.dataset.runTerm); if (S.active === 'terminal') focusEl(input); return; }
      if (b.dataset.run != null) { if (!isShowing('terminal')) openApp('terminal'); runCommand(b.dataset.run); if (S.active === 'terminal') focusEl(input); return; }
      if (b.dataset.fill != null) {
        if (!isShowing('terminal')) openApp('terminal');
        input.value = b.dataset.fill;
        focusEl(input);
        const n = input.value.length;
        try { input.setSelectionRange(n, n); } catch (err) { /* nada */ }
        return;
      }
      const act = b.dataset.act;
      const w = b.closest('.aos-win');
      switch (act) {
        case 'min': if (w) minimizeApp(w.dataset.win); break;
        case 'close': if (w) closeApp(w.dataset.win); break;
        case 'start':
          // No tema sistema o Iniciar some; quem faz o papel dele é o menu AndreyOS da barra de cima.
          if (S.theme === 'sistema') { if (S.drop === 'os') closeDrop(false); else openDrop('os', e.detail === 0); }
          else if (S.menu) closeMenu(false); else openMenu(e.detail === 0);
          break;
        case 'shutdown': closeMenu(false); capiSay(CAPI.shutdown, 3000); emit('shutdown'); break;
        case 'expand': requestExpand(); break;
        case 'capi': capiTip(); break;
        case 'capi-tip': capiTip(); break;
        case 'capi-bye': capiBye(); break;
        case 'err-close': closeOneError(b.closest('.aos-err')); break;
        case 'carts': showArcade('carts'); focusEl(refs.carts.querySelector('[data-play="' + (S.gameId || S.lastGame) + '"]')); break;
        case 'restore': refs.trashstatus.textContent = 'Restaurar? Esses ficam aqui. São história.'; break;
        case 'empty': refs.trashstatus.textContent = 'Esvaziar? Nem pensar. Vai que precisa.'; break;
        default: break;
      }
    });

    listen(el, 'keydown', e => {
      e.stopPropagation();
      bump();
      const k = e.key;
      const t = e.target;
      if (e.isComposing) return;
      if (!(t.closest && t.closest('.aos-capi'))) dismissBubbleOnActivity();
      if (k === 'Escape' || k === 'Esc') { if (handleEscape()) e.preventDefault(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (S.menu) {
        if (t === startBtn && (k === 'Enter' || k === ' ')) return; // o próprio botão alterna o menu
        if (menuKey(k, refs.menu.contains(t))) e.preventDefault();
        return;
      }
      const mt = t.closest && t.closest('[data-menu]');
      if (S.drop) {
        if (mt && (k === 'Enter' || k === ' ')) return; // o próprio título abre e fecha
        if (dropKey(k, refs.drop.contains(t))) e.preventDefault();
        return;
      }
      if (mt && (k === 'ArrowDown' || k === 'ArrowUp')) { e.preventDefault(); openDrop(mt.dataset.menu, true); return; }
      if (mt && (k === 'ArrowRight' || k === 'ArrowLeft')) {
        e.preventDefault();
        focusEl(mtitle(MENUS[(MENUS.indexOf(mt.dataset.menu) + (k === 'ArrowRight' ? 1 : -1) + MENUS.length) % MENUS.length]));
        return;
      }
      if (t === input) return; // o próprio campo cuida (onInputKey)
      if (k === 'Tab') return;  // Tab navega entre controles
      const icon = t.closest && t.closest('.aos-icon');
      if (icon) {
        if (k === 'Enter') { e.preventDefault(); openApp(icon.dataset.icon); return; }
        if (iconKey(k, true)) e.preventDefault();
        return;
      }
      if (isTextField(t)) return;
      if (isControl(t) && (k === 'Enter' || k === ' ')) return; // Enter/Espaço ativam o botão focado
      if (S.pane.length && k === 'Enter' && !isControl(t)) { e.preventDefault(); closeOneError(S.pane[S.pane.length - 1]); return; }
      const w = t.closest && t.closest('.aos-win');
      const target = w ? w.dataset.win : S.active;
      if (!target) {
        if (t === el && iconKey(k, true)) { e.preventDefault(); return; }
        // Nenhuma janela aberta e a pessoa começou a digitar: o terminal assume (como no typeKey).
        if (k.length === 1 && k !== ' ') { openApp('terminal'); if (appKey('terminal', k, false)) e.preventDefault(); }
        return;
      }
      if (appKey(target, k, false)) e.preventDefault();
    });

    // Animações de uma vez só perdem a classe ao terminar. Sem isso, mover o nó para o
    // <dialog> ampliado (e de volta) reiniciava todas: tela apagando, janelas e erros pulando.
    const ONCE = { 'aos-open': 'is-opening', 'aos-fade': 'is-on', 'aos-pop': 'is-new' };
    listen(el, 'animationend', e => {
      if (e.animationName === 'aos-hop') { refs.capi.classList.remove('is-hop'); return; }
      const cls = ONCE[e.animationName];
      if (cls && e.target.classList) e.target.classList.remove(cls);
    });

    function onVisibility() { syncRunning(); }
    listen(doc, 'visibilitychange', onVisibility);
    // Clique fora do desktop (na cena 3D, no HUD) fecha o menu Iniciar, como num SO de verdade.
    listen(doc, 'pointerdown', e => { if (!el.contains(e.target)) { closeMenu(false); closeDrop(false); } }, true);

    /* ---------- estado inicial ---------- */
    GAME_ORDER.forEach(id => { if (GAMES[id].recorde) S.recs[id] = readRecord(id); });
    renderRecord();
    renderSave();
    welcome();
    openApp('sobre', { silent: true, focus: false });
    syncRunning();

    /* ------------------------------------------------------------------ */
    /* API pública                                                         */
    /* ------------------------------------------------------------------ */
    const api = {
      el: el,
      setVisible: function (v) {
        if (S.disposed) return;
        const appearing = !!v && (!S.visible || !S.shown);
        S.visible = !!v;
        // Ao (re)aparecer, a imagem sobe do preto em poucos degraus, como um CRT esquentando.
        // Se a camada ainda estiver escondida pelo integrador, a animação espera pausada.
        if (appearing) {
          replay(refs.fade, 'is-on');
          // Rede de segurança: se o animationend nunca chegar (página sem quadros), o preto sai.
          if (fadeSafe) global.clearTimeout(fadeSafe);
          fadeSafe = global.setTimeout(() => { fadeSafe = 0; refs.fade.classList.remove('is-on'); }, 3000);
        }
        if (appearing) hideBubble(); // o "boa noite" do desligar não volta quando o PC liga de novo
        if (S.visible) {
          S.shown = true;
          el.inert = false;
          el.removeAttribute('aria-hidden');
        } else {
          closeMenu(false);
          closeDrop(false);
          endDrag();
          if (el.contains(doc.activeElement)) { try { doc.activeElement.blur(); } catch (err) { /* nada */ } }
          el.inert = true;
          el.setAttribute('aria-hidden', 'true');
        }
        const was = S.running;
        syncRunning();
        if (S.visible && was && !S.greeted && !timers.has('greet')) later('greet', 1200, greet);
        if (S.visible && was && !timers.has('idle')) { S.lastAct = Date.now(); armIdle(); }
      },
      openApp: function (id) { return openApp(id); },
      closeApp: function (id) { return closeApp(id); },
      setTheme: function (name) { return applyTheme(name, false); },
      getTheme: function () { return S.theme; },
      typeKey: typeKey,
      setExpanded: function (v) {
        if (S.disposed) return;
        S.expanded = !!v;
        el.classList.toggle('aos-expanded', S.expanded);
        const b = refs.expand;
        b.setAttribute('aria-label', S.expanded ? 'Voltar a tela para o quarto' : 'Ampliar a tela do computador');
        b.innerHTML = px(S.expanded ? GLYPH.shrink : GLYPH.expand, 16);
      },
      dispose: function () {
        if (S.disposed) return;
        disposeGame();
        S.disposed = true;
        clearAllTimers();
        drag = null;
        listeners.forEach(l => { try { l[0].removeEventListener(l[1], l[2], l[3]); } catch (err) { /* nada */ } });
        listeners.length = 0;
        if (hostObs) hostObs.disconnect();
        if (hostTimer) { global.clearTimeout(hostTimer); hostTimer = 0; }
        if (fadeSafe) { global.clearTimeout(fadeSafe); fadeSafe = 0; }
        if (mq) { try { mq.removeEventListener('change', onMotion); } catch (err) { try { mq.removeListener(onMotion); } catch (err2) { /* nada */ } } }
        if (el.parentNode) el.parentNode.removeChild(el);
      },
      // Só para testes e depuração.
      _debug: function () {
        return {
          visible: S.visible, running: S.running, hostHidden: S.hostHidden, theme: S.theme, open: S.open.slice(), minimized: Array.from(S.min),
          active: S.active, timers: Array.from(timers.keys()), game: S.gameId, gameMounted: !!S.game, gameVisible: S.gameVis,
          blocos: S.gameId === 'blocos' && !!S.game, blocosVisible: S.gameId === 'blocos' ? S.gameVis : null,
          arcadeView: S.arcadeView, pane: S.pane.length, capi: S.capiOn, bubble: S.bubbleOn ? refs.bubbletext.textContent : null,
          pos: JSON.parse(JSON.stringify(S.pos)), record: S.recs.blocos, records: { blocos: S.recs.blocos, zumbis: S.recs.zumbis },
          history: S.hist.slice(), menu: S.menu, drop: S.drop
        };
      },
      _desktopPoint: desktopPoint,
      // Só para testes: a api do jogo montado no Arcade (ou null).
      _game: function () { return S.game; }
    };
    return api;
  }

  global.AndreyDesktop = { create: create, W: W, H: H };
})(window);
