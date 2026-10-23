/* AndreyOS teaser: costura a cena 3D (AndreyScene), o desktop (AndreyDesktop) e o fluxo
 * de entrada: quarto escuro → ligar → BIOS → desktop projetado na tela do CRT → passeio. */
(function (global) {
  'use strict';
  const W = 1024, H = 768;
  const $ = (s) => document.querySelector(s);
  const reducedQuery = global.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reducedQuery.matches;
  let scene = null, desktop = null, state = 'off', stop = 'pc', timers = new Set(), projecting = false, expanded = false, placeholder = null, raf = 0, movedDuringBoot = false, lastPowerAt = -1e9, audio = null;

  // Projetos da estante e do app Projetos. Os ids do 3D são casados por palavra-chave.
  const PROJECTS = [
    { keys: ['lumin', 'vereda', 'lamp'], kicker: 'Vereda · 2026', title: 'Vereda', body: 'Luminárias e peças impressas em 3D, uma de cada vez, em Palmas (TO). Fiz o plano de negócio, a apresentação 3D do ciclo de vida do serviço e a loja.', links: [['A loja', 'https://veredacerrado.com/'], ['Apresentação 3D', 'https://andreybueno-git.github.io/vereda-ciclo-de-vida/'], ['Plano de negócio', 'https://andreybueno-git.github.io/vereda-apresentacao/']] },
    { keys: ['globo', 'flash', 'snow', 'natal'], kicker: 'FlashClip · 2026', title: 'FlashClip Natal', body: 'Três propostas natalinas para o FlashClip, com um globo 3D interativo.', links: [['Abrir', 'https://andreybueno-git.github.io/flashclip-natal/']] },
    { keys: ['livro', 'prolog', 'book', 'paradigma'], kicker: 'Faculdade · 2026', title: 'Paradigmas: Prolog', body: 'O paradigma lógico em Prolog, com um sistema especialista de recomendação acadêmica.', links: [['Apresentação', 'https://andreybueno-git.github.io/paradigmas-prolog/'], ['Código', 'https://andreybueno-git.github.io/prolog-apresentacao-e-codigo/']] },
    { keys: ['caderno', 'front', 'notebook-book', 'azul'], kicker: 'Faculdade · 2026', low: true, title: 'Front-end E1 a E3', body: 'HTML semântico, layout responsivo com Flexbox e Grid e consumo de dados com fetch e os quatro estados da tela.', links: [['E1', 'https://andreybueno-git.github.io/front-end/'], ['E2', 'https://andreybueno-git.github.io/e2-layout-responsivo/'], ['E3', 'https://andreybueno-git.github.io/e3-fetch/']] },
    { keys: ['kanban', 'g2', 'svelte'], kicker: 'Faculdade · equipe · 2026', low: true, title: 'Projeto G2', body: 'Gerenciador de tarefas em Svelte 5 e TypeScript, feito em equipe com issues, pull requests e testes.', links: [['Apresentação do Marco 3', 'https://andreybueno-git.github.io/projeto-g2-frontend/marco-3/'], ['Código', 'https://github.com/andreybueno-git/projeto-g2-frontend']] },
    { keys: ['camera', 'câmera', 'metadados', 'foto'], kicker: 'Código aberto · 2026', low: true, title: 'Metadados Zero', body: 'Remove os metadados das fotos no próprio navegador, sem recompressão e sem upload.', links: [['Abrir', 'https://andreybueno-git.github.io/metadados-zero/']] },
    { keys: ['caixa', 'festejo', 'box'], kicker: 'App · 2026', low: true, title: 'festejo-app', body: 'App de controle de embalagens para o festejo da igreja.', links: [['Abrir', 'https://festejo-app.vercel.app']] },
    { keys: ['cartucho', 'jogo', 'game', 'cart', 'mercado', 'unity'], kicker: 'Jogo · Unity · 2026', title: 'Tudo Tem Preço', body: 'Simulador de mercadinho em pixel art, feito em Unity com C# na disciplina de jogos: clientes, estoque, fornecedores, economia que muda a cada dia e escolhas morais.', links: [['Ver no GitHub', 'https://github.com/andreybueno-git/MercadoFinal']] },
    { keys: ['katana', 'kage', 'samurai'], kicker: 'Jogo 3D · 2026', low: true, title: 'Kage no Toki', body: 'Protótipo de ação samurai em 3D, feito com Three.js.', links: [['Jogar o protótipo', 'https://brave-vapor-292.higgsfield.gg/']] },
    { keys: ['peca', 'peça', 'medalha', 'letra', 'impress', 'printer'], kicker: 'Impressão 3D · 2026', low: true, title: 'Peças impressas em 3D', body: 'Luminárias, letras bolha personalizáveis, medalhas e outras peças que eu modelo e imprimo.', links: [['Letras bolha', 'https://veredacerrado.com/personalizaveis/letras-bolha'], ['A loja', 'https://veredacerrado.com/']] }
  ];
  const STOP_HINT = { pc: 'O computador. Use o menu de cima para passear.', door: 'O quarto inteiro. "Computador" leva de volta à tela.', desk: 'A mesa. Clique na tela para chegar perto.', screen: 'Clique nos ícones ou digite no Terminal.', shelf: 'Clique num objeto da estante para ver o projeto.', board: 'O mural do que eu aprendi e estou aprendendo.', window: 'A janela segue a hora de quem visita.' };

  const BIOS_HINT = 'Teclas na BIOS: D, G ou S. Enter pula.';
  const narrow = () => global.innerWidth <= 760;
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, reduced ? 0 : ms); timers.add(t); return t; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); };
  // Igual ao later, mas o tempo vale também com movimento reduzido (a BIOS é conteúdo, não transição).
  const laterReal = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  function hint(text) { $('#hud-hint').textContent = text; measureHud(); syncInsets(); }
  // Diz à cena quantos px o HUD ocupa em cima e embaixo, para o monitor e a tela caberem no meio.
  function syncInsets() {
    if (!scene || !scene.setViewInsets) return;
    const H = global.innerHeight, shown = (el) => el && !el.hidden && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
    const top = Math.max(0, ...['.brand', '.tour'].map(q => $(q)).filter(shown).map(el => el.getBoundingClientRect().bottom)) + 8;
    const bottoms = [$('#hud-hint'), $('#power-cta')].filter(shown).map(el => H - el.getBoundingClientRect().top + 8);
    scene.setViewInsets(top, Math.max(12, ...bottoms));
  }
  // O botão de ligar muda de lugar: no monitor grafite gerado é o anel laranja; na reserva desenhada, o do gabinete.
  const offHint = () => document.body.dataset.pc === 'gerado' ? 'Aperte o botão laranja do monitor para ligar.' : 'Aperte o botão do gabinete para ligar.';
  function hintFor(s) { return state === 'off' && (s === 'pc' || s === 'door') ? offHint() : STOP_HINT[s] || ''; }
  function revealExpand() { try { $('[data-expand]').scrollIntoView({ inline: 'end', block: 'nearest' }); } catch (e) { /* navegador antigo */ } }
  // Sem 3D, "Ampliar" é o caminho para o computador: fica sempre habilitado (liga se precisar).
  function setState(next) { state = next; document.body.dataset.state = next; $('[data-expand]').disabled = !!scene && next !== 'on'; syncInsets(); }

  // ---------- Homografia: cola o desktop 1024×768 nos quatro cantos da tela 3D ----------
  function matrixFor(c) {
    const [a, b, cc, d] = c;
    const dx1 = b.x - cc.x, dx2 = d.x - cc.x, dx3 = a.x - b.x + cc.x - d.x, dy1 = b.y - cc.y, dy2 = d.y - cc.y, dy3 = a.y - b.y + cc.y - d.y;
    const det = dx1 * dy2 - dx2 * dy1; if (Math.abs(det) < 1e-9) return null;
    const g = (dx3 * dy2 - dx2 * dy3) / det, h = (dx1 * dy3 - dx3 * dy1) / det;
    const m = [(b.x - a.x + g * b.x) / W, (b.y - a.y + g * b.y) / W, 0, g / W, (d.x - a.x + h * d.x) / H, (d.y - a.y + h * d.y) / H, 0, h / H, 0, 0, 1, 0, a.x, a.y, 0, 1];
    return m.every(Number.isFinite) ? 'matrix3d(' + m.join(',') + ')' : null;
  }
  function project() {
    raf = requestAnimationFrame(project);
    if (!desktop || expanded || state !== 'on') return;
    const corners = scene && scene.isScreenFacing() ? scene.getScreenCorners() : null;
    const m = corners && corners.length === 4 ? matrixFor(corners) : null;
    if (!m) { if (projecting) { desktop.el.style.visibility = 'hidden'; projecting = false; } return; }
    desktop.el.style.transform = m;
    desktop.el.classList.toggle('is-projected', document.body.dataset.pc === 'gerado'); // cantos redondos só no vidro curvo
    if (!projecting) { desktop.el.style.visibility = 'visible'; projecting = true; }
  }

  // ---------- Ligar, BIOS e desligar ----------
  const BIOS = [
    'ANDREY BIOS v24.10',
    '',
    'Processador 486DX2 66 MHz ............ OK',
    'Memória base 640 KB ................... OK',
    'Café .................................. detectado',
    'Teclado e mouse ....................... OK',
    'Disquete A: projetos.img ........ 13 projetos',
    'Período ............................... 4º',
    '',
    'D = debug    G = arcade    S = segredo',
    '',
    'Iniciando AndreyOS 24'
  ];
  let biosShown = [], biosDone = null, biosNext = 0, biosLineTimers = [], biosEgg = false;
  function biosPush(line) { biosShown.push(line); scene && scene.setBiosLines(biosShown.slice(-20)); }
  function powerOn() {
    if (state !== 'off') return;
    clearTimers(); hideCard(); setState('warmup'); hint('Ligando…');
    if (audio) { audio.unlock(); audio.sfx('power'); } // o clique em ligar é o gesto que libera o som
    $('#power-cta').hidden = true;
    // Sem 3D não há tela para mostrar a BIOS: o desktop abre direto, ampliado.
    if (!scene) { bootDesktop(); return; }
    scene.setPower('warmup');
    lastPowerAt = performance.now();
    // de longe a BIOS ficaria fora de vista ou pequena; no celular, só a tela de perto dá para ler
    if (narrow()) goStop('screen'); else if (stop !== 'pc' && stop !== 'desk' && stop !== 'screen') goStop('pc');
    movedDuringBoot = false;
    later(() => {
      setState('bios'); scene && scene.setPower('bios'); biosShown = []; biosNext = 0; biosEgg = false; hint(BIOS_HINT);
      if (audio) audio.sfx('beep'); // o bipe do POST
      if (reduced) { // sem linhas surgindo uma a uma: a BIOS aparece inteira e fica um pouco para ser lida
        biosLineTimers = []; BIOS.forEach(line => biosPush(line)); biosNext = BIOS.length;
        biosDone = laterReal(() => bootDesktop(), 2200);
        return;
      }
      biosLineTimers = BIOS.map((line, i) => later(() => { biosNext = i + 1; biosPush(line); }, 120 + i * 210));
      biosDone = later(() => bootDesktop(), 120 + BIOS.length * 210 + 900);
    }, 650);
  }
  function bootDesktop(openApp) {
    if (state !== 'bios' && state !== 'warmup') return;
    clearTimers(); setState('on'); scene && scene.setPower('on');
    if (audio) { audio.sfx('boot'); audio.music(true); } // a trilha começa quando o AndreyOS aparece
    // Quem saiu passear durante a BIOS continua onde está; os outros vão para a tela.
    if (!movedDuringBoot) goStop('screen');
    desktop.setVisible(true);
    if (openApp) desktop.openApp(openApp);
    hint(hintFor(stop));
    if (!scene) expand();
    else if (narrow()) { hint('Toque em "Ampliar" para usar o AndreyOS com mais espaço.'); revealExpand(); }
  }
  function powerOff() {
    if (state === 'off') return;
    lastPowerAt = performance.now();
    if (audio) { audio.sfx('off'); audio.music(false); }
    clearTimers(); if (expanded) collapse(); desktop.setVisible(false); desktop.el.style.visibility = 'hidden'; projecting = false;
    try { $('.tour').scrollTo({ left: 0 }); } catch (e) { /* navegador antigo */ }
    setState('off'); scene && scene.setPower('off'); $('#power-cta').hidden = false; goStop('pc');
    hint(scene ? 'Desligado. Aperte o botão laranja para ligar de novo.' : 'Desligado. Use "Ligar o computador" para ligar de novo.');
  }
  // D e S: o resto da BIOS aparece de uma vez e entra o recado. Só o primeiro segredo vale.
  function biosEggLines(lines, wait) {
    if (biosEgg) return;
    biosEgg = true;
    clearTimeout(biosDone); timers.delete(biosDone);
    biosLineTimers.forEach(t => { clearTimeout(t); timers.delete(t); });
    while (biosNext < BIOS.length) biosPush(BIOS[biosNext++]);
    lines.forEach((l, i) => later(() => biosPush(l), i * 160));
    biosDone = reduced ? laterReal(() => bootDesktop(), wait + 800) : later(() => bootDesktop(), wait);
  }
  function biosKey(key) {
    const k = key.toLowerCase();
    if (k === 'd') { biosEggLines(['', '> debug ligado', '  compilando vontade de aprender ...... 100%', '  procurando bugs ..................... 3 (são recursos)', '  carregando curiosidade .............. sem limite', ''], 3000); return true; }
    if (k === 'g') { movedDuringBoot = false; bootDesktop('arcade'); return true; } // o Arcade abre na tela, então a câmera vai até ela
    if (k === 's') { biosEggLines(['', '> recado secreto:', '  Se você chegou até aqui, temos algo em comum:', '  curiosidade. Valeu por apertar o S.', ''], 2600); return true; }
    if (k === 'enter' || k === 'escape' || k === ' ') { bootDesktop(); return true; }
    return false;
  }

  // ---------- Câmera, cartões e escolhas na cena ----------
  function goStop(next, instant) {
    if (next === 'screen' && state === 'off') next = 'pc'; // desligado, "Computador" mostra o monitor inteiro
    stop = next; document.body.dataset.stop = next; scene && scene.goTo(next, { instant: !!instant || reduced });
    document.querySelectorAll('[data-stop]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.stop === next || (next === 'pc' && b.dataset.stop === 'screen'))));
    if (state === 'warmup' || state === 'bios') { movedDuringBoot = true; if (next === 'pc' || next === 'desk' || next === 'screen') { if (state === 'bios') hint(BIOS_HINT); return; } } // com a BIOS à vista, a dica é das teclas
    hint(hintFor(next));
  }
  function projectFor(id) { const s = String(id || '').toLowerCase(); return PROJECTS.find(p => p.keys.some(k => s.includes(k))) || null; }
  function showCard(kicker, title, body, links) {
    $('#card-kicker').textContent = kicker; $('#card-title').textContent = title; $('#card-body').textContent = body;
    const box = $('#card-links'); box.replaceChildren();
    (links || []).forEach(([label, href]) => { const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = label + ' ↗'; box.appendChild(a); });
    $('#card').hidden = false;
  }
  function showProject(p) { $('#card').dataset.low = p.low ? 'true' : 'false'; showCard(p.kicker, p.title, p.body, p.links); }
  // ---------- Post-its: arrastar e grudar onde quiser, escrever, criar e tirar; guardado só neste navegador ----------
  const NOTE_KEY = 'andreyos.postits.v2', NOTE_KEY_V1 = 'andreyos.postits';
  let noteId = null, noteSaveT = 0;
  function savedNotes() {
    try {
      const v2 = global.localStorage.getItem(NOTE_KEY); if (v2) return JSON.parse(v2) || [];
      const v1 = JSON.parse(global.localStorage.getItem(NOTE_KEY_V1) || '{}') || {}; // a primeira versão guardava só o texto por número
      return Object.keys(v1).map(k => ({ id: 'n' + k, texto: v1[k] }));
    } catch (e) { return []; }
  }
  function storeNotes(list) { clearTimeout(noteSaveT); noteSaveT = setTimeout(() => { try { global.localStorage.setItem(NOTE_KEY, JSON.stringify(list)); } catch (e) { /* sem storage: vale até recarregar */ } }, 250); }
  function openNote(id) {
    if (!scene || scene.getNote(id) == null) return;
    noteId = id; hideCard();
    const ed = $('#note-editor'), ta = $('#note-texto');
    ed.style.setProperty('--note', scene.getNoteColor(id)); ta.value = scene.getNote(id);
    $('[data-note-reset]').hidden = !scene.isDefaultNote(id);
    $('[data-note-remove]').hidden = scene.isDefaultNote(id); // os recados de fábrica só mudam de lugar e de texto; os seus dá para tirar
    ed.hidden = false; ta.focus(); ta.select();
    if (audio) audio.sfx('click');
  }
  function closeNote(action) {
    const ed = $('#note-editor'); if (ed.hidden) return;
    const t = $('#note-texto').value.trim(), novo = !scene.isDefaultNote(noteId);
    if (action === 'save') { if (t) scene.setNote(noteId, t); else if (novo && !scene.getNote(noteId)) scene.removeNote(noteId); }
    if (action === 'reset') scene.restoreNote(noteId);
    if (action === 'remove') scene.removeNote(noteId);
    if (action === 'cancel' && novo && !scene.getNote(noteId)) scene.removeNote(noteId); // post-it novo que ficou em branco não fica grudado
    ed.hidden = true; noteId = null;
    if (audio && action !== 'cancel') audio.sfx('click');
    hint(hintFor(stop));
  }
  function newNote() {
    if (!scene || !scene.newNote) return;
    closeNote('cancel'); hideCard(); scene.newNote();
    hint('Leve o post-it até onde quer grudar e clique. Esc cancela.');
    if (audio) { audio.unlock(); audio.sfx('click'); }
  }
  function hideCard() { $('#card').hidden = true; delete $('#card').dataset.low; }
  function onPick(name) {
    // Durante o aquecimento e a BIOS o botão não desliga: um duplo clique não liga e desliga na hora.
    // e logo depois de ligar ou desligar (duplo clique), também não
    if (name === 'power') { if (performance.now() - lastPowerAt < 900) return; if (state === 'off') powerOn(); else if (state === 'on') powerOff(); return; }
    if (name === 'screen') { if (state === 'on') goStop('screen'); else if (state === 'off') powerOn(); return; }
    if (String(name).startsWith('proj:')) {
      const p = projectFor(name.slice(5));
      if (p) { if (stop !== 'shelf') goStop('shelf'); showProject(p); }
      return;
    }
    if (String(name).startsWith('note:')) { openNote(name.slice(5)); return; }
    if (name === 'board') { if (stop !== 'board') goStop('board'); showCard('O mural', 'O que eu aprendi', 'Já aprendi: HTML semântico e CSS responsivo, JavaScript e fetch, Prolog, Git em equipe, cenas 3D com Three.js, monitoramento com Prometheus e Grafana, modelagem e impressão 3D. Estou aprendendo: Svelte 5, TypeScript, acessibilidade e testes automatizados.', [['Meus repositórios', 'https://github.com/andreybueno-git']]); return; }
    if (name === 'window') { if (stop !== 'window') goStop('window'); showCard('A janela', 'Contato', 'No site completo, a mensagem vira um avião de papel e sai voando por aqui. Por enquanto, me acha no GitHub ou no Instagram.', [['GitHub', 'https://github.com/andreybueno-git'], ['Instagram @andreyb.bueno', 'https://www.instagram.com/andreyb.bueno/']]); }
  }

  // ---------- Ampliar: o MESMO nó do desktop vai para um dialog ----------
  function fitExpanded() {
    if (!expanded) return;
    const stage = $('#pc-stage'), r = stage.getBoundingClientRect();
    const flat = Math.min(r.width / W, r.height / H), turned = Math.min(r.width / H, r.height / W);
    // Celular em pé: deitado, o desktop fica com menos de 40% do tamanho. Girado 90°, quase dobra.
    const coarse = global.matchMedia && global.matchMedia('(pointer: coarse)').matches;
    const rotate = coarse && flat < 0.55 && turned > flat * 1.3; // monitor em pé ou tablet não giram
    $('#pc-dialog').toggleAttribute('data-rotated', rotate);
    if (rotate) {
      desktop.el.style.transform = 'translate(' + Math.round((r.width + H * turned) / 2) + 'px,' + Math.round((r.height - W * turned) / 2) + 'px) rotate(90deg) scale(' + turned + ')';
    } else {
      desktop.el.style.transform = 'translate(' + Math.round((r.width - W * flat) / 2) + 'px,' + Math.round((r.height - H * flat) / 2) + 'px) scale(' + flat + ')';
    }
  }
  function expand() {
    if (expanded || state !== 'on') return;
    expanded = true; placeholder = document.createComment('pc'); desktop.el.parentNode.insertBefore(placeholder, desktop.el);
    $('#pc-stage').appendChild(desktop.el); desktop.el.classList.remove('is-projected'); desktop.el.style.visibility = 'visible'; desktop.setExpanded(true);
    $('#pc-dialog').showModal(); fitExpanded();
    desktop.el.focus({ preventScroll: true }); // o foco não fica no "Voltar ao quarto": Enter e letras vão para o computador
  }
  function collapse() {
    if (!expanded) return;
    expanded = false; desktop.setExpanded(false);
    if (placeholder && placeholder.parentNode) { placeholder.parentNode.insertBefore(desktop.el, placeholder); placeholder.remove(); }
    placeholder = null; projecting = false; desktop.el.style.visibility = 'hidden';
    if ($('#pc-dialog').open) $('#pc-dialog').close();
    if (!scene && state === 'on') { hint('Use "Ampliar" para voltar ao AndreyOS.'); $('[data-expand]').focus(); }
  }

  // ---------- Início ----------
  function syncSound() {
    const b = $('[data-sound]'); if (!b) return;
    if (!audio) { b.hidden = true; return; }
    const on = audio.isOn(); b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', on ? 'Som ligado. Clique para desligar.' : 'Som desligado. Clique para ligar.');
  }
  function dismissLoader() { document.body.classList.remove('is-loading'); const l = $('#loader'); if (l) l.hidden = true; }
  function start() {
    desktop = global.AndreyDesktop.create($('#pc-host'), {
      onTour(target) { const map = { mesa: 'desk', estante: 'shelf', mural: 'board', janela: 'window', tela: 'screen', computador: 'screen', porta: 'door', quarto: 'door' }; goStop(map[target] || target); },
      onEvent(kind, detail) {
        if (kind === 'theme' && scene) scene.setTheme(detail);
        if (kind === 'key' && scene) scene.pulse('key');
        if (kind === 'error' && scene) scene.pulse('error');
        if (kind === 'record' && scene) scene.pulse('win');
        if (audio) { if (kind === 'key') audio.sfx('key'); if (kind === 'error') audio.sfx('error'); if (kind === 'record') audio.sfx('win'); }
        // sons dos jogos novos (os nomes saem do topo do desktop.js): tiro e bloco curtinhos, mordida e erro graves
        if (audio && (kind === 'zumbis' || kind === 'mundo') && detail) {
          const k = detail.kind, Z = { shot: 'click', hit: 'key', hurt: 'error', wave: 'beep', pickup: 'boot', empty: 'error', gameover: 'off' }, M = { place: 'key', break: 'click', daynight: 'beep', reset: 'boot' };
          const nome = (kind === 'zumbis' ? Z : M)[k]; if (nome) audio.sfx(nome);
        }
        if (kind === 'shutdown') powerOff();
      },
      onExpandRequest() { expanded ? collapse() : expand(); }
    });
    desktop.el.style.visibility = 'hidden';
    // Clique dos ícones, botões e menus do AndreyOS (o desktop para a propagação na raiz, então o
    // ouvinte fica no próprio nó; os botões do BLOCOS ficam de fora para não virar metralhadora no jogo).
    desktop.el.addEventListener('pointerdown', (e) => {
      const t = e.target;
      if (!audio || !t.closest || t.closest('.blc, .zmb, .mnd-canvas')) return;
      if (t.closest('.aos-icon, button, a, [data-open], [data-act], [data-play], [data-theme-pick], [data-file], [data-run-term]')) audio.sfx('click');
    });
    // Som: trilha lo-fi e efeitos sintetizados no navegador (audio.js); a escolha de ligar/desligar fica salva.
    audio = global.AndreyAudio ? global.AndreyAudio.create({ storageKey: 'andreyos.som' }) : null;
    syncSound();
    // O loader espera a página e o PC gerado (5 MB). Teto de 9 s; "Entrar agora" funciona sempre.
    let pageLoaded = document.readyState === 'complete', pcSettled = false;
    const maybeDismiss = () => { if (pageLoaded && pcSettled) setTimeout(dismissLoader, 300); };
    global.addEventListener('andreyos:pc', () => { pcSettled = true; maybeDismiss(); if (state === 'off') hint(hintFor(stop)); }, { once: true });
    if (!pageLoaded) global.addEventListener('load', () => { pageLoaded = true; maybeDismiss(); }, { once: true });
    try {
      scene = global.AndreyScene.init({ canvas: $('#scene'), onPick, reducedMotion: reduced, onNotesChange: storeNotes, onNotePlaced: (id) => openNote(id) });
      scene.goTo('pc', { instant: true });
      if (desktop.getTheme) scene.setTheme(desktop.getTheme()); // a cópia 3D da tela começa no mesmo tema do desktop
      scene.loadNotes(savedNotes()); // post-its que a pessoa já moveu, escreveu ou criou
    } catch (error) {
      scene = null; document.body.classList.add('no-webgl');
      hint('Sem 3D aqui: o computador abre ampliado.');
      $('[data-expand]').disabled = false;
    }
    if (!scene || !global.AndreyPC || document.body.dataset.pc) pcSettled = true;
    maybeDismiss(); measureHud(); syncInsets();
    setTimeout(dismissLoader, Math.max(0, 9000 - (global.performance ? performance.now() : 0)));
    raf = requestAnimationFrame(project);
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-power')) powerOn();
    if (b.dataset.stop) { hideCard(); goStop(b.dataset.stop); if (e.detail) b.blur(); }
    if (b.hasAttribute('data-expand')) { if (!scene && state === 'off') powerOn(); expand(); }
    if (b.hasAttribute('data-collapse')) { collapse(); if (e.detail && scene && document.activeElement) document.activeElement.blur(); }
    if (b.hasAttribute('data-card-close')) hideCard();
    if (b.hasAttribute('data-skip')) dismissLoader();
    if (b.hasAttribute('data-note-save')) closeNote('save');
    if (b.hasAttribute('data-note-reset')) closeNote('reset');
    if (b.hasAttribute('data-note-cancel')) closeNote('cancel');
    if (b.hasAttribute('data-note-remove')) closeNote('remove');
    if (b.hasAttribute('data-newnote')) { newNote(); if (e.detail) b.blur(); }
    if (b.hasAttribute('data-sound') && audio) { audio.unlock(); const on = audio.toggle(); if (on && state === 'on') audio.music(true); syncSound(); }
  });
  $('#pc-dialog').addEventListener('cancel', (e) => { e.preventDefault(); collapse(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && scene && scene.isPlacingNote && scene.isPlacingNote()) { e.preventDefault(); scene.cancelNewNote(); hint(hintFor(stop)); return; }
    if (e.target.id === 'note-texto') { if (e.key === 'Escape') { e.preventDefault(); closeNote('cancel'); } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) { e.preventDefault(); closeNote('save'); } return; }
    if (e.target.closest && (e.target.closest('#pc-host') || e.target.closest('dialog'))) return;
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const onControl = e.target !== document.body && e.target.closest && !!e.target.closest('button, a, [tabindex]:not(#scene)');
    if (state === 'bios' && !(onControl && (e.key === 'Enter' || e.key === ' ')) && biosKey(e.key)) { e.preventDefault(); return; }
    if (e.key === 'Escape') hideCard();
    // Com a câmera na tela, o teclado do visitante digita no computador (letras, setas, Enter, Backspace).
    // Tab nunca vai: ele navega pela página. Com o foco num botão ou link do HUD, Enter, Espaço e setas
    // ficam com ele; só as letras seguem para o computador.
    const FORWARD = ['Enter', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete'];
    const letter = e.key.length === 1 && e.key !== ' ';
    if (scene && state === 'on' && stop === 'screen' && !expanded && !e.metaKey && !e.ctrlKey && !e.altKey && (letter || (!onControl && (e.key === ' ' || FORWARD.includes(e.key))))) {
      if (desktop.typeKey(e.key)) e.preventDefault();
    }
  });
  // Altura ocupada em cima (nome e, no celular, a fileira do passeio): a caixa de texto e o cartão começam abaixo dela.
  function measureHud() {
    const b = ['.brand', '.tour'].map(q => $(q)).filter(Boolean).map(el => el.getBoundingClientRect().bottom); if (b.length) document.documentElement.style.setProperty('--hud-h', Math.ceil(Math.max(...b) + 10) + 'px');
    const h = $('#hud-hint'); if (h) document.documentElement.style.setProperty('--hint-h', Math.ceil(h.getBoundingClientRect().height) + 'px'); // o botão de ligar fica acima da dica no celular
  }
  global.addEventListener('resize', () => { scene && scene.resize(); fitExpanded(); measureHud(); syncInsets(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measureHud(); syncInsets(); }); // as fontes mudam a altura do HUD
  reducedQuery.addEventListener('change', (e) => { reduced = e.matches; scene && scene.setReducedMotion(reduced); });
  document.addEventListener('visibilitychange', () => { scene && scene.setPaused(document.hidden); });

  global.AndreyApp = { nota: (id) => (scene ? scene.getNote(id) : null), notas: () => (scene ? scene.notesState() : null), notaTela: (id) => (scene ? scene.noteScreen(id) : null), novoPostit: () => newNote(), somDebug: () => (audio && audio._debug ? audio._debug() : null), powerOn, powerOff, goStop, expand, collapse, get state() { return state; }, get stop() { return stop; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window);
