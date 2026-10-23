/*
 * blocos.js — BLOCOS, o jogo de encaixar peças do AndreyOS 24.
 *
 * Contrato (SPEC.md):
 *   AndreyBlocos.create(containerEl, { onEvent(kind, detail) }) -> api
 *     kind: 'start' | 'line' | 'level' | 'gameover' | 'record' | 'pause' | 'resume'
 *   api.start(); api.pause(); api.resume(); api.isRunning()
 *   api.handleKey(key)   -> true se a tecla foi usada pelo jogo
 *   api.setVisible(bool) -> false pausa e para o rAF
 *   api.dispose()
 *
 * Extras opcionais (fora do contrato, ninguém precisa usar):
 *   api.handleKey(key, 'down' | 'up')  segurar/soltar de verdade (DAS); sem o 2º
 *                                      argumento cada chamada é um toque único
 *   api.getState()                     retrato do jogo (testes e depuração)
 *   api.focus(); api.el                foca o tabuleiro; nó raiz do componente
 *   opção { random }                   gerador [0,1) para sortear com semente
 *   AndreyBlocos.getRecord(), AndreyBlocos.RECORD_KEY
 *
 * Teclado: nenhum listener global. As teclas chegam por handleKey() (o desktop
 * repassa) ou por keydown dentro do próprio componente (canvas ou botões
 * focados). Quando o componente usa a tecla, faz preventDefault +
 * stopPropagation, então o desktop não recebe a mesma tecla em dobro. Se o
 * desktop escutar em captura e repassar antes, a segunda entrega do mesmo
 * evento é descartada (janela de poucos ms).
 *
 * Desenho: tudo em pixels do dispositivo (devicePixelRatio x escala da
 * projeção 3D), com a célula arredondada para inteiro, para os blocos ficarem
 * nítidos mesmo dentro do matrix3d do monitor. Fundo, moldura, grade, cartões
 * e rótulos ficam numa camada estática (refeita só ao mudar de tamanho ou
 * quando a fonte chega); a cada quadro só o que se mexe é redesenhado.
 *
 * Eventos: o onEvent pode chamar start(), pause() ou dispose() de dentro do
 * próprio aviso; o jogo detecta e não continua a partida antiga por cima da nova.
 * O 'record' do primeiro recorde (sem recorde anterior) sai logo depois do
 * 'gameover'; batendo um recorde anterior, sai no meio da partida.
 * start() com o jogo escondido (setVisible(false) ou aba oculta) já nasce
 * pausado, para isRunning() nunca dizer true sem laço rodando.
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Regras                                                              */
  /* ------------------------------------------------------------------ */

  const COLS = 10;
  const HIDDEN = 2;            // linhas ocultas no topo
  const VISIBLE = 20;
  const ROWS = VISIBLE + HIDDEN;

  const LOCK_DELAY = 0.5;      // s no chão antes de travar
  const LOCK_RESETS = 15;      // movimentos que renovam o lock delay (evita girar para sempre)
  const DAS = 0.15;            // s segurando ← → antes de repetir
  const ARR = 0.04;            // s entre repetições
  const SOFT_INTERVAL = 0.035; // s por linha com ↓ segurado
  const FLASH_TIME = 0.26;
  const FLASH_TIME_REDUCED = 0.15;
  const OVER_ANIM = 0.75;
  const OVER_GUARD_MS = 450;   // evita recomeçar sem querer logo após perder
  const DUP_WINDOW_MS = 8;     // mesma tecla por dois caminhos no mesmo evento
  const LOCK_FX = 0.16;        // brilho rápido da peça que acabou de travar
  const GLOW_PULSE = 1.2;      // pulso da moldura ao subir de nível / fechar QUADRA
  const MAX_BACKING_PX = 4200000; // teto de pixels do canvas (redesenho por quadro)
  const NARROW_PX = 440;       // abaixo disso a barra de toque usa só ícones

  const LINE_SCORE = [0, 100, 300, 500, 800];
  const LINE_NAMES = ['', 'SIMPLES', 'DUPLA', 'TRIPLA', 'QUADRA!'];
  const RECORD_KEY = 'andreyos.blocos.recorde';
  const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

  // Estado 0 de cada peça dentro da sua caixa N x N (y cresce para baixo).
  const SHAPES = {
    I: { n: 4, c: [[0, 1], [1, 1], [2, 1], [3, 1]] },
    O: { n: 2, c: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    T: { n: 3, c: [[1, 0], [0, 1], [1, 1], [2, 1]] },
    S: { n: 3, c: [[1, 0], [2, 0], [0, 1], [1, 1]] },
    Z: { n: 3, c: [[0, 0], [1, 0], [1, 1], [2, 1]] },
    J: { n: 3, c: [[0, 0], [0, 1], [1, 1], [2, 1]] },
    L: { n: 3, c: [[2, 0], [0, 1], [1, 1], [2, 1]] }
  };

  // Girar a caixa inteira no sentido horário: (x, y) -> (n-1-y, x).
  // Isso reproduz os 4 estados padrão de cada peça.
  const ROT = {};
  TYPES.forEach(function (t) {
    const n = SHAPES[t].n;
    const states = [SHAPES[t].c.map(function (p) { return [p[0], p[1]]; })];
    for (let r = 1; r < 4; r++) {
      states.push(states[r - 1].map(function (p) { return [n - 1 - p[1], p[0]]; }));
    }
    ROT[t] = states;
  });

  // Wall kicks no padrão de mercado. Tabelas com y para CIMA (como costumam
  // ser publicadas); na aplicação o y é invertido porque a grade cresce para baixo.
  const KICKS = {
    '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]
  };
  const KICKS_I = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]]
  };

  // Segundos por linha em cada nível (curva clássica, acelera bem a partir do 8).
  function gravityFor(level) {
    const l = Math.min(Math.max(level, 1), 20) - 1;
    return Math.max(0.016, Math.pow(0.8 - l * 0.007, l));
  }

  /* ------------------------------------------------------------------ */
  /* Cores                                                               */
  /* ------------------------------------------------------------------ */

  const BASE = {
    I: '#3ec6d3', O: '#f2c14e', T: '#a77bd8', S: '#62c26b',
    Z: '#e35d57', J: '#4f86e0', L: '#ef9446', X: '#5b6271'
  };
  const UI = {
    bg: '#0b0e14', bgTop: '#121826', bgBottom: '#06080d',
    panel: '#121722', panelHi: '#2b3343', panelLo: '#05070b',
    boardBg: '#0d1119', boardTop: '#131a28', grid: 'rgba(160,180,210,0.06)', gridDot: 'rgba(170,190,220,0.16)',
    frameTop: '#7a8498', frameLeft: '#5f697c', frameBottom: '#1b2029', frameRight: '#262c37',
    label: '#8e9cb2', value: '#f4ead0', accent: '#f2c14e', warm: '#ff9a6b', cool: '#7fd6e0'
  };

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function mix(hex, toHex, a) {
    const p = hexToRgb(hex), q = hexToRgb(toHex);
    return 'rgb(' + p.map(function (v, i) { return Math.round(v + (q[i] - v) * a); }).join(',') + ')';
  }
  const PAL = {};
  Object.keys(BASE).forEach(function (t) {
    const b = BASE[t];
    PAL[t] = {
      base: b,
      rgb: hexToRgb(b).join(','),
      top: mix(b, '#ffffff', 0.5),
      left: mix(b, '#ffffff', 0.25),
      bottom: mix(b, '#000000', 0.48),
      right: mix(b, '#000000', 0.32)
    };
  });

  /* ------------------------------------------------------------------ */
  /* Recorde                                                             */
  /* ------------------------------------------------------------------ */

  function loadRecord() {
    try {
      const v = parseInt(global.localStorage.getItem(RECORD_KEY), 10);
      return isFinite(v) && v > 0 ? v : 0;
    } catch (e) { return 0; }
  }
  function saveRecord(v) {
    try { global.localStorage.setItem(RECORD_KEY, String(v)); } catch (e) { /* modo privado ou bloqueado: segue sem salvar */ }
  }

  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function now() { return (global.performance && global.performance.now) ? global.performance.now() : Date.now(); }

  /* ------------------------------------------------------------------ */
  /* Estilos (injetados uma vez, com prefixo próprio)                    */
  /* ------------------------------------------------------------------ */

  const STYLE_ID = 'andrey-blocos-estilo';
  let styleRefs = 0;
  const CSS = [
    // aspect-ratio só vale quando o pai não tem altura definida (height:100% vira auto):
    // assim o jogo não encolhe para 300 px num container de altura automática.
    '.blc{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:300px;aspect-ratio:600/520;box-sizing:border-box;margin:0;padding:0;background:#080b11;color:#f4ead0;font-family:"VT323","Courier New",monospace;-webkit-user-select:none;user-select:none;overflow:hidden}',
    '.blc *{box-sizing:border-box}',
    '.blc .blc-stage{position:relative;flex:1 1 auto;min-height:0}',
    '.blc .blc-canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:block;outline:none;touch-action:none;-webkit-tap-highlight-color:transparent}',
    '.blc .blc-canvas:focus-visible{outline:2px solid #f2c14e;outline-offset:-2px}',
    '.blc .blc-pad{flex:0 0 auto;display:flex;justify-content:center;align-items:center;gap:6px;margin:0;padding:6px 8px 8px;background:linear-gradient(#06080d,#0b0f17);border-top:1px solid #1a2130}',
    '.blc .blc-btn{flex:0 1 58px;min-width:0;height:44px;margin:0;padding:0 4px;display:flex;align-items:center;justify-content:center;border:2px solid;border-color:#6a7487 #1b2029 #1b2029 #6a7487;border-radius:0;background:linear-gradient(#323a4a,#262d3a);color:#f4ead0;font:inherit;font-size:20px;line-height:1;letter-spacing:0;text-transform:none;box-shadow:none;cursor:pointer;touch-action:none;-webkit-tap-highlight-color:transparent}',
    '.blc .blc-btn:hover{background:linear-gradient(#3a4356,#2d3443)}',
    '.blc .blc-btn.is-down,.blc .blc-btn:active{border-color:#1b2029 #6a7487 #6a7487 #1b2029;background:#1f2530;color:#f2c14e}',
    '.blc .blc-btn:focus-visible{outline:2px solid #f2c14e;outline-offset:1px}',
    '.blc .blc-btn svg{width:22px;height:22px;flex:0 0 auto;display:block;fill:currentColor;pointer-events:none}',
    '.blc .blc-btn--txt{flex-basis:84px}',
    '.blc .blc-btn--txt svg{display:none}',
    '.blc .blc-sep{flex:0 0 6px}',
    // container estreito: só ícones, menos respiro lateral (a classe vem do relayout,
    // dentro do ResizeObserver: por isso a ALTURA da barra não pode mudar aqui,
    // senão o palco muda de tamanho no mesmo ciclo e o navegador acusa laço de resize)
    '.blc.blc--estreito .blc-pad{gap:4px;padding-left:4px;padding-right:4px}',
    '.blc.blc--estreito .blc-btn--txt{flex-basis:58px}',
    '.blc.blc--estreito .blc-btn--txt svg{display:block}',
    '.blc.blc--estreito .blc-btn--txt span{display:none}',
    '.blc.blc--estreito .blc-sep{flex-basis:2px}',
    '.blc .blc-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}'
  ].join('\n');

  function addStyle() {
    styleRefs++;
    if (!global.document.getElementById(STYLE_ID)) {
      const s = global.document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = CSS;
      (global.document.head || global.document.documentElement).appendChild(s);
    }
  }
  function removeStyle() {
    styleRefs = Math.max(0, styleRefs - 1);
    if (styleRefs === 0) {
      const s = global.document.getElementById(STYLE_ID);
      if (s && s.parentNode) s.parentNode.removeChild(s);
    }
  }

  // Ícones dos botões de toque (desenho, não emoji).
  const ICON = {
    left: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="5,12 17,4.5 17,19.5"/></svg>',
    right: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="19,12 7,4.5 7,19.5"/></svg>',
    rot: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5A7 7 0 1 1 5 12" fill="none" stroke="currentColor" stroke-width="2.6"/><polygon points="5,6 1.4,12.4 8.6,12.4"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="4.5,7 19.5,7 12,19"/></svg>',
    drop: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="12,17 4.5,9 9.5,9 9.5,2.5 14.5,2.5 14.5,9 19.5,9"/><rect x="4" y="19.2" width="16" height="2.8"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14"/><rect x="13.8" y="5" width="4.2" height="14"/></svg>',
    hold: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h18v18H3z M5.6 5.6v12.8h12.8V5.6z" fill-rule="evenodd"/><rect x="8.5" y="8.5" width="7" height="7"/></svg>'
  };

  const PAD = [
    { key: 'ArrowLeft', icon: 'left', label: 'Mover para a esquerda', hold: true },
    { key: 'ArrowRight', icon: 'right', label: 'Mover para a direita', hold: true },
    { key: 'ArrowUp', icon: 'rot', label: 'Girar' },
    { key: 'ArrowDown', icon: 'down', label: 'Descer mais rápido', hold: true },
    { key: ' ', icon: 'drop', label: 'Cair de vez' },
    { sep: true },
    { key: 'c', text: 'GUARDA', icon: 'hold', label: 'Guardar peça' },
    { key: 'p', icon: 'pause', label: 'Pausar ou continuar' }
  ];

  function actionFor(key) {
    switch (key) {
      case 'ArrowLeft': case 'Left': return 'left';
      case 'ArrowRight': case 'Right': return 'right';
      case 'ArrowDown': case 'Down': return 'down';
      case 'ArrowUp': case 'Up': case 'x': case 'X': return 'cw';
      case 'z': case 'Z': return 'ccw';
      case ' ': case 'Spacebar': case 'Space': return 'drop';
      case 'c': case 'C': case 'Shift': return 'hold';
      case 'p': case 'P': return 'pause';
      case 'Enter': return 'enter';
      default: return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* create                                                              */
  /* ------------------------------------------------------------------ */

  function create(containerEl, opts) {
    if (!containerEl || !containerEl.appendChild) throw new Error('BLOCOS: informe o elemento onde o jogo vai morar.');
    opts = opts || {};
    const doc = global.document;
    const rand = typeof opts.random === 'function' ? opts.random : Math.random;

    /* ---------- DOM ---------- */
    addStyle();
    const root = doc.createElement('div');
    root.className = 'blc';
    const stage = doc.createElement('div');
    stage.className = 'blc-stage';
    const canvas = doc.createElement('canvas');
    canvas.className = 'blc-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-roledescription', 'jogo');
    canvas.setAttribute('aria-label', 'BLOCOS. Setas esquerda e direita movem, seta para cima ou X gira, Z gira ao contrário, seta para baixo desce, espaço derruba, C guarda a peça, P pausa, Enter começa.');
    stage.appendChild(canvas);
    const pad = doc.createElement('div');
    pad.className = 'blc-pad';
    pad.setAttribute('role', 'group');
    pad.setAttribute('aria-label', 'Controles de toque do BLOCOS');
    const sr = doc.createElement('div');
    sr.className = 'blc-sr';
    sr.setAttribute('aria-live', 'polite');
    root.appendChild(stage);
    root.appendChild(pad);
    root.appendChild(sr);
    containerEl.appendChild(root);

    const mainCtx = canvas.getContext('2d');
    let ctx = mainCtx;           // trocado temporariamente ao assar a camada estática
    if (!mainCtx) { root.parentNode.removeChild(root); removeStyle(); throw new Error('BLOCOS: este navegador não desenha em canvas 2D.'); }

    /* ---------- estado ---------- */
    let alive = true;
    let visible = true;
    let state = 'title';         // 'title' | 'playing' | 'over'
    let paused = false;
    let board = emptyBoard();
    let queue = [];
    let piece = null;            // { t, r, x, y }
    let hold = null;
    let holdUsed = false;
    let score = 0, lines = 0, level = 1;
    let best = loadRecord(), bestAtStart = best, recordEmitted = false, novoRecorde = false;
    let recordDirty = false;     // recorde batido ainda não gravado (grava em lote, não a cada quadro)
    let fallAcc = 0, lockT = 0, lockResets = 0, lowestY = 0;
    let flash = null;            // { rows:[], t }
    let overT = 1, overAt = 0;
    let trails = [];
    let msg = null;              // { lines:[], color, t, life }
    let frames = 0;
    // efeitos só visuais (nunca usam o sorteio do jogo, para a semente continuar valendo)
    let sparks = [];             // fagulhas da linha limpa { x, y, vx, vy, t, life, s, rgb }
    let lockFx = null;           // { cells, t } brilho da peça que travou
    let glow = null;             // { t, rgb } pulso da moldura
    let shownScore = 0;          // placar que "corre" até o valor real
    let generation = 0;          // muda a cada partida/dispose: detecta reentrância pelo onEvent

    // teclas seguradas (DAS)
    let heldLeft = false, heldRight = false, heldDir = 0, dasT = 0, arrT = 0, softHeld = false;
    const dup = { key: null, src: null, t: -1, res: false };
    let lastDomKey = null, lastDomKeyT = -1;   // para o clique sintético de Espaço num botão focado não repetir a ação

    let raf = 0, lastT = null, rescaleT = 0;
    let L = null; // layout em px do dispositivo

    const mq = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let reduced = !!(mq && mq.matches);

    /* ---------- tabuleiro ---------- */
    function emptyBoard() {
      const b = [];
      for (let y = 0; y < ROWS; y++) b.push(new Array(COLS).fill(0));
      return b;
    }
    function cellsOf(t, r, x, y) {
      return ROT[t][r].map(function (p) { return [x + p[0], y + p[1]]; });
    }
    function fits(t, r, x, y) {
      const cs = ROT[t][r];
      for (let i = 0; i < cs.length; i++) {
        const cx = x + cs[i][0], cy = y + cs[i][1];
        if (cx < 0 || cx >= COLS || cy >= ROWS) return false;
        if (cy >= 0 && board[cy][cx]) return false;
      }
      return true;
    }
    function canMove(dx, dy) { return !!piece && fits(piece.t, piece.r, piece.x + dx, piece.y + dy); }
    function grounded() { return !!piece && !canMove(0, 1); }
    function dropY() {
      let y = piece.y;
      while (fits(piece.t, piece.r, piece.x, y + 1)) y++;
      return y;
    }

    /* ---------- saco de 7 ---------- */
    function refill() {
      while (queue.length < 7) {
        const bag = TYPES.slice();
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          const tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp;
        }
        queue = queue.concat(bag);
      }
    }

    function spawnType(t) {
      const x = t === 'O' ? 4 : 3;
      let y = 1;                                   // fileira de baixo da peça já aparece
      if (!fits(t, 0, x, y)) y = 0;                // um respiro antes de perder
      if (!fits(t, 0, x, y)) { piece = null; gameOver(); return false; }
      piece = { t: t, r: 0, x: x, y: y };
      lowestY = y; lockT = 0; lockResets = 0; fallAcc = 0;
      return true;
    }
    function spawnNext() {
      refill();
      holdUsed = false;
      return spawnType(queue.shift());
    }

    /* ---------- movimentos ---------- */
    function afterMove() {
      // mexer no chão renova o lock delay, com limite
      if (grounded() && lockResets < LOCK_RESETS) { lockT = 0; lockResets++; }
    }
    function afterDescend() {
      if (piece.y > lowestY) { lowestY = piece.y; lockResets = 0; }
      lockT = 0;
    }
    function shift(d) {
      if (!canMove(d, 0)) return false;
      piece.x += d;
      afterMove();
      return true;
    }
    function rotate(dir) {
      if (!piece || piece.t === 'O') return false;
      const from = piece.r, to = (from + dir + 4) % 4;
      const table = (piece.t === 'I' ? KICKS_I : KICKS)[from + '>' + to];
      for (let i = 0; i < table.length; i++) {
        const nx = piece.x + table[i][0], ny = piece.y - table[i][1];
        if (fits(piece.t, to, nx, ny)) {
          piece.x = nx; piece.y = ny; piece.r = to;
          if (piece.y > lowestY) { lowestY = piece.y; lockResets = 0; }
          afterMove();
          return true;
        }
      }
      return false;
    }
    function softStep() {
      if (!canMove(0, 1)) return false;
      piece.y++;
      score += 1;
      afterDescend();
      checkRecord();
      return true;
    }
    function hardDrop() {
      if (!piece) return;
      const fromY = piece.y;
      const toY = dropY();
      const dist = toY - fromY;
      if (dist > 0 && !reduced) {
        const cols = {};
        cellsOf(piece.t, piece.r, piece.x, toY).forEach(function (c) {
          if (cols[c[0]] === undefined || c[1] < cols[c[0]]) cols[c[0]] = c[1];
        });
        trails.push({ cols: cols, dist: dist, t: 0, rgb: PAL[piece.t].rgb });
      }
      piece.y = toY;
      score += 2 * dist;
      lockPiece();
    }
    function holdPiece() {
      if (!piece || holdUsed) return false;
      const cur = piece.t;
      holdUsed = true;
      if (hold === null) {
        hold = cur;
        refill();
        spawnType(queue.shift());
      } else {
        const t = hold;
        hold = cur;
        spawnType(t);
      }
      return true;
    }

    function lockPiece() {
      const cs = cellsOf(piece.t, piece.r, piece.x, piece.y);
      let allHidden = true;
      cs.forEach(function (c) {
        if (c[1] >= 0) board[c[1]][c[0]] = piece.t;
        if (c[1] >= HIDDEN) allHidden = false;
      });
      if (!reduced) lockFx = { cells: cs, t: 0 };
      piece = null;
      const gen = generation;
      checkRecord();                           // pode avisar 'record' (e o onEvent pode recomeçar)
      if (gen !== generation) return;
      flushRecord();
      if (allHidden) { gameOver(); return; }   // travou inteira acima da área visível
      const full = [];
      for (let y = 0; y < ROWS; y++) {
        if (board[y].every(function (v) { return v; })) full.push(y);
      }
      if (full.length) {
        flash = { rows: full, t: 0 };
        if (!reduced) burst(full);
      } else {
        spawnNext();
      }
    }

    // Fagulhas das linhas limpas, na cor de cada bloco (Math.random de propósito).
    function burst(rows) {
      rows.forEach(function (y) {
        for (let x = 0; x < COLS; x++) {
          const t = board[y][x];
          if (!t) continue;
          for (let k = 0; k < 2; k++) {
            const side = x < COLS / 2 ? -1 : 1;
            sparks.push({
              x: x + 0.5, y: y - HIDDEN + 0.5,
              vx: side * (1.5 + Math.random() * 6) + (Math.random() - 0.5) * 3,
              vy: -(3 + Math.random() * 9),
              t: 0, life: 0.45 + Math.random() * 0.35,
              s: 0.16 + Math.random() * 0.16,
              rgb: PAL[t].rgb
            });
          }
        }
      });
      if (sparks.length > 240) sparks.splice(0, sparks.length - 240);
    }

    function finishClear() {
      const rows = flash.rows;
      flash = null;
      rows.forEach(function (y) { board.splice(y, 1); board.unshift(new Array(COLS).fill(0)); });
      const n = Math.min(4, rows.length);
      const gained = LINE_SCORE[n] * level;
      score += gained;
      lines += rows.length;
      showMsg([LINE_NAMES[n], '+' + fmt(gained)], n === 4 ? UI.accent : UI.cool);
      if (n === 4) pulse(UI.accent);
      const gen = generation;
      emit('line', { linhas: rows.length, tipo: LINE_NAMES[n].replace('!', ''), total: lines, pontos: score, nivel: level });
      if (gen !== generation) return;          // o onEvent recomeçou ou descartou o jogo
      const newLevel = 1 + Math.floor(lines / 10);
      if (newLevel > level) {
        level = newLevel;
        showMsg(['NÍVEL ' + level, 'MAIS RÁPIDO'], UI.warm);
        pulse(UI.warm);
        announce('Nível ' + level + '.');
        emit('level', { nivel: level, linhas: lines, pontos: score });
        if (gen !== generation) return;
      }
      checkRecord();
      if (gen !== generation) return;
      spawnNext();
    }

    function checkRecord() {
      if (score <= best) return;
      best = score;
      recordDirty = true;                      // grava no próximo flushRecord (travar, pausar, fim)
      // Comemora durante a partida só quando havia um recorde anterior a bater;
      // no primeiro jogo o aviso sai no fim de jogo.
      if (!recordEmitted && bestAtStart > 0) {
        recordEmitted = true;
        flushRecord();
        showMsg(['NOVO', 'RECORDE!'], UI.accent);
        pulse(UI.accent);
        emit('record', { recorde: best, pontos: score, anterior: bestAtStart });
      }
    }
    function flushRecord() {
      if (!recordDirty) return;
      recordDirty = false;
      if (best > 0 && best >= loadRecord()) saveRecord(best);
    }
    function pulse(hex) { if (!reduced) glow = { t: 0, rgb: hexToRgb(hex).join(',') }; }

    function gameOver() {
      state = 'over';
      paused = false;
      piece = null;
      flash = null;
      msg = null;                              // o recado da partida não fica congelado na tela final
      sparks = []; lockFx = null; glow = null;
      releaseAll();
      overT = reduced ? 1 : 0;
      overAt = now();
      shownScore = score;
      novoRecorde = score > bestAtStart;
      if (score > best) { best = score; recordDirty = true; }
      flushRecord();
      announce('Fim de jogo. ' + score + ' pontos.' + (novoRecorde ? ' Novo recorde!' : ''));
      // Copia tudo antes de avisar: o onEvent pode recomeçar (start) ou descartar o jogo.
      const gen = generation;
      const fim = { pontos: score, linhas: lines, nivel: level, recorde: best, novoRecorde: novoRecorde };
      const rec = novoRecorde && !recordEmitted ? { recorde: best, pontos: score, anterior: bestAtStart } : null;
      if (rec) recordEmitted = true;
      emit('gameover', fim);
      if (rec && alive) emit('record', rec);
      if (gen !== generation || !alive) return;
      draw();
      kick();
    }

    /* ---------- partida ---------- */
    function startGame() {
      flushRecord();
      generation++;
      board = emptyBoard();
      queue = [];
      refill();
      hold = null; holdUsed = false;
      score = 0; lines = 0; level = 1; shownScore = 0;
      best = Math.max(best, loadRecord());
      bestAtStart = best; recordEmitted = false; novoRecorde = false; recordDirty = false;
      flash = null; trails = []; msg = null; overT = 1;
      sparks = []; lockFx = null; glow = null;
      state = 'playing';
      paused = false;
      releaseAll();
      maybeRescale();
      spawnNext();
      announce('Partida começou.');
      const gen = generation;
      emit('start', { recorde: best });
      if (gen !== generation || !alive) return;
      // Começou com o jogo escondido (setVisible(false) ou aba oculta): já nasce
      // pausado, senão isRunning() diria true sem laço nenhum rodando.
      if (!visible || doc.hidden) { pauseGame(!visible ? 'oculto' : 'aba'); return; }
      draw();
      kick();
    }
    function pauseGame(motivo) {
      if (state !== 'playing' || paused) return false;
      paused = true;
      shownScore = score;
      releaseAll();
      stop();
      flushRecord();
      announce('Pausado.');
      emit('pause', { motivo: motivo || 'jogador' });
      draw();
      return true;
    }
    function resumeGame() {
      if (state !== 'playing' || !paused) return false;
      if (!visible || doc.hidden) return false;
      paused = false;
      maybeRescale();
      announce('Continuando.');
      emit('resume', {});
      draw();
      kick();
      return true;
    }
    function overReady() { return state === 'over' && now() - overAt > OVER_GUARD_MS; }

    /* ---------- entrada ---------- */
    function releaseAll() { heldLeft = heldRight = false; heldDir = 0; dasT = arrT = 0; softHeld = false; }

    // mode: 'tap' (um passo) | 'hold' (segura até soltar)
    function doAction(a, mode) {
      if (a === 'enter') {
        if (state === 'title' || overReady()) { startGame(); return true; }
        if (state === 'playing' && paused) return resumeGame();   // false se ainda escondido
        return false;
      }
      if (a === 'pause') {
        if (state !== 'playing') return false;
        if (paused) resumeGame(); else pauseGame('jogador');
        return true;
      }
      if (state !== 'playing' || paused) return false;
      switch (a) {
        case 'left':
        case 'right': {
          const d = a === 'left' ? -1 : 1;
          if (mode === 'hold') {
            if ((d < 0 && heldLeft && heldDir === -1) || (d > 0 && heldRight && heldDir === 1)) return true; // repetição
            if (d < 0) heldLeft = true; else heldRight = true;
            heldDir = d; dasT = 0; arrT = 0;
          }
          if (piece) shift(d);
          return true;
        }
        case 'down':
          if (mode === 'hold') {
            if (softHeld) return true;
            softHeld = true;
          }
          if (piece) { softStep(); fallAcc = 0; }
          return true;
        case 'cw': if (piece) rotate(1); return true;
        case 'ccw': if (piece) rotate(-1); return true;
        case 'drop': if (piece) hardDrop(); return true;
        case 'hold': holdPiece(); return true;
      }
      return false;
    }
    function release(a) {
      if (a === 'left' || a === 'right') {
        if (a === 'left') heldLeft = false; else heldRight = false;
        // se a outra direção continua apertada, ela volta a valer
        heldDir = heldLeft ? -1 : (heldRight ? 1 : 0);
        dasT = 0; arrT = 0;
      } else if (a === 'down') {
        softHeld = false;
      }
    }
    function gameKeyLive(a) { return state === 'playing' && !paused && a !== 'enter'; }

    // A mesma tecla chegando por dois caminhos no mesmo evento conta uma vez.
    function isDuplicate(key, src) {
      const t = now();
      if (dup.key === key && dup.src !== src && t - dup.t < DUP_WINDOW_MS) { dup.key = null; return true; }
      dup.key = key; dup.src = src; dup.t = t;
      return false;
    }

    function handleKey(key, phase) {
      if (!alive) return false;
      const a = actionFor(key);
      if (!a) return false;
      if (phase === 'up') { release(a); return gameKeyLive(a); }
      if (isDuplicate(key, 'ext')) return dup.res;
      const used = doAction(a, phase === 'down' ? 'hold' : 'tap');
      dup.res = used;
      if (!raf) draw();
      return used;
    }

    function onKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const a = actionFor(e.key);
      if (!a) return;
      let used;
      if (isDuplicate(e.key, 'dom')) used = dup.res;
      else if (e.repeat) used = gameKeyLive(a) || (a === 'pause' && state === 'playing');   // o DAS próprio cuida da repetição
      else used = doAction(a, 'hold');
      dup.res = used;
      if (used) { e.preventDefault(); e.stopPropagation(); lastDomKey = e.key; lastDomKeyT = now(); }
      if (!raf) draw();
    }
    function onKeyUp(e) {
      const a = actionFor(e.key);
      if (!a) return;
      release(a);
      if (gameKeyLive(a)) e.stopPropagation();
    }
    function onFocusOut(e) {
      if (!e.relatedTarget || !root.contains(e.relatedTarget)) releaseAll();
    }
    function focusCanvas() {
      try { canvas.focus({ preventScroll: true }); } catch (err) { canvas.focus(); }
    }
    function onCanvasPointer(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      focusCanvas();
      if (state === 'title' || overReady()) { e.preventDefault(); startGame(); }
      else if (state === 'playing' && paused) { e.preventDefault(); resumeGame(); }
    }

    /* ---------- botões de toque ---------- */
    const padButtons = [];
    PAD.forEach(function (def) {
      if (def.sep) {
        const s = doc.createElement('span');
        s.className = 'blc-sep';
        s.setAttribute('aria-hidden', 'true');
        pad.appendChild(s);
        return;
      }
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'blc-btn' + (def.text ? ' blc-btn--txt' : '');
      b.setAttribute('aria-label', def.label);
      b.title = def.label;
      // botão de texto leva também o ícone, que aparece no lugar do texto quando falta espaço
      b.innerHTML = ICON[def.icon] + (def.text ? '<span>' + def.text + '</span>' : '');
      const a = actionFor(def.key);
      let pid = null;
      function down(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();                 // não rouba o foco do tabuleiro nem seleciona texto
        pid = e.pointerId;
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* sem captura: segue */ }
        b.classList.add('is-down');
        if (state !== 'playing') {
          if (a !== 'pause' && (state === 'title' || overReady())) startGame();
          return;
        }
        if (paused && a !== 'pause') { resumeGame(); return; }
        doAction(a, def.hold ? 'hold' : 'tap');
        if (!raf) draw();
      }
      function up() {
        if (pid === null) return;
        pid = null;
        b.classList.remove('is-down');
        if (def.hold) release(a);
      }
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      // Ativação por teclado (Enter num botão focado): e.detail === 0.
      b.addEventListener('click', function (e) {
        if (e.detail !== 0) return;
        if (lastDomKey === ' ' && now() - lastDomKeyT < 500) return;   // Espaço já virou queda instantânea
        if (state !== 'playing') { if (a !== 'pause' && (state === 'title' || overReady())) startGame(); return; }
        doAction(a, 'tap');
        if (!raf) draw();
      });
      b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      pad.appendChild(b);
      padButtons.push(b);
    });

    /* ---------- loop ---------- */
    function needsFrames() {
      if (!alive || !visible || doc.hidden) return false;
      if (state === 'playing' && !paused) return true;
      if (state === 'over' && overT < 1) return true;
      return false;
    }
    function kick() {
      if (!raf && needsFrames()) { lastT = null; raf = global.requestAnimationFrame(frame); }
    }
    function stop() {
      if (raf) global.cancelAnimationFrame(raf);
      raf = 0; lastT = null;
    }
    function frame(ts) {
      raf = 0;
      if (!alive) return;
      const dt = lastT === null ? 0 : Math.min(0.05, Math.max(0, (ts - lastT) / 1000));
      lastT = ts;
      frames++;
      update(dt);
      rescaleT += dt;
      if (rescaleT > 0.5) { rescaleT = 0; maybeRescale(); }
      draw();
      // kick() pode ter agendado um quadro durante update() (fim de jogo): não duplicar o laço
      if (!raf && needsFrames()) raf = global.requestAnimationFrame(frame);
      else if (!raf) lastT = null;
    }

    function update(dt) {
      // efeitos
      for (let i = trails.length - 1; i >= 0; i--) { trails[i].t += dt; if (trails[i].t > 0.18) trails.splice(i, 1); }
      if (msg) { msg.t += dt; if (msg.t > msg.life) msg = null; }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.t += dt;
        if (p.t >= p.life) { sparks.splice(i, 1); continue; }
        p.vy += 26 * dt;                       // gravidade em células/s²
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      if (lockFx) { lockFx.t += dt; if (lockFx.t >= LOCK_FX) lockFx = null; }
      if (glow) { glow.t += dt; if (glow.t >= GLOW_PULSE) glow = null; }
      // o placar corre até o valor real (um pouco mais rápido quanto maior a diferença)
      if (shownScore !== score) {
        const k = reduced ? 1 : Math.min(1, dt * 14);
        shownScore += (score - shownScore) * k;
        if (Math.abs(score - shownScore) < 1) shownScore = score;
      }
      if (state === 'over') { if (overT < 1) overT = Math.min(1, overT + dt / OVER_ANIM); return; }
      if (state !== 'playing' || paused) return;

      if (flash) {
        flash.t += dt;
        if (flash.t >= (reduced ? FLASH_TIME_REDUCED : FLASH_TIME)) finishClear();
        return;
      }
      if (!piece) return;

      // DAS / ARR para ← → seguradas
      if (heldDir) {
        dasT += dt;
        if (dasT >= DAS) {
          arrT += dt;
          while (arrT >= ARR) {
            arrT -= ARR;
            if (!shift(heldDir)) { arrT = 0; break; }
          }
        }
      }

      // gravidade (mais forte com ↓ segurado)
      const g = gravityFor(level);
      const interval = softHeld ? Math.min(g, SOFT_INTERVAL) : g;
      fallAcc += dt;
      while (fallAcc >= interval) {
        fallAcc -= interval;
        if (canMove(0, 1)) {
          piece.y++;
          if (softHeld) score += 1;
          afterDescend();
        } else { fallAcc = 0; break; }
      }
      if (softHeld) checkRecord();

      // lock delay
      if (grounded()) {
        lockT += dt;
        if (lockT >= LOCK_DELAY) lockPiece();
      } else {
        lockT = 0;
      }
    }

    function showMsg(linesTxt, color) { msg = { lines: linesTxt, color: color, t: 0, life: 1.5 }; }
    function announce(t) { sr.textContent = t; }
    function emit(kind, detail) {
      if (typeof opts.onEvent !== 'function') return;
      try { opts.onEvent(kind, detail); } catch (err) { if (global.console) global.console.warn('[BLOCOS] onEvent falhou:', err); }
    }

    /* ---------- tamanho e nitidez ---------- */
    function backingRatio() {
      const dpr = global.devicePixelRatio || 1;
      let proj = 1;
      // Dentro do matrix3d do monitor o canvas aparece ampliado; mede a escala
      // real na tela para não ficar borrado quando a câmera "entra na tela".
      try {
        const r = stage.getBoundingClientRect();
        if (stage.offsetWidth > 0 && r.width > 0 && isFinite(r.width)) proj = r.width / stage.offsetWidth;
      } catch (err) { proj = 1; }
      proj = Math.min(Math.max(proj, 1), 2.5);
      return Math.min(3, Math.max(1, dpr * proj));
    }
    function relayout() {
      const narrow = root.clientWidth > 0 && root.clientWidth < NARROW_PX;
      if (root.classList.contains('blc--estreito') !== narrow) root.classList.toggle('blc--estreito', narrow);
      const cw = stage.clientWidth, ch = stage.clientHeight;
      if (!cw || !ch) { L = null; return; }
      const Sraw = backingRatio();
      let S = Sraw;
      // container enorme x escala alta: limita o total de pixels redesenhados por quadro
      if (cw * ch * S * S > MAX_BACKING_PX) S = Math.max(1, Math.sqrt(MAX_BACKING_PX / (cw * ch)));
      const W = Math.max(1, Math.round(cw * S)), H = Math.max(1, Math.round(ch * S));
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;
      // unidades em células: painel 5 + respiro 0,7 + tabuleiro 10 + 0,7 + painel 5
      const c = Math.max(4, Math.floor(Math.min(W / 21.4, H / 20.9)));
      const totalW = Math.round(21.4 * c);
      const ox = Math.floor((W - totalW) / 2);
      const by = Math.floor((H - VISIBLE * c) / 2);
      const bx = ox + Math.round(5.7 * c);
      L = {
        S: S, Sraw: Sraw, W: W, H: H, c: c, by: by, bx: bx,
        lx: ox, rx: bx + COLS * c + Math.round(0.7 * c), pw: 5 * c,
        fLabel: Math.max(8, Math.round(c * 0.9)),
        fValue: Math.max(10, Math.round(c * 1.35)),
        fSmall: Math.max(7, Math.round(c * 0.8))
      };
      L.baked = false;             // a camada estática é refeita no próximo desenho
    }
    function maybeRescale() {
      if (!L) { relayout(); return; }
      const S = backingRatio();
      if (Math.abs(S - L.Sraw) / L.Sraw > 0.12) relayout();
    }

    /* ---------- desenho ---------- */
    function font(px) { return px + 'px "VT323", "Courier New", monospace'; }

    function bevel(x, y, w, h, b, cTop, cLeft, cBottom, cRight) {
      ctx.fillStyle = cTop;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - b, y + b); ctx.lineTo(x + b, y + b); ctx.closePath(); ctx.fill();
      ctx.fillStyle = cLeft;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + b, y + b); ctx.lineTo(x + b, y + h - b); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
      ctx.fillStyle = cBottom;
      ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + b, y + h - b); ctx.lineTo(x + w - b, y + h - b); ctx.lineTo(x + w, y + h); ctx.closePath(); ctx.fill();
      ctx.fillStyle = cRight;
      ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - b, y + h - b); ctx.lineTo(x + w - b, y + b); ctx.closePath(); ctx.fill();
    }
    function block(x, y, s, t, alpha) {
      const p = PAL[t];
      if (alpha !== undefined) ctx.globalAlpha = alpha;
      ctx.fillStyle = p.base;
      ctx.fillRect(x, y, s, s);
      const b = Math.max(1, Math.round(s * 0.16));
      bevel(x, y, s, s, b, p.top, p.left, p.bottom, p.right);
      // brilho pequeno no canto, cara de plástico de console antigo
      ctx.fillStyle = 'rgba(255,255,255,0.38)';
      ctx.fillRect(x + b, y + b, Math.max(1, Math.round(b * 0.9)), Math.max(1, Math.round(b * 0.9)));
      if (alpha !== undefined) ctx.globalAlpha = 1;
    }
    function ghost(x, y, s, t) {
      // contorno em retângulos inteiros: fica nítido em qualquer devicePixelRatio
      const lw = Math.max(1, Math.round(L.S)), i = lw, inner = s - 2 * i;
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = BASE[t];
      ctx.fillRect(x, y, s, s);
      ctx.globalAlpha = 0.75;
      ctx.fillRect(x + i, y + i, inner, lw);
      ctx.fillRect(x + i, y + s - i - lw, inner, lw);
      ctx.fillRect(x + i, y + i, lw, inner);
      ctx.fillRect(x + s - i - lw, y + i, lw, inner);
      ctx.globalAlpha = 1;
    }
    function card(x, y, w, h) {
      const e = Math.max(1, Math.round(L.S * 1.5));
      ctx.fillStyle = UI.panelLo; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = UI.panelHi; ctx.fillRect(x + e, y + e, w - e, h - e);
      ctx.fillStyle = UI.panel; ctx.fillRect(x + e, y + e, w - 2 * e, h - 2 * e);
    }
    function text(str, x, y, px, color, align, maxW) {
      ctx.font = font(px);
      if (maxW) {
        const w = ctx.measureText(str).width;
        if (w > maxW) ctx.font = font(Math.max(6, Math.floor(px * maxW / w)));
      }
      ctx.fillStyle = color;
      ctx.textAlign = align || 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(str, x, y);
    }
    function preview(t, cx, cy, s, alpha) {
      const cs = ROT[t][0];
      let minX = 9, maxX = -9, minY = 9, maxY = -9;
      cs.forEach(function (p) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); });
      const w = (maxX - minX + 1) * s, h = (maxY - minY + 1) * s;
      const x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
      cs.forEach(function (p) { block(x0 + (p[0] - minX) * s, y0 + (p[1] - minY) * s, s, t, alpha); });
    }

    // Camada estática: fundo, moldura, poço com grade, cartões e rótulos. Muda só
    // com o tamanho (ou quando a fonte chega); a cada quadro é uma cópia só, o que
    // pesa bem menos que redesenhar degradês e textos (canvas por software, celular).
    let bake = null;
    function bakeStatic() {
      if (!bake) bake = doc.createElement('canvas');
      if (bake.width !== L.W) bake.width = L.W;
      if (bake.height !== L.H) bake.height = L.H;
      const g = bake.getContext('2d');
      if (!g) return false;
      ctx = g;
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, L.W, L.H);
        const c = L.c, bx = L.bx, by = L.by, bw = COLS * c, bh = VISIBLE * c;
        // fundo: degradê vertical + halo frio atrás do tabuleiro (profundidade)
        const gBg = ctx.createLinearGradient(0, 0, 0, L.H);
        gBg.addColorStop(0, UI.bgTop); gBg.addColorStop(1, UI.bgBottom);
        ctx.fillStyle = gBg; ctx.fillRect(0, 0, L.W, L.H);
        const hx = bx + bw / 2, hy = by + bh * 0.42;
        const gHalo = ctx.createRadialGradient(hx, hy, c, hx, hy, Math.max(L.W, L.H) * 0.62);
        gHalo.addColorStop(0, 'rgba(70,110,170,0.20)'); gHalo.addColorStop(1, 'rgba(70,110,170,0)');
        ctx.fillStyle = gHalo; ctx.fillRect(0, 0, L.W, L.H);
        // moldura com brilho frio + poço
        const fb = Math.max(2, Math.round(c * 0.18));
        glowRect(bx - fb, by - fb, bw + 2 * fb, bh + 2 * fb, '127,214,224', 0.14, 0.9 * c);
        bevel(bx - fb, by - fb, bw + 2 * fb, bh + 2 * fb, fb, UI.frameTop, UI.frameLeft, UI.frameBottom, UI.frameRight);
        const gWell = ctx.createLinearGradient(0, by, 0, by + bh);
        gWell.addColorStop(0, UI.boardTop); gWell.addColorStop(1, UI.boardBg);
        ctx.fillStyle = gWell; ctx.fillRect(bx, by, bw, bh);
        // grade sutil: linhas bem fracas + pontinhos nos cruzamentos
        const gw = Math.max(1, Math.round(L.S * 0.75));
        ctx.fillStyle = UI.grid;
        for (let i = 1; i < COLS; i++) ctx.fillRect(bx + i * c, by, gw, bh);
        for (let j = 1; j < VISIBLE; j++) ctx.fillRect(bx, by + j * c, bw, gw);
        const d = Math.max(1, Math.round(L.S * 1.5)), h = Math.floor(d / 2);
        ctx.fillStyle = UI.gridDot;
        for (let i = 1; i < COLS; i++) for (let j = 1; j < VISIBLE; j++) ctx.fillRect(bx + i * c - h, by + j * c - h, d, d);
        // sombra interna sob a moldura de cima: o poço parece fundo
        const gShade = ctx.createLinearGradient(0, by, 0, by + Math.round(1.4 * c));
        gShade.addColorStop(0, 'rgba(0,0,0,0.45)'); gShade.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gShade; ctx.fillRect(bx, by, bw, Math.round(1.4 * c));
        // cartões e rótulos fixos
        const pad = Math.round(0.45 * c), maxW = L.pw - 2 * pad;
        let x = L.lx;
        card(x, by, L.pw, Math.round(4.6 * c));
        text('GUARDADA', x + pad, by + Math.round(1.15 * c), L.fLabel, UI.label, 'left', maxW);
        const sy = by + Math.round(5.2 * c);
        card(x, sy, L.pw, Math.round(9 * c));
        ['PONTOS', 'LINHAS', 'NÍVEL'].forEach(function (lb, i) {
          text(lb, x + pad, sy + Math.round(i * 3 * c) + Math.round(1.15 * c), L.fLabel, UI.label, 'left', maxW);
        });
        x = L.rx;
        card(x, by, L.pw, Math.round(10.4 * c));
        text('PRÓXIMAS', x + pad, by + Math.round(1.15 * c), L.fLabel, UI.label, 'left', maxW);
        const ry = by + Math.round(11 * c);
        card(x, ry, L.pw, Math.round(3.2 * c));
        text('RECORDE', x + pad, ry + Math.round(1.15 * c), L.fLabel, UI.label, 'left', maxW);
        // legenda de teclas (some quando a célula fica pequena demais para ler)
        if (c / L.S >= 15) {
          const legend = [['← →', 'MOVER'], ['↑ X Z', 'GIRAR'], ['↓', 'DESCER'], ['ESPAÇO', 'CAIR'], ['C', 'GUARDAR'], ['P', 'PAUSAR']];
          legend.forEach(function (l, i) {
            const ly = by + Math.round((15.1 + i * 0.82) * c);
            text(l[0], x + Math.round(0.15 * c), ly, L.fSmall, UI.accent, 'left');
            text(l[1], x + L.pw - Math.round(0.15 * c), ly, L.fSmall, UI.label, 'right');
          });
        }
      } finally {
        ctx = mainCtx;
      }
      L.baked = true;
      return true;
    }

    function draw() {
      if (!alive) return;
      if (!L) relayout();
      if (!L) return;
      if (!L.baked) bakeStatic();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      if (L.baked) ctx.drawImage(bake, 0, 0);
      else { ctx.fillStyle = UI.bg; ctx.fillRect(0, 0, L.W, L.H); }
      drawLeft();
      drawBoard();
      drawRight();
    }

    function drawLeft() {
      const c = L.c, x = L.lx, y = L.by, w = L.pw, pad = Math.round(0.45 * c), maxW = w - 2 * pad;
      if (hold) preview(hold, x + w / 2, y + Math.round(2.95 * c), Math.round(0.8 * c), holdUsed ? 0.35 : undefined);
      // valores (o placar "corre" até o número novo)
      const sy = y + Math.round(5.2 * c);
      const pts = state === 'playing' && !paused ? Math.round(shownScore) : score;
      [fmt(pts), fmt(lines), String(level)].forEach(function (v, i) {
        text(v, x + pad, sy + Math.round(i * 3 * c) + Math.round(2.55 * c), L.fValue, i === 0 && pts !== score ? UI.accent : UI.value, 'left', maxW);
      });
      // recado curto (linhas limpas, nível, recorde): entra com um "pulo" e some devagar
      if (msg) {
        const k = reduced ? 1 : Math.min(1, (msg.life - msg.t) / 0.4);
        const pop = reduced ? 1 : 1 + 0.35 * Math.max(0, 1 - msg.t / 0.16);
        ctx.globalAlpha = Math.max(0, k);
        msg.lines.forEach(function (ln, i) {
          const px = i === 0 ? Math.round(L.fValue * pop) : L.fLabel;
          text(ln, x + w / 2, y + Math.round((15.8 + i * 1.2) * c), px, i === 0 ? msg.color : UI.value, 'center', w);
        });
        ctx.globalAlpha = 1;
      }
    }

    function drawRight() {
      const c = L.c, x = L.rx, y = L.by, w = L.pw, pad = Math.round(0.45 * c), maxW = w - 2 * pad;
      const slots = [[3.0, 0.85], [5.9, 0.7], [8.55, 0.7]];
      if (state !== 'title') {
        // a próxima peça ganha um fundinho, para o olho achar rápido
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        ctx.fillRect(x + pad, y + Math.round(1.7 * c), w - 2 * pad, Math.round(2.6 * c));
        for (let i = 0; i < 3 && i < queue.length; i++) {
          preview(queue[i], x + w / 2, y + Math.round(slots[i][0] * c), Math.round(slots[i][1] * c), i === 0 ? undefined : 0.8);
        }
      }
      const ry = y + Math.round(11 * c);
      text(fmt(best), x + pad, ry + Math.round(2.6 * c), L.fValue, score > 0 && score >= best && state !== 'title' ? UI.accent : UI.value, 'left', maxW);
    }

    // Pilha decorativa da tela de título (só enfeite, por baixo do véu).
    const DECOR = [
      'I.....T..L',
      'IJ...TTLLL',
      'IJJJSSTOOZ',
      'OO.SSZZOOZ'
    ];
    // Letras do logo, cada uma num bloco de uma cor de peça.
    const LOGO = [['B', 'Z'], ['L', 'L'], ['O', 'O'], ['C', 'S'], ['O', 'I'], ['S', 'T']];
    const LOGO_WAVE = [0, 0.16, -0.08, 0.12, -0.04, 0.14];

    // Brilho em volta de um retângulo SEM pintar por dentro: o retângulo fica
    // fora da tela e só a sombra (deslocada de volta) aparece; o recorte par-ímpar
    // tira a parte que cairia sobre o tabuleiro.
    function glowRect(x, y, w, h, rgb, a, blur) {
      const far = 100000;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, L.W, L.H);
      ctx.rect(x, y, w, h);
      ctx.clip('evenodd');
      ctx.shadowColor = 'rgba(' + rgb + ',' + a.toFixed(3) + ')';
      ctx.shadowBlur = blur;
      ctx.shadowOffsetX = far;
      ctx.fillStyle = '#000';
      ctx.fillRect(x - far, y, w, h);
      ctx.restore();
    }

    function drawBoard() {
      const c = L.c, bx = L.bx, by = L.by, bw = COLS * c, bh = VISIBLE * c;
      // pulso da moldura (nível novo, QUADRA, recorde); o brilho de base já está assado
      if (glow) {
        const fb = Math.max(2, Math.round(c * 0.18));
        const k = 1 - glow.t / GLOW_PULSE;
        glowRect(bx - fb, by - fb, bw + 2 * fb, bh + 2 * fb, glow.rgb, 0.7 * k * k, (0.9 + 0.9 * k) * c);
      }

      if (state === 'title') {
        DECOR.forEach(function (row, i) {
          const vr = VISIBLE - DECOR.length + i;
          for (let x = 0; x < COLS; x++) if (row[x] !== '.') block(bx + x * c, by + vr * c, c, row[x]);
        });
      }

      // blocos travados (no fim de jogo ficam cinza de baixo para cima)
      for (let vr = 0; vr < VISIBLE; vr++) {
        const row = board[vr + HIDDEN];
        const gray = state === 'over' && (VISIBLE - 1 - vr) < overT * VISIBLE;
        for (let x = 0; x < COLS; x++) {
          if (row[x]) block(bx + x * c, by + vr * c, c, gray ? 'X' : row[x]);
        }
      }

      // a peça que acabou de travar dá um brilho rápido
      if (lockFx && state === 'playing') {
        ctx.fillStyle = 'rgba(255,250,235,' + (0.5 * (1 - lockFx.t / LOCK_FX)).toFixed(3) + ')';
        lockFx.cells.forEach(function (p) {
          const vr = p[1] - HIDDEN;
          if (vr >= 0) ctx.fillRect(bx + p[0] * c, by + vr * c, c, c);
        });
      }

      // linhas sendo limpas: uma faixa clara que abre do centro para as bordas
      // (estática com movimento reduzido)
      if (flash) {
        const ft = reduced ? FLASH_TIME_REDUCED : FLASH_TIME;
        const p = Math.min(1, flash.t / ft);
        const open = reduced ? 1 : 1 - Math.pow(1 - Math.min(1, p / 0.55), 3);
        const a = reduced ? 0.8 : (p < 0.55 ? 0.95 : 0.95 - (p - 0.55) / 0.45 * 0.6);
        const half = Math.round(bw / 2 * open);
        flash.rows.forEach(function (r) {
          const vr = r - HIDDEN;
          if (vr < 0) return;
          ctx.fillStyle = 'rgba(255,250,235,' + a.toFixed(3) + ')';
          ctx.fillRect(bx + bw / 2 - half, by + vr * c, half * 2, c);
          if (!reduced) {
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillRect(bx + bw / 2 - half, by + vr * c + Math.round(c * 0.42), half * 2, Math.max(1, Math.round(c * 0.16)));
          }
        });
      }

      ctx.save();
      ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
      // rastro da queda instantânea: some para cima e apaga em ~0,18 s
      trails.forEach(function (tr) {
        const a = Math.max(0, 0.32 * (1 - tr.t / 0.18));
        Object.keys(tr.cols).forEach(function (k) {
          const cx = +k, top = tr.cols[k];
          const y1 = by + (top - HIDDEN) * c, y0 = y1 - tr.dist * c;
          const g = ctx.createLinearGradient(0, y0, 0, y1);
          g.addColorStop(0, 'rgba(' + tr.rgb + ',0)');
          g.addColorStop(1, 'rgba(' + tr.rgb + ',' + a.toFixed(3) + ')');
          ctx.fillStyle = g;
          ctx.fillRect(bx + cx * c + Math.round(0.2 * c), y0, Math.round(0.6 * c), y1 - y0);
        });
      });
      if (piece && state === 'playing') {
        const gy = dropY();
        if (gy !== piece.y) cellsOf(piece.t, piece.r, piece.x, gy).forEach(function (p) { ghost(bx + p[0] * c, by + (p[1] - HIDDEN) * c, c, piece.t); });
        cellsOf(piece.t, piece.r, piece.x, piece.y).forEach(function (p) { block(bx + p[0] * c, by + (p[1] - HIDDEN) * c, c, piece.t); });
      }
      // fagulhas das linhas limpas
      sparks.forEach(function (p) {
        const k = 1 - p.t / p.life;
        const sz = Math.max(1, Math.round(p.s * c * (0.6 + 0.4 * k)));
        const px = Math.round(bx + p.x * c - sz / 2), py = Math.round(by + p.y * c - sz / 2);
        ctx.fillStyle = 'rgba(' + p.rgb + ',' + k.toFixed(3) + ')';
        ctx.fillRect(px, py, sz, sz);
        if (sz >= 3) {
          ctx.fillStyle = 'rgba(255,255,255,' + (0.7 * k).toFixed(3) + ')';
          ctx.fillRect(px + 1, py + 1, Math.max(1, Math.round(sz / 3)), Math.max(1, Math.round(sz / 3)));
        }
      });
      ctx.restore();

      // telas por cima do tabuleiro
      const cx = bx + bw / 2;
      if (state === 'title') {
        veil(0.6);
        drawLogo(cx, by + Math.round(6.3 * c));
        text('ARCADE DO ANDREYOS', cx, by + Math.round(3.9 * c), L.fLabel, UI.label, 'center', bw - c);
        text('ENTER ou toque', cx, by + Math.round(10.9 * c), L.fValue, UI.value, 'center', bw - c);
        text('para jogar', cx, by + Math.round(12.2 * c), L.fValue, UI.value, 'center', bw - c);
        text('encaixe as peças, feche', cx, by + Math.round(14.0 * c), L.fLabel, UI.label, 'center', bw - c);
        text('linhas, não deixe subir', cx, by + Math.round(15.0 * c), L.fLabel, UI.label, 'center', bw - c);
      } else if (state === 'playing' && paused) {
        veil(0.72);
        text('PAUSADO', cx, by + Math.round(9.5 * c), Math.round(2.1 * c), UI.accent, 'center', bw - c);
        text('P ou ENTER', cx, by + Math.round(11.4 * c), L.fLabel, UI.value, 'center', bw - c);
        text('para continuar', cx, by + Math.round(12.4 * c), L.fLabel, UI.value, 'center', bw - c);
      } else if (state === 'over' && overT >= 1) {
        veil(0.78);
        text('FIM DE JOGO', cx, by + Math.round(7.6 * c), Math.round(1.9 * c), UI.warm, 'center', bw - c);
        text('PONTOS', cx, by + Math.round(9.6 * c), L.fLabel, UI.label, 'center');
        text(fmt(score), cx, by + Math.round(11.1 * c), L.fValue, UI.value, 'center', bw - c);
        if (novoRecorde) text('NOVO RECORDE!', cx, by + Math.round(12.8 * c), L.fValue, UI.accent, 'center', bw - c);
        else text('RECORDE ' + fmt(best), cx, by + Math.round(12.8 * c), L.fLabel, UI.label, 'center', bw - c);
        text('ENTER para', cx, by + Math.round(15.2 * c), L.fLabel, UI.value, 'center', bw - c);
        text('recomeçar', cx, by + Math.round(16.2 * c), L.fLabel, UI.value, 'center', bw - c);
      }
    }

    // Logo: BLOCOS com cada letra num bloco biselado, em onda parada.
    function drawLogo(cx, y) {
      const c = L.c;
      const s = Math.round(1.42 * c), gap = Math.max(1, Math.round(0.1 * c));
      const total = LOGO.length * s + (LOGO.length - 1) * gap;
      const x0 = Math.round(cx - total / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font = font(Math.round(s * 1.3));
      LOGO.forEach(function (l, i) {
        const x = x0 + i * (s + gap), yy = y + Math.round(LOGO_WAVE[i] * c);
        // sombra dura embaixo, como adesivo de fliperama
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x + Math.round(0.12 * c), yy + Math.round(0.14 * c), s, s);
        block(x, yy, s, l[1]);
        // centraliza pela caixa real do glifo (a VT323 tem muito espaço de descendente)
        const m = ctx.measureText(l[0]);
        const up = m.actualBoundingBoxAscent || s * 0.5, down = m.actualBoundingBoxDescent || 0;
        const base = Math.round(yy + s / 2 + (up - down) / 2);
        const e = Math.max(1, Math.round(L.S));
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText(l[0], x + s / 2, base + e);
        ctx.fillStyle = '#141720';
        ctx.fillText(l[0], x + s / 2, base);
      });
    }
    function veil(a) {
      ctx.fillStyle = 'rgba(6,8,12,' + a + ')';
      ctx.fillRect(L.bx, L.by, COLS * L.c, VISIBLE * L.c);
    }

    /* ---------- ligações ---------- */
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('keyup', onKeyUp);
    root.addEventListener('focusout', onFocusOut);
    canvas.addEventListener('pointerdown', onCanvasPointer);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    function onVisibility() {
      if (doc.hidden) { pauseGame('aba'); flushRecord(); stop(); }
      else { draw(); kick(); }
    }
    doc.addEventListener('visibilitychange', onVisibility);

    function onMotionChange() {
      reduced = !!(mq && mq.matches);
      if (reduced) { trails = []; sparks = []; lockFx = null; glow = null; overT = 1; shownScore = score; }
      if (!raf) draw();
    }
    if (mq) {
      try { mq.addEventListener('change', onMotionChange); } catch (err) { try { mq.addListener(onMotionChange); } catch (err2) { /* sem aviso de mudança */ } }
    }

    let ro = null;
    function onResize() { relayout(); draw(); }

    // devicePixelRatio muda ao trocar de monitor ou dar zoom: refaz a resolução do canvas
    let dprMq = null;
    function unwatchDpr() {
      if (!dprMq) return;
      try { dprMq.m.removeEventListener('change', dprMq.h); } catch (err) { try { dprMq.m.removeListener(dprMq.h); } catch (err2) { /* nada */ } }
      dprMq = null;
    }
    function watchDpr() {
      unwatchDpr();
      if (!global.matchMedia) return;
      const m = global.matchMedia('(resolution: ' + (global.devicePixelRatio || 1) + 'dppx)');
      const h = function () { if (!alive) return; onResize(); watchDpr(); };
      try { m.addEventListener('change', h); } catch (err) { try { m.addListener(h); } catch (err2) { return; } }
      dprMq = { m: m, h: h };
    }
    watchDpr();
    if (typeof global.ResizeObserver === 'function') {
      ro = new global.ResizeObserver(onResize);
      ro.observe(stage);
    } else {
      global.addEventListener('resize', onResize);
    }

    // a fonte VT323 pode chegar depois do primeiro desenho
    // a camada estática tem texto: refaz quando a fonte chega
    function onFonts() { if (!alive) return; if (L) L.baked = false; if (!raf) draw(); }
    try {
      if (doc.fonts) {
        if (doc.fonts.load) doc.fonts.load('20px "VT323"').then(onFonts, function () {});
        if (doc.fonts.ready) doc.fonts.ready.then(onFonts, function () {});
        if (doc.fonts.addEventListener) doc.fonts.addEventListener('loadingdone', onFonts);
      }
    } catch (err) { /* sem Font Loading API: fica a fonte reserva */ }

    relayout();
    draw();

    /* ---------- API ---------- */
    const api = {
      el: root,
      start: function () { if (alive) startGame(); },
      pause: function () { return alive ? pauseGame('api') : false; },
      resume: function () { return alive ? resumeGame() : false; },
      isRunning: function () { return alive && state === 'playing' && !paused; },
      handleKey: handleKey,
      setVisible: function (v) {
        if (!alive) return;
        visible = !!v;
        if (!visible) { pauseGame('oculto'); releaseAll(); stop(); }
        else { relayout(); draw(); kick(); }
      },
      focus: function () { if (alive) focusCanvas(); },
      getState: function () {
        return {
          estado: state, pausado: paused, rodando: api.isRunning(),
          pontos: score, linhas: lines, nivel: level, recorde: best, novoRecorde: novoRecorde,
          atual: piece ? { tipo: piece.t, x: piece.x, y: piece.y, rot: piece.r, celulas: cellsOf(piece.t, piece.r, piece.x, piece.y) } : null,
          fantasmaY: piece ? dropY() : null,
          proximas: queue.slice(0, 3), guardada: hold, guardouNestaPeca: holdUsed,
          limpando: !!flash, quadros: frames, loopAtivo: !!raf, movimentoReduzido: reduced,
          recado: msg ? msg.lines.join(' ') : null, fagulhas: sparks.length, placarMostrado: Math.round(shownScore),
          tabuleiro: board.map(function (r) { return r.map(function (v) { return v || '.'; }).join(''); }),
          canvas: { largura: canvas.width, altura: canvas.height, cssLargura: stage.clientWidth, cssAltura: stage.clientHeight, celula: L ? L.c : 0, escala: L ? L.S : 0 }
        };
      },
      dispose: function () {
        if (!alive) return;
        recordDirty = true;
        flushRecord();
        alive = false;
        generation++;
        stop();
        root.removeEventListener('keydown', onKeyDown);
        root.removeEventListener('keyup', onKeyUp);
        root.removeEventListener('focusout', onFocusOut);
        canvas.removeEventListener('pointerdown', onCanvasPointer);
        doc.removeEventListener('visibilitychange', onVisibility);
        if (mq) { try { mq.removeEventListener('change', onMotionChange); } catch (err) { try { mq.removeListener(onMotionChange); } catch (err2) { /* nada */ } } }
        if (ro) ro.disconnect(); else global.removeEventListener('resize', onResize);
        unwatchDpr();
        try { if (doc.fonts && doc.fonts.removeEventListener) doc.fonts.removeEventListener('loadingdone', onFonts); } catch (err) { /* nada */ }
        if (root.parentNode) root.parentNode.removeChild(root);
        bake = null;
        removeStyle();
      }
    };
    return api;
  }

  global.AndreyBlocos = {
    create: create,
    getRecord: loadRecord,
    RECORD_KEY: RECORD_KEY
  };
})(window);
