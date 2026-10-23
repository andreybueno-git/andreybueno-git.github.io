/*
 * zumbis.js — NOITE DOS ZUMBIS, o jogo de sobrevivência do AndreyOS 24.
 *
 * Contrato (o mesmo do AndreyBlocos, para o desktop hospedar igual):
 *   AndreyZumbis.create(containerEl, { onEvent(kind, detail) }) -> api
 *     kind: 'start' | 'shot' | 'hit' | 'hurt' | 'wave' | 'pickup' | 'gameover' | 'record' | 'pause' | 'resume'
 *   api.start(); api.pause(); api.resume(); api.isRunning()
 *   api.handleKey(key)   -> true se a tecla foi usada pelo jogo
 *   api.handleKey(key, 'down' | 'up')  segurar/soltar de verdade (andar, atirar sem parar);
 *                                      sem o 2º argumento cada chamada é um toque curto
 *   api.setVisible(bool) -> false pausa e para o rAF
 *   api.dispose(); api.focus(); api.el (nó raiz); api.getState() (retrato para testes)
 *   AndreyZumbis.getRecord(), AndreyZumbis.RECORD_KEY ('andreyos.zumbis.recorde')
 *
 * Detalhe dos eventos (o integrador toca os sons; o jogo não tem áudio):
 *   'start' {recorde} · 'wave' {onda, zumbis} · 'shot' {pente, reserva}
 *   'hit' {tipo, pontos, total, abates}   um zumbi caiu
 *   'hurt' {vidas}                          o jogador apanhou
 *   'pickup' {tipo: 'municao' | 'cafe', vidas, reserva, total}   total = pontos da partida
 *   'gameover' {pontos, onda, abates, recorde, novoRecorde}
 *   'record' {recorde, pontos, anterior} · 'pause' {motivo} · 'resume' {}
 *   Extras (ninguém precisa usar): 'reload' {pente, reserva} e 'empty' {} (gatilho sem bala nenhuma).
 *
 * Extras opcionais: opção { random } (gerador [0,1) para sortear com semente) e api._teste
 * (ganchos só para os testes: põe zumbi e coletável, congela as ondas, mede pontos na tela).
 *
 * Controles: WASD ou setas andam; o mouse mira (sem mouse, mira para onde anda, com uma
 * ajudinha para achar o zumbi da frente); clique ou Espaço atira; R ou botão direito
 * recarrega; P ou Esc pausa. No toque: joystick na metade esquerda e tiro na direita
 * (o tiro do toque ajuda a mirar no zumbi mais perto dentro de ±35° de onde o joystick
 * empurra ou a lanterna aponta; sem zumbi no cone, atira para a lanterna).
 *
 * Ponteiro: o jogo mora dentro do desktop, que é colado na tela do CRT por matrix3d.
 * O clique é convertido para o canvas por offsetX/offsetY (o navegador já desfaz o
 * transform, inclusive a perspectiva e o giro de 90° do celular) e depois para pixels
 * do canvas por canvas.width / canvas.clientWidth. Nunca por getBoundingClientRect,
 * que só serve para medir a escala da projeção (nitidez).
 *
 * Teclado: nenhum listener global. As teclas chegam por handleKey() (o desktop repassa)
 * ou por keydown dentro do próprio componente (canvas focado). Quando o jogo usa a
 * tecla, faz preventDefault + stopPropagation; a mesma tecla chegando pelos dois
 * caminhos no mesmo evento conta uma vez. Esc só é usado para pausar: com o jogo já
 * pausado ele passa adiante (o desktop fecha a janela, como no BLOCOS).
 *
 * Desenho: o quintal é pintado em 256×160 pixels e ampliado sem suavizar, por um fator
 * inteiro, em pixels do dispositivo (devicePixelRatio × escala da projeção 3D), para a
 * pixel art ficar nítida mesmo dentro do matrix3d. A luz é um mapa de luz multiplicado
 * por cima (lanterna em cone, poste, janela da casa); olhos, balas e a lua brilham por
 * cima do escuro. HUD e textos são desenhados na resolução cheia, em VT323, grandes.
 * Fundo, cerca e casa ficam numa camada estática; a cada quadro só o que se mexe muda.
 *
 * Eventos: o onEvent pode chamar start(), pause() ou dispose() de dentro do próprio
 * aviso; o jogo detecta e não continua a partida antiga por cima da nova.
 * O 'record' do primeiro recorde (sem recorde anterior) sai logo depois do 'gameover';
 * batendo um recorde anterior, sai no meio da partida.
 * start() com o jogo escondido (setVisible(false) ou aba oculta) já nasce pausado,
 * para isRunning() nunca dizer true sem laço rodando.
 * Movimento reduzido: sem tremor de tela, sem clarão do tiro, piscar suave no lugar
 * de piscar rápido; nada pisca mais de 3 vezes por segundo em nenhum modo.
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Regras                                                              */
  /* ------------------------------------------------------------------ */

  const VW = 256, VH = 160;            // pixels do jogo
  const SKY_H = 17;                    // faixa do céu (o HUD mora aqui)
  const FENCE_Y = 28;                  // pé da cerca
  const PORCH_Y = 147;                 // começo da varanda
  const BOUNDS = { x0: 7, x1: 249, y0: 37, y1: 153 };   // onde os pés podem ir
  const GAPS = [[40, 64], [188, 212]]; // porteiras abertas na cerca

  const PLAYER_SPEED = 56;             // px do jogo por segundo
  const PLAYER_R = 4;
  const HEARTS = 3;
  const MAG = 8;
  const START_RESERVE = 24;
  const AMMO_BOX = 14;
  const RELOAD_TIME = 1.05;
  const FIRE_COOLDOWN = 0.19;
  const BULLET_SPEED = 240;
  const INVULN = 1.4;
  const TAP_MOVE = 0.16;               // s de passo por toque de tecla sem 'down'/'up'
  const TOUCH_CONE = 35 * Math.PI / 180; // ajuda de mira do toque: ±35° da direção do joystick/lanterna
  const STICK_DEAD = 0.2 * 18;         // zona morta do joystick, em px do jogo (raio 18)
  const WAVE_BREAK = 3.2;
  const PICKUP_LIFE = 15;
  const OVER_ANIM = 0.8;
  const OVER_GUARD_MS = 700;           // evita recomeçar sem querer logo após perder
  const DUP_WINDOW_MS = 8;
  const MAX_BACKING_PX = 4200000;
  const RECORD_KEY = 'andreyos.zumbis.recorde';

  const ZT = {
    normal:   { hp: 2, speed: 15, r: 4.5, hitR: 5, pts: 10, knock: 70 },
    corredor: { hp: 1, speed: 34, r: 4, hitR: 4.5, pts: 15, knock: 80 },
    grandao:  { hp: 7, speed: 10, r: 6.5, hitR: 7, pts: 40, knock: 18 }
  };

  // Tronco do pequizeiro, poste, cupinzeiro e toco: ninguém atravessa, bala para.
  const OBST = [
    { kind: 'pequi', x: 82, y: 76, r: 5 },
    { kind: 'poste', x: 200, y: 100, r: 3 },
    { kind: 'cupim', x: 30, y: 126, r: 6 },
    { kind: 'toco', x: 150, y: 54, r: 4 }
  ];
  const LAMP = { x: 202, y: 98 };      // chão iluminado pelo poste
  const PATH = [[118, 162], [124, 134], [148, 106], [176, 72], [196, 46], [200, 24]];

  /* ------------------------------------------------------------------ */
  /* Utilidades                                                          */
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
  function fmt(n) { return String(Math.max(0, Math.floor(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function now() { return (global.performance && global.performance.now) ? global.performance.now() : Date.now(); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  // ruído fixo por coordenada (o cenário sai igual sempre, sem gastar o sorteio do jogo)
  function hash(x, y, s) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul((s || 0) + 1, 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
  function makeCanvas(w, h) { const c = global.document.createElement('canvas'); c.width = w; c.height = h; return c; }

  /* ------------------------------------------------------------------ */
  /* Sprites (pixel art em texto; '.' é transparente)                    */
  /* ------------------------------------------------------------------ */

  const K_OUT = '#0a0b10';
  const PLAYER_PAL = {
    k: K_OUT, c: '#e8692e', C: '#a8441b', h: '#2a1a12', s: '#e3a679', S: '#b77650', e: '#1a1010',
    y: '#f2c14e', Y: '#c4902c', b: '#3a5688', B: '#26395c'
  };
  const ZPAL = {
    normal:   { k: K_OUT, g: '#86b450', G: '#5f8a36', r: '#ff5a3c', m: '#3a1410', t: '#6f7d8f', T: '#4c5666', p: '#5b4631', P: '#3e3021' },
    corredor: { k: K_OUT, g: '#bccb9e', G: '#909f78', r: '#ff2d2d', m: '#3a1410', t: '#b03a3a', T: '#7c2626', p: '#2d3652', P: '#1e253a' },
    grandao:  { k: K_OUT, g: '#5f8d3a', G: '#456b28', r: '#ffcc33', m: '#2a0e0a', o: '#6a4c94', O: '#47336a', p: '#3b3b46', P: '#26262e' }
  };
  const EYE_GLOW = { normal: '#ff6a48', corredor: '#ff3b30', grandao: '#ffd23c' };

  const PLAYER_TPL = {
    down: [
      '..kkkkkk..',
      '.kcccccck.',
      '.kcCCCCck.',
      '.khsssshk.',
      '.ksessesk.',
      '..kssssk..',
      '.kkyyyykk.',
      'ksyyyyyysk',
      'ksyyYYyysk',
      'kkyyyyyykk',
      '.kbbbbbbk.',
      '.kbbkkbbk.',
      '.kbk..kbk.',
      '.kkk..kkk.'
    ],
    downLegs: [
      ['.kbbkkbbk.', '.kbk..kkk.', '.kkk......'],
      ['.kbbkkbbk.', '.kkk..kbk.', '......kkk.']
    ],
    up: [
      '..kkkkkk..',
      '.kcccccck.',
      '.kcccccck.',
      '.khhhhhhk.',
      '.khhhhhhk.',
      '..kSSSSk..',
      '.kkyyyykk.',
      'ksyyyyyysk',
      'ksyyyyyysk',
      'kkYYYYYYkk',
      '.kbbbbbbk.',
      '.kbbkkbbk.',
      '.kbk..kbk.',
      '.kkk..kkk.'
    ],
    side: [
      '..kkkkk...',
      '.kccccck..',
      '.kcccccCCk',
      '.khhsssk..',
      '.khssesk..',
      '..kssSk...',
      '..kyyyyk..',
      '..kyyyysk.',
      '..kyyYYk..',
      '..kYYYYk..',
      '...kbbk...',
      '...kbbk...',
      '...kbbk...',
      '...kkkk...'
    ],
    sideLegs: [
      ['..kbkkbk..', '.kbk..kbk.', '.kk....kk.'],
      ['...kbbk...', '...kbbk...', '...kkkk...']
    ]
  };

  const ZOMBIE_TPL = {
    down: [
      '...kkkk...',
      '..kggggk..',
      '.kggggggk.',
      '.kgrggrgk.',
      '.kggggggk.',
      '.kggmmggk.',
      'kkttttttkk',
      'ktGttttGtk',
      'kttttTtttk',
      '.kttTtttk.',
      '.kppppppk.',
      '.kppkkppk.',
      '.kpk..kpk.',
      '.kkk..kkk.'
    ],
    downLegs: [
      ['.kppkkppk.', '.kpk..kkk.', '.kkk......'],
      ['.kppkkppk.', '.kkk..kpk.', '......kkk.']
    ],
    side: [
      '..kkkk....',
      '.kggggk...',
      '.kgggggk..',
      '.kggggrk..',
      '.kggggmk..',
      '..kgggk...',
      '.kttttkkkk',
      '.kttttGGGk',
      '.ktTttkkk.',
      '.kttttk...',
      '..kppk....',
      '..kppk....',
      '..kppk....',
      '..kkkk....'
    ],
    sideLegs: [
      ['..kppk....', '.kpkkpk...', '.kk..kk...'],
      ['..kppk....', '..kppk....', '..kkkk....']
    ],
    backSwap: { r: 'g', m: 'g', G: 't' }
  };

  const BRUTE_TPL = {
    down: [
      '....kkkkkk....',
      '...kggggggk...',
      '..kggggggggk..',
      '..kgrggggrgk..',
      '..kggggggggk..',
      '..kggmmmmggk..',
      '.kkkggggggkkk.',
      'kgooooooooooGk',
      'kgooOooooOooGk',
      'kgoooooooooogk',
      'kkooooooooookk',
      '.kooOOOOOOook.',
      '.kooookkooook.',
      '.kpppk..kpppk.',
      '.kpppk..kpppk.',
      '.kpppk..kpppk.',
      '.kkkkk..kkkkk.'
    ],
    downLegs: [
      ['.kpppk..kpppk.', '.kpppk..kkkkk.', '.kkkkk........'],
      ['.kpppk..kpppk.', '.kkkkk..kpppk.', '........kkkkk.']
    ],
    side: [
      '...kkkkkk.....',
      '..kggggggk....',
      '..kgggggggk...',
      '..kggggggrk...',
      '..kgggggmmk...',
      '...kggggggk...',
      '.kkoooookkkkk.',
      'koooooooGGGGk.',
      'koooOooookkkk.',
      'kooooooook....',
      'koooooOook....',
      'kkoooooookk...',
      '.kooooooook...',
      '..kpppkpppk...',
      '..kpppkpppk...',
      '..kpppkpppk...',
      '..kkkkkkkkk...'
    ],
    sideLegs: [
      ['.kpppk.kpppk..', 'kpppk...kpppk.', 'kkkkk...kkkkk.'],
      ['..kpppkpppk...', '..kpppkpppk...', '..kkkkkkkkk...']
    ],
    backSwap: { r: 'g', m: 'g', G: 'o' }
  };

  const AMMO_TPL = [
    '.kkkkkkkk.',
    'kykykykyyk',
    'kaaaaaaaak',
    'kaAAAAAAak',
    'kaaaaaaaak',
    'kkkkkkkkkk'
  ];
  const AMMO_PAL = { k: K_OUT, y: '#ffe27a', a: '#5d6b2e', A: '#c9b458' };
  const COFFEE_TPL = [
    '.kkkkk...',
    'kCCCCCkk.',
    'kwwwwwk.k',
    'kwwwwwkkk',
    '.kwwwk...',
    'kkkkkkkk.',
    '.kWWWWWk.',
    '..kkkkk..'
  ];
  const COFFEE_PAL = { k: K_OUT, C: '#4a2a16', w: '#f1ece0', W: '#cfc8b8' };
  const HEART_TPL = [
    '.kk...kk.',
    'krrk.krrk',
    'krRrkrrrk',
    'krrrrrrrk',
    '.krrrrrk.',
    '..krrrk..',
    '...krk...',
    '....k....'
  ];
  const BULLET_TPL = [
    '..k..',
    '.kyk.',
    'kyYyk',
    'kyyyk',
    'koook',
    'koook',
    'koook',
    'kOOOk',
    'kkkkk'
  ];
  const PUDDLE_TPL = [
    '..ggggg..',
    '.gGgggGg.',
    'gggGggggg',
    '.ggggggg.'
  ];

  function paint(rows, pal, swap) {
    let w = 0;
    rows.forEach(function (r) { w = Math.max(w, r.length); });
    const c = makeCanvas(w, rows.length);
    const g = c.getContext('2d');
    rows.forEach(function (r, y) {
      for (let x = 0; x < r.length; x++) {
        let ch = r[x];
        if (swap && swap[ch]) ch = swap[ch];
        if (ch === '.' || !pal[ch]) continue;
        g.fillStyle = pal[ch];
        g.fillRect(x, y, 1, 1);
      }
    });
    return c;
  }
  function flipped(src) {
    const c = makeCanvas(src.width, src.height);
    const g = c.getContext('2d');
    g.translate(src.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0);
    return c;
  }
  function silhouette(src, color) {
    const c = makeCanvas(src.width, src.height);
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
    return c;
  }
  function withLegs(rows, legs) { return rows.slice(0, rows.length - legs.length).concat(legs); }
  function eyesOf(rows, w, mirror) {
    const out = [];
    rows.forEach(function (r, y) { for (let x = 0; x < r.length; x++) if (r[x] === 'r') out.push([mirror ? w - 1 - x : x, y]); });
    return out;
  }

  // Monta um conjunto de quadros: down/up/right/left × [parado, passo 1, passo 2]
  function buildSet(tpl, pal) {
    const up = tpl.up || tpl.down;
    const swap = tpl.up ? null : tpl.backSwap;
    const set = { down: [], up: [], right: [], left: [], white: {}, eyes: {} };
    const downRows = [tpl.down, withLegs(tpl.down, tpl.downLegs[0]), withLegs(tpl.down, tpl.downLegs[1])];
    const upRows = [up, withLegs(up, tpl.downLegs[0]), withLegs(up, tpl.downLegs[1])];
    const sideRows = [tpl.side, withLegs(tpl.side, tpl.sideLegs[0]), withLegs(tpl.side, tpl.sideLegs[1])];
    downRows.forEach(function (r) { set.down.push(paint(r, pal)); });
    upRows.forEach(function (r) { set.up.push(paint(r, pal, swap)); });
    sideRows.forEach(function (r) { const s = paint(r, pal); set.right.push(s); set.left.push(flipped(s)); });
    ['down', 'up', 'right', 'left'].forEach(function (d) { set.white[d] = set[d].map(function (s) { return silhouette(s, '#ffffff'); }); });
    const sw = set.right[0].width;
    set.eyes.down = eyesOf(tpl.down, 0, false);
    set.eyes.up = [];
    set.eyes.right = eyesOf(tpl.side, sw, false);
    set.eyes.left = eyesOf(tpl.side, sw, true);
    set.w = set.down[0].width; set.h = set.down[0].height;
    return set;
  }

  /* ------------------------------------------------------------------ */
  /* Cenário (camada estática, pintada uma vez)                          */
  /* ------------------------------------------------------------------ */

  function hexRgb(hex) { const h = hex.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function distSeg(px, py, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const t = clamp(((px - a[0]) * vx + (py - a[1]) * vy) / (vx * vx + vy * vy), 0, 1);
    const dx = px - (a[0] + vx * t), dy = py - (a[1] + vy * t);
    return Math.sqrt(dx * dx + dy * dy);
  }
  function inGap(x) { for (let i = 0; i < GAPS.length; i++) if (x >= GAPS[i][0] && x <= GAPS[i][1]) return true; return false; }

  function paintBackground() {
    const c = makeCanvas(VW, VH);
    const g = c.getContext('2d');
    const img = g.createImageData(VW, VH);
    const d = img.data;
    const grass = ['#35532f', '#3c5c34', '#2f4a2a', '#43643a', '#3a5732'].map(hexRgb);
    const dirt = ['#7c4027', '#8a4a2d', '#6c3621', '#94532f'].map(hexRgb);
    const skyTop = hexRgb('#070c22'), skyBot = hexRgb('#1d2b54');
    for (let y = 0; y < VH; y++) {
      for (let x = 0; x < VW; x++) {
        let col;
        if (y < SKY_H) {
          const t = y / (SKY_H - 1);
          col = [0, 1, 2].map(function (i) { return Math.round(skyTop[i] + (skyBot[i] - skyTop[i]) * t); });
        } else {
          const n = hash(x, y, 1);
          col = grass[n < 0.45 ? 0 : n < 0.7 ? 1 : n < 0.86 ? 2 : n < 0.95 ? 4 : 3];
          // trilha de terra vermelha da varanda até a porteira da direita
          let md = 99;
          for (let i = 0; i < PATH.length - 1; i++) md = Math.min(md, distSeg(x, y, PATH[i], PATH[i + 1]));
          const w = 5.2 + Math.sin(y * 0.21) * 0.9 + hash(x >> 1, y >> 1, 2) * 1.2;
          if (md < w || (md < w + 1.6 && hash(x, y, 3) > 0.55)) {
            const m = hash(x, y, 4);
            col = dirt[m < 0.5 ? 0 : m < 0.78 ? 1 : m < 0.93 ? 2 : 3];
          }
        }
        const o = (y * VW + x) * 4;
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);

    function px(x, y, color) { g.fillStyle = color; g.fillRect(x, y, 1, 1); }

    // serra baixa no horizonte
    for (let x = 0; x < VW; x++) {
      const hgt = 2 + Math.round(1.5 + Math.sin(x * 0.045) * 1.5 + Math.sin(x * 0.13 + 1) * 0.8 + hash(x, 0, 5) * 0.8);
      g.fillStyle = '#0d1527';
      g.fillRect(x, SKY_H - hgt, 1, hgt);
    }
    // buritis contra o céu
    [[20, 3], [106, 5], [118, 7], [236, 4]].forEach(function (b) {
      const bx = b[0], top = b[1];
      g.fillStyle = '#080d1b';
      g.fillRect(bx, top, 1, SKY_H - top);
      const fr = [[-1, 0], [-0.75, -0.6], [-0.35, -0.95], [0.35, -0.95], [0.75, -0.6], [1, 0], [-0.9, 0.35], [0.9, 0.35]];
      fr.forEach(function (f) {
        for (let i = 1; i <= 6; i++) {
          const fx = Math.round(bx + f[0] * i), fy = Math.round(top + f[1] * i * 0.7 + (i * i) * 0.06);
          if (fy >= 0) px(fx, fy, '#080d1b');
        }
      });
    });

    // capim seco, florzinhas e pedrinhas
    for (let i = 0; i < 150; i++) {
      const x = Math.floor(hash(i, 7, 6) * VW), y = SKY_H + 2 + Math.floor(hash(i, 9, 6) * (PORCH_Y - SKY_H - 4));
      const k = hash(i, 11, 6);
      if (k < 0.72) {
        const cc = k < 0.4 ? '#6f8a46' : k < 0.6 ? '#8a9a4e' : '#56733c';
        px(x, y, cc); px(x - 1, y - 1, cc); px(x + 1, y - 1, cc); px(x, y - 2, cc);
      } else if (k < 0.85) {
        px(x, y, k < 0.8 ? '#e8d07a' : '#d78fb0'); px(x, y + 1, '#4d6b36');
      } else {
        px(x, y, '#5c6168'); px(x + 1, y, '#474b52'); px(x, y - 1, '#71767e');
      }
    }

    // cerca de madeira com duas porteiras abertas
    for (let x = 0; x < VW; x++) {
      if (inGap(x)) continue;
      px(x, FENCE_Y - 9, '#7a5838'); px(x, FENCE_Y - 8, '#4a3220');
      px(x, FENCE_Y - 5, '#7a5838'); px(x, FENCE_Y - 4, '#4a3220');
      px(x, FENCE_Y - 2, 'rgba(0,0,0,0.25)');
    }
    for (let x = 2; x < VW; x += 14) {
      if (inGap(x) || inGap(x + 2)) continue;
      g.fillStyle = K_OUT; g.fillRect(x - 1, FENCE_Y - 13, 5, 13);
      g.fillStyle = '#5e422b'; g.fillRect(x, FENCE_Y - 12, 3, 12);
      g.fillStyle = '#7f5e3e'; g.fillRect(x, FENCE_Y - 12, 1, 12);
      g.fillStyle = '#9a7650'; g.fillRect(x, FENCE_Y - 12, 3, 1);
    }
    // mourões das porteiras
    GAPS.forEach(function (gp) {
      [gp[0] - 1, gp[1] - 2].forEach(function (x) {
        g.fillStyle = K_OUT; g.fillRect(x - 1, FENCE_Y - 15, 5, 15);
        g.fillStyle = '#5a3e27'; g.fillRect(x, FENCE_Y - 14, 3, 14);
        g.fillStyle = '#7f5e3e'; g.fillRect(x, FENCE_Y - 14, 1, 14);
      });
    });
    // porteira da esquerda caída de lado; tábua solta na da direita
    for (let i = 0; i < 14; i++) { px(GAPS[0][0] + 3 + i, FENCE_Y - 1 - Math.round(i * 0.55), '#6b4b30'); px(GAPS[0][0] + 3 + i, FENCE_Y - Math.round(i * 0.55), '#3a2818'); }
    g.fillStyle = '#6b4b30'; g.fillRect(GAPS[1][0] + 5, FENCE_Y + 3, 12, 2);
    g.fillStyle = '#3a2818'; g.fillRect(GAPS[1][0] + 5, FENCE_Y + 5, 12, 1);

    // varanda de tábuas (a casa fica atrás de quem joga)
    g.fillStyle = '#2a1c12'; g.fillRect(0, PORCH_Y - 1, VW, 1);
    g.fillStyle = '#7a5636'; g.fillRect(0, PORCH_Y, VW, 1);
    for (let y = PORCH_Y + 1; y < VH; y++) {
      g.fillStyle = (y - PORCH_Y) % 4 === 0 ? '#47301f' : '#5e4029';
      g.fillRect(0, y, VW, 1);
    }
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(hash(i, 3, 8) * VW), y = PORCH_Y + 1 + Math.floor(hash(i, 5, 8) * 12);
      if ((y - PORCH_Y) % 4) px(x, y, '#4f3622');
    }
    // capacho na frente da porta
    g.fillStyle = '#7d3326'; g.fillRect(110, PORCH_Y + 4, 20, 7);
    g.fillStyle = '#9a4532'; g.fillRect(111, PORCH_Y + 5, 18, 5);
    // esteios da varanda
    [12, 240].forEach(function (x) {
      g.fillStyle = K_OUT; g.fillRect(x - 1, PORCH_Y + 2, 6, 11);
      g.fillStyle = '#6a4a2e'; g.fillRect(x, PORCH_Y + 3, 4, 9);
      g.fillStyle = '#8a6844'; g.fillRect(x, PORCH_Y + 3, 1, 9);
    });
    return c;
  }

  // Lua e estrelas: brilham por cima do escuro
  function paintSky() {
    const c = makeCanvas(VW, VH);
    const g = c.getContext('2d');
    for (let i = 0; i < 34; i++) {
      const x = Math.floor(hash(i, 1, 9) * VW), y = Math.floor(hash(i, 2, 9) * (SKY_H - 5));
      g.fillStyle = hash(i, 3, 9) < 0.3 ? '#e8ecff' : '#8f9ac0';
      g.fillRect(x, y, 1, 1);
    }
    const mx = 176, my = 8, mr = 6;
    for (let y = -mr - 2; y <= mr + 2; y++) {
      for (let x = -mr - 2; x <= mr + 2; x++) {
        const dd = Math.sqrt(x * x + y * y);
        if (dd <= mr) {
          const crater = (x === -2 && y === -1) || (x === 2 && y === 2) || (x === 1 && y === -3) || (x === -3 && y === 3);
          g.fillStyle = crater ? '#cfc8ac' : (x + y > 4 ? '#e2dcc0' : '#f6f1da');
          g.fillRect(mx + x, my + y, 1, 1);
        } else if (dd <= mr + 1.6) {
          g.fillStyle = 'rgba(220,226,255,0.22)';
          g.fillRect(mx + x, my + y, 1, 1);
        }
      }
    }
    return c;
  }

  // Objetos do quintal (desenhados por pixel, com contorno)
  function blobSprite(w, h, inside, color) {
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    const mask = [];
    for (let y = 0; y < h; y++) { mask.push([]); for (let x = 0; x < w; x++) mask[y].push(!!inside(x, y)); }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y][x]) { g.fillStyle = color(x, y); g.fillRect(x, y, 1, 1); continue; }
        const near = (y > 0 && mask[y - 1][x]) || (y < h - 1 && mask[y + 1][x]) || (x > 0 && mask[y][x - 1]) || (x < w - 1 && mask[y][x + 1]);
        if (near) { g.fillStyle = K_OUT; g.fillRect(x, y, 1, 1); }
      }
    }
    return c;
  }
  function paintPequi() {
    // copa redonda de pequizeiro, tronco torto; base do tronco em (17, 35)
    const circles = [[17, 11, 10.5], [8, 14, 7], [26, 14, 7], [12, 6, 6], [22, 6, 6]];
    function inCanopy(x, y) { for (let i = 0; i < circles.length; i++) { const c = circles[i]; if ((x - c[0]) * (x - c[0]) + (y - c[1]) * (y - c[1]) <= c[2] * c[2]) return true; } return false; }
    function inTrunk(x, y) {
      if (y < 17 || y > 34) return false;
      const cx = 17 + Math.round(Math.sin(y * 0.35) * 1.2);
      if (x >= cx - 1 && x <= cx + 1) return true;
      if (y >= 31 && x >= cx - 2 && x <= cx + 2) return true;
      return y >= 19 && y <= 22 && x === cx + 2 + (22 - y);
    }
    return blobSprite(35, 36, function (x, y) { return inCanopy(x, y) || inTrunk(x, y); }, function (x, y) {
      if (inCanopy(x, y)) {
        const n = hash(x, y, 21);
        if (n > 0.965 && y > 4) return '#d6c64a';          // pequi maduro
        const lit = (x - 12) * -0.6 + (y - 6) * -1;         // a lua bate de cima
        if (lit > 4 || n > 0.82) return '#4f8a3c';
        if (lit < -9 || n < 0.12) return '#22421f';
        return '#356b2e';
      }
      return hash(x, y, 22) > 0.6 ? '#7b5a3a' : '#5a3f27';
    });
  }
  function paintPoste() {
    // poste de madeira com braço e lâmpada; base em (5, 33)
    const c = makeCanvas(11, 34);
    const g = c.getContext('2d');
    g.fillStyle = K_OUT; g.fillRect(3, 4, 4, 30); g.fillRect(1, 3, 9, 3); g.fillRect(6, 5, 4, 5);
    g.fillStyle = '#5e4630'; g.fillRect(4, 5, 2, 28);
    g.fillStyle = '#7d6044'; g.fillRect(4, 5, 1, 28);
    g.fillStyle = '#6b5238'; g.fillRect(2, 4, 7, 1);
    g.fillStyle = '#c9c3b0'; g.fillRect(7, 6, 2, 2);
    g.fillStyle = '#fff2b8'; g.fillRect(7, 8, 2, 1);
    return c;
  }
  function paintCupim() {
    // cupinzeiro de terra vermelha; base em (7, 15)
    return blobSprite(15, 16, function (x, y) {
      const cx = 7, top = 2 + Math.abs(x - cx) * 1.3 - (x === 5 || x === 9 ? 2 : 0);
      return y >= top && y <= 14 && x >= 1 && x <= 13 && Math.abs(x - cx) <= 6 - (y < 6 ? 2 : 0);
    }, function (x, y) {
      const n = hash(x, y, 31);
      if (x < 6 && n > 0.3) return '#b06a3e';
      if (n > 0.8) return '#c37a48';
      return n < 0.25 ? '#6e3a22' : '#8f5230';
    });
  }
  function paintToco() {
    // toco cortado; base em (5, 8)
    return blobSprite(11, 9, function (x, y) { return x >= 1 && x <= 9 && y >= 1 && y <= 7 && !(y === 1 && (x === 1 || x === 9)); }, function (x, y) {
      if (y <= 3) return (x + y) % 3 === 0 ? '#a7865c' : '#c4a274';
      return hash(x, y, 41) > 0.5 ? '#5e4430' : '#4a3424';
    });
  }

  function lightSprite(r, rgb, a0, a1) {
    const c = makeCanvas(r * 2, r * 2);
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, 'rgba(' + rgb + ',' + a0 + ')');
    gr.addColorStop(0.5, 'rgba(' + rgb + ',' + a1 + ')');
    gr.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2);
    return c;
  }

  // Tudo que é pintado uma vez fica aqui (feito na primeira partida criada)
  let ART = null;
  function art() {
    if (ART) return ART;
    ART = {
      player: buildSet(PLAYER_TPL, PLAYER_PAL),
      normal: buildSet(ZOMBIE_TPL, ZPAL.normal),
      corredor: buildSet(ZOMBIE_TPL, ZPAL.corredor),
      grandao: buildSet(BRUTE_TPL, ZPAL.grandao),
      ammo: paint(AMMO_TPL, AMMO_PAL),
      coffee: paint(COFFEE_TPL, COFFEE_PAL),
      heart: paint(HEART_TPL, { k: K_OUT, r: '#e3413a', R: '#ff9a8a' }),
      heartOff: paint(HEART_TPL, { k: K_OUT, r: '#2a2f3a', R: '#3a404d' }),
      bullet: paint(BULLET_TPL, { k: K_OUT, y: '#ffe27a', Y: '#fffbe0', o: '#d9a640', O: '#9c7426' }),
      bulletOff: paint(BULLET_TPL, { k: K_OUT, y: '#3a3f4b', Y: '#4a505d', o: '#2a2e38', O: '#20232b' }),
      puddle: paint(PUDDLE_TPL, { g: '#2c4a1c', G: '#3f6a26' }),
      pequi: paintPequi(), poste: paintPoste(), cupim: paintCupim(), toco: paintToco(),
      bg: paintBackground(), sky: paintSky(),
      lampLight: lightSprite(44, '255,204,124', 1, 0.55),
      aura: lightSprite(18, '214,210,196', 0.6, 0.28),
      itemGlow: lightSprite(10, '255,236,160', 0.75, 0.3),
      flash: lightSprite(22, '255,226,150', 1, 0.45),
      ambient: null
    };
    // luz ambiente: lua no alto, casa iluminando a varanda por baixo
    const amb = makeCanvas(VW, VH);
    const g = amb.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, FENCE_Y + 10);
    gr.addColorStop(0, 'rgb(170,178,215)');
    gr.addColorStop(SKY_H / (FENCE_Y + 10), 'rgb(104,114,160)');
    gr.addColorStop(1, 'rgb(40,48,84)');
    g.fillStyle = gr; g.fillRect(0, 0, VW, VH);
    g.globalCompositeOperation = 'lighter';
    const win = lightSprite(50, '255,184,108', 0.85, 0.35);
    g.drawImage(win, 120 - 50, VH + 8 - 50);
    g.drawImage(lightSprite(26, '255,184,108', 0.5, 0.2), 30 - 26, VH + 4 - 26);
    g.drawImage(lightSprite(26, '255,184,108', 0.5, 0.2), 214 - 26, VH + 4 - 26);
    ART.ambient = amb;
    return ART;
  }

  /* ------------------------------------------------------------------ */
  /* Estilos (injetados uma vez, com prefixo próprio)                    */
  /* ------------------------------------------------------------------ */

  const STYLE_ID = 'andrey-zumbis-estilo';
  let styleRefs = 0;
  const CSS = [
    // aspect-ratio só vale quando o pai não tem altura definida (height:100% vira auto)
    '.zmb{position:relative;display:block;width:100%;height:100%;min-height:240px;aspect-ratio:16/10;box-sizing:border-box;margin:0;padding:0;background:#05070c;color:#f4ead0;font-family:"VT323","Courier New",monospace;-webkit-user-select:none;user-select:none;overflow:hidden}',
    '.zmb *{box-sizing:border-box}',
    '.zmb .zmb-canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:block;margin:0;padding:0;border:0;outline:none;cursor:crosshair;touch-action:none;-webkit-tap-highlight-color:transparent}',
    '.zmb .zmb-canvas:focus-visible{outline:2px solid #ffd36e;outline-offset:-2px}',
    '.zmb .zmb-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}'
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

  function actionFor(key) {
    switch (key) {
      case 'ArrowUp': case 'Up': case 'w': case 'W': return 'up';
      case 'ArrowDown': case 'Down': case 's': case 'S': return 'down';
      case 'ArrowLeft': case 'Left': case 'a': case 'A': return 'left';
      case 'ArrowRight': case 'Right': case 'd': case 'D': return 'right';
      case ' ': case 'Spacebar': case 'Space': return 'fire';
      case 'r': case 'R': return 'reload';
      case 'p': case 'P': return 'pause';
      case 'Escape': case 'Esc': return 'esc';
      case 'Enter': return 'enter';
      default: return null;
    }
  }
  // teclado em outro desenho (AZERTY...): WASD pela posição física da tecla
  function actionForCode(code) {
    switch (code) {
      case 'KeyW': return 'up';
      case 'KeyA': return 'left';
      case 'KeyS': return 'down';
      case 'KeyD': return 'right';
      case 'KeyR': return 'reload';
      case 'KeyP': return 'pause';
      default: return null;
    }
  }
  const MOVE = { up: 1, down: 1, left: 1, right: 1 };

  /* ------------------------------------------------------------------ */
  /* create                                                              */
  /* ------------------------------------------------------------------ */

  function create(containerEl, opts) {
    if (!containerEl || !containerEl.appendChild) throw new Error('NOITE DOS ZUMBIS: informe o elemento onde o jogo vai morar.');
    opts = opts || {};
    const doc = global.document;
    const rand = typeof opts.random === 'function' ? opts.random : Math.random;
    const A = art();

    /* ---------- DOM ---------- */
    addStyle();
    const root = doc.createElement('div');
    root.className = 'zmb';
    const canvas = doc.createElement('canvas');
    canvas.className = 'zmb-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-roledescription', 'jogo');
    canvas.setAttribute('aria-label', 'NOITE DOS ZUMBIS. W A S D ou setas andam, o mouse mira, clique ou espaço atira, R recarrega, P pausa, Enter começa.');
    const sr = doc.createElement('div');
    sr.className = 'zmb-sr';
    sr.setAttribute('aria-live', 'polite');
    root.appendChild(canvas);
    root.appendChild(sr);
    containerEl.appendChild(root);

    const ctx = canvas.getContext('2d');
    if (!ctx) { root.parentNode.removeChild(root); removeStyle(); throw new Error('NOITE DOS ZUMBIS: este navegador não desenha em canvas 2D.'); }
    const buf = makeCanvas(VW, VH), b = buf.getContext('2d');      // o quintal em 256×160
    const lm = makeCanvas(VW, VH), lc = lm.getContext('2d');       // mapa de luz
    b.imageSmoothingEnabled = false;

    /* ---------- estado ---------- */
    let alive = true;
    let visible = true;
    let state = 'title';           // 'title' | 'playing' | 'over'
    let paused = false;
    let generation = 0;            // muda a cada partida/dispose: detecta reentrância pelo onEvent
    let score = 0, kills = 0, wave = 0, hearts = HEARTS;
    let mag = MAG, reserve = START_RESERVE, reloadT = 0, fireCd = 0, shotQueued = false;
    let best = loadRecord(), bestAtStart = best, recordEmitted = false, novoRecorde = false, recordDirty = false;
    let player = null;
    let zombies = [], bullets = [], pickups = [], decals = [], parts = [], floats = [];
    let queue = [], spawnT = 0, breakT = 0, waveTotal = 0, maxAlive = 6, speedScale = 1;
    let banner = null;             // { title, sub, color, t, life }
    let overT = 1, overAt = 0;
    let shakeT = 0, hurtFx = 0, muzzleT = 0, emptyT = 0, ammoHelpT = 0, lampT = 0, time = 0;
    let frozen = false;            // só para testes (_teste.congelar)
    let frames = 0;

    // entrada
    const held = { up: false, down: false, left: false, right: false };
    const pulse = { up: 0, down: 0, left: 0, right: 0 };
    let fireKey = false;
    const mouse = { x: VW / 2, y: VH / 2, inside: false, t: -1e9, down: false, id: null };
    let touchMode = !!(global.matchMedia && global.matchMedia('(pointer: coarse)').matches);
    const stick = { id: null, bx: 0, by: 0, kx: 0, ky: 0 };
    const fireTouch = { id: null };
    const touchBtn = new Map();    // pointerId -> 'reload' | 'pause'
    const dup = { key: null, src: null, t: -1, res: false };
    let aimMode = 'teclado';

    let raf = 0, lastT = null, rescaleT = 0;
    let L = null;                  // layout em px do dispositivo

    const mq = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let reduced = !!(mq && mq.matches);

    const BTN = {
      fire: { x: 226, y: 126, r: 19 },
      reload: { x: 191, y: 141, r: 10 },
      pause: { x: 244, y: 31, r: 9 }
    };

    /* ---------- jogador ---------- */
    function newPlayer() {
      return { x: 128, y: 114, face: -Math.PI / 2, aim: -Math.PI / 2, aimVis: -Math.PI / 2, moving: false, walkT: 0, invuln: 0 };
    }
    player = newPlayer();

    function pushOutObstacles(e, r) {
      for (let i = 0; i < OBST.length; i++) {
        const o = OBST[i];
        const dx = e.x - o.x, dy = e.y - o.y, m = o.r + r, d2 = dx * dx + dy * dy;
        if (d2 < m * m) {
          const d = Math.sqrt(d2) || 0.001;
          e.x = o.x + dx / d * m; e.y = o.y + dy / d * m;
        }
      }
    }

    function moveInput() {
      let mx = 0, my = 0;
      if (held.left || pulse.left > 0) mx -= 1;
      if (held.right || pulse.right > 0) mx += 1;
      if (held.up || pulse.up > 0) my -= 1;
      if (held.down || pulse.down > 0) my += 1;
      if (stick.id !== null) {
        const dx = (stick.kx - stick.bx) / 18, dy = (stick.ky - stick.by) / 18;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0.2) { mx += dx / Math.max(1, len); my += dy / Math.max(1, len); }
      }
      const len = Math.sqrt(mx * mx + my * my);
      if (len > 1) { mx /= len; my /= len; }
      return { x: mx, y: my, len: Math.min(1, len) };
    }

    function chestY(e) { return e.y - 7; }

    function nearestZombie(maxD, coneAng, coneHalf) {
      let bestZ = null, bd = maxD * maxD;
      for (let i = 0; i < zombies.length; i++) {
        const z = zombies[i];
        if (z.dying || z.emerge < 0.6) continue;
        const dx = z.x - player.x, dy = (z.y - 6) - chestY(player);
        const d2 = dx * dx + dy * dy;
        if (d2 >= bd) continue;
        if (coneHalf != null && Math.abs(angDiff(coneAng, Math.atan2(dy, dx))) > coneHalf) continue;
        bd = d2; bestZ = z;
      }
      return bestZ;
    }

    // Direção de referência da mira do toque: o joystick empurrado (fora da zona morta) ou a lanterna
    function touchAimRef() {
      if (stick.id !== null) {
        const dx = stick.kx - stick.bx, dy = stick.ky - stick.by;
        if (dx * dx + dy * dy > STICK_DEAD * STICK_DEAD) return Math.atan2(dy, dx);
      }
      return player.face;
    }
    // Para onde a arma aponta agora (mouse, toque ou teclado)
    function updateAim(moving) {
      const t = now();
      if (!touchMode && mouse.inside && (mouse.down || t - mouse.t < 3000 || !moving)) {
        aimMode = 'mouse';
        player.aim = Math.atan2(mouse.y - chestY(player), mouse.x - player.x);
      } else if (touchMode && (fireTouch.id !== null || stick.id !== null || shotQueued)) {
        aimMode = 'toque';
        // Ajuda de mira do toque só num cone de ±35° para onde o joystick empurra ou, com o
        // joystick parado, para onde a lanterna descansa (o lado em que a pessoa andou por
        // último). Parado com o dedo no tiro não vira mira automática para todo lado.
        const ref = touchAimRef();
        const z = nearestZombie(170, ref, TOUCH_CONE);
        player.aim = z ? Math.atan2((z.y - 6) - chestY(player), z.x - player.x) : ref;
      } else {
        aimMode = touchMode ? 'toque' : 'teclado';
        player.aim = player.face;
      }
    }

    /* ---------- tiro ---------- */
    function startReload() {
      if (state !== 'playing' || paused || reloadT > 0 || mag >= MAG || reserve <= 0) return false;
      reloadT = RELOAD_TIME;
      emit('reload', { pente: mag, reserva: reserve });
      return true;
    }
    function fireOnce() {
      if (reloadT > 0) return false;
      if (mag <= 0) {
        if (reserve > 0) { startReload(); return false; }
        if (emptyT <= 0) {
          emptyT = 0.9;
          addFloat(player.x, player.y - 18, 'SEM BALAS!', '#ff7a6a', 10);
          emit('empty', {});
        }
        return false;
      }
      let ang = player.aim;
      if (aimMode === 'teclado') {
        // ajudinha de mira para quem só tem teclado: o zumbi mais perto na frente
        const z = nearestZombie(150, player.face, 0.5);
        if (z) ang = Math.atan2((z.y - 6) - chestY(player), z.x - player.x);
      }
      ang += (rand() - 0.5) * 0.04;
      mag--;
      fireCd = FIRE_COOLDOWN;
      muzzleT = 0.06;
      const ox = player.x + Math.cos(ang) * 7, oy = chestY(player) + Math.sin(ang) * 7;
      bullets.push({ x: ox, y: oy, px: ox, py: oy, vx: Math.cos(ang) * BULLET_SPEED, vy: Math.sin(ang) * BULLET_SPEED, life: 1.4 });
      player.aimVis = ang;
      emit('shot', { pente: mag, reserva: reserve });
      if (mag === 0 && reserve > 0 && alive) startReload();
      return true;
    }

    /* ---------- zumbis ---------- */
    function spawnZombie(tipo, x, y, extra) {
      const def = ZT[tipo];
      let sx = x, sy = y, emerge = 1, from = 'teste';
      if (sx == null) {
        // escolhe uma saída longe do jogador: porteiras da cerca ou bordas escuras
        const opts2 = [];
        GAPS.forEach(function (gp) { const cx = (gp[0] + gp[1]) / 2; if (Math.abs(cx - player.x) > 30 || player.y > 80) opts2.push({ x: cx + (rand() - 0.5) * 14, y: FENCE_Y - 4, from: 'cerca' }); });
        if (player.x > 50) opts2.push({ x: -8, y: 46 + rand() * 92, from: 'esquerda' });
        if (player.x < VW - 50) opts2.push({ x: VW + 8, y: 46 + rand() * 92, from: 'direita' });
        const o = opts2[Math.floor(rand() * opts2.length)] || { x: -8, y: 90, from: 'esquerda' };
        sx = o.x; sy = o.y; from = o.from;
        emerge = from === 'cerca' ? 0 : 1;
      }
      const z = {
        tipo: tipo, x: sx, y: sy, hp: def.hp, r: def.r, kvx: 0, kvy: 0, slowT: 0, flash: 0,
        dir: 'down', walkT: rand(), phase: rand() * 6.28, emerge: emerge, dying: 0, extra: !!extra, from: from
      };
      zombies.push(z);
      return z;
    }

    function buildQueue(n) {
      const total = 5 + 3 * (n - 1);
      const brutes = n >= 5 ? Math.floor((n - 3) / 2) : 0;
      const runners = n >= 3 ? Math.round(total * Math.min(0.45, 0.22 + 0.06 * (n - 3))) : 0;
      // começa leve: os dois primeiros são zumbis comuns; o resto vem embaralhado
      const head = [], rest = [];
      for (let i = 0; i < total - runners - brutes; i++) (i < 2 ? head : rest).push('normal');
      for (let i = 0; i < runners; i++) rest.push('corredor');
      for (let i = 0; i < brutes; i++) rest.push('grandao');
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = rest[i]; rest[i] = rest[j]; rest[j] = t; }
      return head.concat(rest);
    }

    function beginWave(n) {
      wave = n;
      queue = buildQueue(n);
      waveTotal = queue.length;
      spawnT = n === 1 ? 1.6 : 1.0;
      breakT = 0;
      maxAlive = Math.min(22, 4 + 2 * n);
      speedScale = 1 + Math.min(0.35, 0.035 * (n - 1));
      showBanner('ONDA ' + n, n === 1 ? 'eles saem do escuro...' : (n === 3 ? 'cuidado: agora tem corredor' : n === 5 ? 'lá vem o grandão' : waveTotal + ' zumbis'), '#cfe9a8', 2.2);
      if (n >= 2) spawnPickup('municao');
      if (n >= 3 && hearts < HEARTS && n % 2 === 1) spawnPickup('cafe');
      announce('Onda ' + n + '.');
      emit('wave', { onda: n, zumbis: waveTotal });
    }

    function waveCleared() {
      const bonus = 25 * wave;
      score += bonus;
      checkRecord();
      flushRecord();
      showBanner('ONDA ' + wave + ' LIMPA!', 'bônus +' + bonus, '#ffd36e', 2.4);
      breakT = WAVE_BREAK;
    }

    /* ---------- coletáveis ---------- */
    function spawnPickup(tipo, x, y) {
      if (x == null) {
        for (let tries = 0; tries < 20; tries++) {
          x = 20 + rand() * (VW - 40); y = 46 + rand() * (PORCH_Y - 56);
          let ok = Math.hypot(x - player.x, y - player.y) > 34;
          for (let i = 0; i < OBST.length && ok; i++) if (Math.hypot(x - OBST[i].x, y - OBST[i].y) < OBST[i].r + 8) ok = false;
          if (ok) break;
        }
      }
      const p = { tipo: tipo, x: x, y: y, t: 0, life: PICKUP_LIFE };
      pickups.push(p);
      return p;
    }

    /* ---------- recado e efeitos ---------- */
    function showBanner(title, sub, color, life) { banner = { title: title, sub: sub || '', color: color || '#f4ead0', t: 0, life: life || 2 }; }
    function addFloat(x, y, text, color, size) { floats.push({ x: x, y: y, text: text, color: color, size: size || 9, t: 0, life: 0.95 }); if (floats.length > 14) floats.shift(); }
    function burst(x, y, n, colors, speed) {
      if (reduced) n = Math.ceil(n / 2);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, s = speed * (0.4 + Math.random() * 0.8);
        parts.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 10, t: 0, life: 0.3 + Math.random() * 0.25, c: colors[i % colors.length] });
      }
      if (parts.length > 90) parts.splice(0, parts.length - 90);
    }

    /* ---------- recorde ---------- */
    function checkRecord() {
      if (score <= best) return;
      best = score;
      recordDirty = true;
      // Comemora durante a partida só quando havia um recorde anterior a bater;
      // no primeiro jogo o aviso sai no fim de jogo.
      if (!recordEmitted && bestAtStart > 0) {
        recordEmitted = true;
        flushRecord();
        addFloat(player.x, player.y - 24, 'NOVO RECORDE!', '#ffd36e', 10);
        emit('record', { recorde: best, pontos: score, anterior: bestAtStart });
      }
    }
    function flushRecord() {
      if (!recordDirty) return;
      recordDirty = false;
      if (best > 0 && best >= loadRecord()) saveRecord(best);
    }

    /* ---------- partida ---------- */
    function resetRun() {
      score = 0; kills = 0; wave = 0; hearts = HEARTS;
      mag = MAG; reserve = START_RESERVE; reloadT = 0; fireCd = 0; shotQueued = false;
      player = newPlayer();
      zombies = []; bullets = []; pickups = []; decals = []; parts = []; floats = [];
      queue = []; spawnT = 0; breakT = 0; waveTotal = 0; banner = null;
      shakeT = 0; hurtFx = 0; muzzleT = 0; emptyT = 0; ammoHelpT = 0; overT = 1; time = 0;
    }
    function startGame() {
      flushRecord();
      generation++;
      resetRun();
      best = Math.max(best, loadRecord());
      bestAtStart = best; recordEmitted = false; novoRecorde = false; recordDirty = false;
      state = 'playing';
      paused = false;
      releaseAll();
      maybeRescale();
      announce('Partida começou.');
      const gen = generation;
      emit('start', { recorde: best });
      if (gen !== generation || !alive) return;
      beginWave(1);
      if (gen !== generation || !alive) return;
      // Começou com o jogo escondido: já nasce pausado, senão isRunning() diria
      // true sem laço nenhum rodando.
      if (!visible || doc.hidden) { pauseGame(!visible ? 'oculto' : 'aba'); return; }
      if (state !== 'playing' || paused) { draw(); return; }
      draw();
      kick();
    }
    function pauseGame(motivo) {
      if (state !== 'playing' || paused) return false;
      paused = true;
      releaseAll();
      stop();
      flushRecord();
      announce('Pausado.');
      emit('pause', { motivo: motivo || 'jogador' });
      if (alive) draw();
      return true;
    }
    function resumeGame() {
      if (state !== 'playing' || !paused) return false;
      if (!visible || doc.hidden) return false;
      paused = false;
      maybeRescale();
      announce('Continuando.');
      emit('resume', {});
      if (!alive || state !== 'playing' || paused) return true;
      draw();
      kick();
      return true;
    }
    function gameOver() {
      state = 'over';
      paused = false;
      releaseAll();
      bullets = []; banner = null;
      overT = reduced ? 1 : 0;
      overAt = now();
      novoRecorde = score > bestAtStart;
      if (score > best) { best = score; recordDirty = true; }
      flushRecord();
      announce('Fim de jogo. ' + score + ' pontos, onda ' + wave + '.' + (novoRecorde ? ' Novo recorde!' : ''));
      // Copia tudo antes de avisar: o onEvent pode recomeçar (start) ou descartar o jogo.
      const gen = generation;
      const fim = { pontos: score, onda: wave, abates: kills, recorde: best, novoRecorde: novoRecorde };
      const rec = novoRecorde && !recordEmitted ? { recorde: best, pontos: score, anterior: bestAtStart } : null;
      if (rec) recordEmitted = true;
      emit('gameover', fim);
      if (rec && alive && gen === generation) emit('record', rec);
      if (gen !== generation || !alive) return;
      draw();
      kick();
    }
    function overReady() { return state === 'over' && now() - overAt > OVER_GUARD_MS; }

    /* ---------- entrada ---------- */
    function releaseAll() {
      held.up = held.down = held.left = held.right = false;
      pulse.up = pulse.down = pulse.left = pulse.right = 0;
      fireKey = false; shotQueued = false;
      mouse.down = false; mouse.id = null;
      stick.id = null; fireTouch.id = null; touchBtn.clear();
    }
    function togglePause() {
      if (state !== 'playing') return false;
      if (paused) resumeGame(); else pauseGame('jogador');
      return true;
    }

    // mode: 'tap' (um passo curto) | 'hold' (segura até soltar)
    function doAction(a, mode) {
      if (a === 'enter' || (a === 'fire' && state !== 'playing')) {
        if (state === 'title' || overReady()) { startGame(); return true; }
        if (state === 'playing' && paused && a === 'enter') return resumeGame();
        return false;
      }
      if (a === 'pause') return togglePause();
      if (a === 'esc') {
        // pausa; já pausado, Esc segue para o desktop (fecha a janela)
        if (state === 'playing' && !paused) { pauseGame('jogador'); return true; }
        return false;
      }
      if (state !== 'playing' || paused) return false;
      if (MOVE[a]) {
        if (mode === 'hold') held[a] = true; else pulse[a] = TAP_MOVE;
        return true;
      }
      if (a === 'fire') {
        if (mode === 'hold') { if (!fireKey) { fireKey = true; shotQueued = true; } }
        else shotQueued = true;
        return true;
      }
      if (a === 'reload') { startReload(); return true; }
      return false;
    }
    function release(a) {
      if (MOVE[a]) held[a] = false;
      else if (a === 'fire') fireKey = false;
    }
    function gameKeyLive(a) { return state === 'playing' && !paused && a !== 'enter' && a !== 'esc'; }

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
      if (alive && !raf) draw();
      return used;
    }
    function onKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const a = actionFor(e.key) || actionForCode(e.code);
      if (!a) return;
      let used;
      if (isDuplicate(e.key, 'dom')) used = dup.res;
      else if (e.repeat) {
        used = gameKeyLive(a) || (a === 'pause' && state === 'playing');   // segurar já conta
        // A repetição também vale como "segurando": a tecla pode ter descido fora do canvas
        // (o 1º keydown veio pelo desktop, como um toque curto) ou atravessado uma pausa,
        // que solta tudo. Sem isso o jogador anda um passo e para com a tecla apertada.
        if (gameKeyLive(a)) {
          if (MOVE[a]) held[a] = true;
          else if (a === 'fire' && !fireKey) { fireKey = true; shotQueued = true; }
        }
      }
      else used = doAction(a, 'hold');
      dup.res = used;
      if (used) { e.preventDefault(); e.stopPropagation(); }
      if (alive && !raf) draw();
    }
    function onKeyUp(e) {
      const a = actionFor(e.key) || actionForCode(e.code);
      if (!a) return;
      release(a);
      if (gameKeyLive(a)) e.stopPropagation();
    }
    function onFocusOut(e) {
      if (!e.relatedTarget || !root.contains(e.relatedTarget)) {
        held.up = held.down = held.left = held.right = false;
        fireKey = false; mouse.down = false;
      }
    }
    function focusCanvas() {
      try { canvas.focus({ preventScroll: true }); } catch (err) { canvas.focus(); }
    }

    /* ---------- ponteiro ---------- */
    // Coordenadas locais do canvas por offsetX/offsetY: o navegador já desfaz o
    // matrix3d (perspectiva e giro). Depois: px do canvas -> px do jogo.
    function toGame(e) {
      if (!L) return null;
      const cw = canvas.clientWidth || 1, ch = canvas.clientHeight || 1;
      const dx = e.offsetX * canvas.width / cw, dy = e.offsetY * canvas.height / ch;
      if (!isFinite(dx) || !isFinite(dy)) return null;
      return { x: (dx - L.ox) / L.K, y: (dy - L.oy) / L.K };
    }
    function inCircle(p, c, extra) { const dx = p.x - c.x, dy = p.y - c.y, r = c.r + (extra || 0); return dx * dx + dy * dy <= r * r; }

    function onPointerDown(e) {
      const p = toGame(e);
      const isTouch = e.pointerType === 'touch';
      if (isTouch) touchMode = true;
      else if (e.pointerType === 'mouse') {
        if (touchMode) touchMode = false;
        if (p) { mouse.x = p.x; mouse.y = p.y; mouse.inside = true; mouse.t = now(); }
        if (e.button !== 0 && e.button !== 2) return;
      }
      focusCanvas();
      if (state === 'title' || overReady()) { e.preventDefault(); startGame(); return; }
      if (state !== 'playing') return;
      if (paused) { e.preventDefault(); resumeGame(); return; }
      e.preventDefault();
      if (!p) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* sem captura: segue */ }
      if (isTouch) {
        if (inCircle(p, BTN.pause, 3)) { touchBtn.set(e.pointerId, 'pause'); pauseGame('jogador'); return; }
        if (inCircle(p, BTN.reload, 3)) { touchBtn.set(e.pointerId, 'reload'); startReload(); return; }
        if (p.x < VW / 2) {
          if (stick.id === null) {
            stick.id = e.pointerId;
            stick.bx = clamp(p.x, 22, VW / 2 - 22); stick.by = clamp(p.y, 50, VH - 22);
            stick.kx = p.x; stick.ky = p.y;
            clampStick();
          }
        } else if (fireTouch.id === null) {
          fireTouch.id = e.pointerId;
          shotQueued = true;
        }
      } else if (e.button === 2) {
        startReload();
      } else {
        mouse.down = true; mouse.id = e.pointerId;
        shotQueued = true;
      }
      if (!raf) draw();
    }
    function clampStick() {
      const dx = stick.kx - stick.bx, dy = stick.ky - stick.by, d = Math.sqrt(dx * dx + dy * dy);
      if (d > 18) { stick.kx = stick.bx + dx / d * 18; stick.ky = stick.by + dy / d * 18; }
    }
    function onPointerMove(e) {
      const p = toGame(e);
      if (!p) return;
      if (e.pointerType === 'touch') {
        if (e.pointerId === stick.id) { stick.kx = p.x; stick.ky = p.y; clampStick(); }
        else if (stick.id === null && p.x < VW / 2 && state === 'playing' && !paused &&
          e.pointerId !== fireTouch.id && !touchBtn.has(e.pointerId) && (e.buttons === undefined || (e.buttons & 1))) {
          // A pausa solta o joystick (releaseAll); o dedo que continuou na tela do lado
          // esquerdo volta a ser o joystick, com a base onde ele está agora.
          stick.id = e.pointerId;
          stick.bx = clamp(p.x, 22, VW / 2 - 22); stick.by = clamp(p.y, 50, VH - 22);
          stick.kx = p.x; stick.ky = p.y;
          clampStick();
          try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* sem captura: segue */ }
        }
        return;
      }
      if (e.pointerType === 'mouse' && touchMode) return;
      mouse.x = p.x; mouse.y = p.y; mouse.inside = true; mouse.t = now();
    }
    function onPointerUp(e) {
      if (e.pointerId === stick.id) stick.id = null;
      if (e.pointerId === fireTouch.id) fireTouch.id = null;
      if (e.pointerId === mouse.id) { mouse.down = false; mouse.id = null; }
      touchBtn.delete(e.pointerId);
    }
    function onPointerLeave(e) {
      if (e.pointerType === 'mouse' && !mouse.down) { mouse.inside = false; if (!raf) draw(); }
    }
    function onContextMenu(e) { e.preventDefault(); }

    /* ---------- laço ---------- */
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
      if (!alive) return;
      rescaleT += dt;
      if (rescaleT > 0.5) { rescaleT = 0; maybeRescale(); }
      draw();
      // update() pode ter agendado um quadro (fim de jogo): não duplicar o laço
      if (!raf && needsFrames()) raf = global.requestAnimationFrame(frame);
      else if (!raf) lastT = null;
    }

    function update(dt) {
      // efeitos que correm até no fim de jogo
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i];
        q.t += dt;
        if (q.t >= q.life) { parts.splice(i, 1); continue; }
        q.vy += 60 * dt; q.x += q.vx * dt; q.y += q.vy * dt;
      }
      for (let i = floats.length - 1; i >= 0; i--) { floats[i].t += dt; if (floats[i].t >= floats[i].life) floats.splice(i, 1); }
      for (let i = decals.length - 1; i >= 0; i--) { decals[i].t += dt; if (decals[i].t > 9) decals.splice(i, 1); }
      if (state === 'over') { if (overT < 1) overT = Math.min(1, overT + dt / OVER_ANIM); return; }
      if (state !== 'playing' || paused) return;
      const gen = generation;
      function stale() { return !alive || gen !== generation || paused || state !== 'playing'; }

      time += dt;
      lampT += dt;
      if (banner) { banner.t += dt; if (banner.t >= banner.life) banner = null; }
      shakeT = Math.max(0, shakeT - dt);
      hurtFx = Math.max(0, hurtFx - dt);
      muzzleT = Math.max(0, muzzleT - dt);
      emptyT = Math.max(0, emptyT - dt);
      fireCd = Math.max(0, fireCd - dt);
      ['up', 'down', 'left', 'right'].forEach(function (k) { pulse[k] = Math.max(0, pulse[k] - dt); });

      // jogador
      const mv = moveInput();
      player.moving = mv.len > 0.05;
      if (player.moving) {
        player.x += mv.x * PLAYER_SPEED * dt;
        player.y += mv.y * PLAYER_SPEED * dt;
        player.face = Math.atan2(mv.y, mv.x);
        player.walkT += dt * (4 + 4 * mv.len);
        pushOutObstacles(player, PLAYER_R);
        player.x = clamp(player.x, BOUNDS.x0, BOUNDS.x1);
        player.y = clamp(player.y, BOUNDS.y0, BOUNDS.y1);
      }
      player.invuln = Math.max(0, player.invuln - dt);
      updateAim(player.moving);
      // a lanterna gira rápido, mas sem saltar
      player.aimVis += angDiff(player.aimVis, player.aim) * Math.min(1, dt * 22);

      // recarga
      if (reloadT > 0) {
        reloadT -= dt;
        if (reloadT <= 0) {
          reloadT = 0;
          const take = Math.min(MAG - mag, reserve);
          mag += take; reserve -= take;
        }
      }
      // gatilho (um toque durante o intervalo entre tiros fica guardado para o próximo)
      const wantFire = shotQueued || fireKey || mouse.down || fireTouch.id !== null;
      if (wantFire && fireCd <= 0) {
        shotQueued = false;
        fireOnce();
        if (stale()) return;
      }

      // balas
      for (let i = bullets.length - 1; i >= 0; i--) {
        const bl = bullets[i];
        bl.px = bl.x; bl.py = bl.y;
        const nx = bl.x + bl.vx * dt, ny = bl.y + bl.vy * dt;
        bl.life -= dt;
        // primeiro obstáculo ou zumbi no caminho do segmento
        let hitT = 2, hitZ = null, hitO = null;
        const sx = nx - bl.x, sy = ny - bl.y, sl2 = sx * sx + sy * sy || 1e-6;
        for (let j = 0; j < OBST.length; j++) {
          const o = OBST[j];
          const oy = o.y - (o.kind === 'poste' ? 6 : o.kind === 'cupim' ? 5 : 3);
          const t = clamp(((o.x - bl.x) * sx + (oy - bl.y) * sy) / sl2, 0, 1);
          const cx = bl.x + sx * t - o.x, cy = bl.y + sy * t - oy;
          const rr = o.kind === 'cupim' ? 6 : o.kind === 'pequi' ? 3 : o.r;
          if (cx * cx + cy * cy < rr * rr && t < hitT) { hitT = t; hitO = o; }
        }
        for (let j = 0; j < zombies.length; j++) {
          const z = zombies[j];
          if (z.dying || z.emerge < 0.35) continue;
          const zy = z.y - (z.tipo === 'grandao' ? 8 : 6);
          const t = clamp(((z.x - bl.x) * sx + (zy - bl.y) * sy) / sl2, 0, 1);
          const cx = bl.x + sx * t - z.x, cy = bl.y + sy * t - zy, rr = ZT[z.tipo].hitR;
          if (cx * cx + cy * cy < rr * rr && t < hitT) { hitT = t; hitZ = z; hitO = null; }
        }
        if (hitZ) {
          const ix = bl.x + sx * hitT, iy = bl.y + sy * hitT;
          bullets.splice(i, 1);
          damageZombie(hitZ, bl.vx / BULLET_SPEED, bl.vy / BULLET_SPEED, ix, iy);
          if (stale()) return;
          continue;
        }
        if (hitO) {
          burst(bl.x + sx * hitT, bl.y + sy * hitT, 4, ['#9a7650', '#6b4b30', '#c4a274'], 30);
          bullets.splice(i, 1);
          continue;
        }
        bl.x = nx; bl.y = ny;
        if (bl.life <= 0 || bl.x < -12 || bl.x > VW + 12 || bl.y < -12 || bl.y > VH + 12) bullets.splice(i, 1);
      }

      // zumbis
      let aliveCount = 0;
      for (let i = zombies.length - 1; i >= 0; i--) {
        const z = zombies[i];
        if (z.dying) {
          z.dying += dt;
          if (z.dying > 0.55) {
            decals.push({ x: z.x, y: z.y, t: 0, big: z.tipo === 'grandao' });
            if (decals.length > 36) decals.shift();
            zombies.splice(i, 1);
          }
          continue;
        }
        aliveCount++;
        z.flash = Math.max(0, z.flash - dt);
        z.slowT = Math.max(0, z.slowT - dt);
        if (frozen) {
          if (z.emerge >= 1 && bites(z)) { hurtPlayer(z); if (stale()) return; }
          continue;
        }
        const def = ZT[z.tipo];
        if (z.emerge < 1) {
          // pula a cerca saindo do escuro
          z.emerge = Math.min(1, z.emerge + dt / 0.7);
          z.y += 9 * dt;
          z.dir = 'down';
          z.walkT += dt * 3;
          continue;
        }
        let dx = player.x - z.x, dy = player.y - z.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
        dx /= d; dy /= d;
        // zumbi comum cambaleia de lado
        if (z.tipo === 'normal') { const sw = Math.sin(time * 2.6 + z.phase) * 0.45; const tx = -dy * sw, ty = dx * sw; dx += tx; dy += ty; }
        // desvia de obstáculo que está na frente
        for (let j = 0; j < OBST.length; j++) {
          const o = OBST[j];
          const ox = o.x - z.x, oy = o.y - z.y, od = Math.sqrt(ox * ox + oy * oy) || 0.001;
          if (od < o.r + z.r + 9 && (ox * dx + oy * dy) / od > 0.25) {
            const side = (dx * oy - dy * ox) > 0 ? 1 : -1;
            dx += (oy / od) * side * 0.9; dy += (-ox / od) * side * 0.9;
          }
        }
        // não amontoa
        for (let j = 0; j < zombies.length; j++) {
          const o = zombies[j];
          if (o === z || o.dying) continue;
          const sx2 = z.x - o.x, sy2 = z.y - o.y, m = z.r + o.r;
          const d2 = sx2 * sx2 + sy2 * sy2;
          if (d2 < m * m && d2 > 0.0001) { const dd = Math.sqrt(d2); dx += sx2 / dd * 0.8; dy += sy2 / dd * 0.8; }
        }
        const dl = Math.sqrt(dx * dx + dy * dy) || 1;
        dx /= dl; dy /= dl;
        const sp = def.speed * speedScale * (z.slowT > 0 ? 0.35 : 1);
        z.x += (dx * sp + z.kvx) * dt;
        z.y += (dy * sp + z.kvy) * dt;
        const dec = Math.exp(-11 * dt);
        z.kvx *= dec; z.kvy *= dec;
        pushOutObstacles(z, z.r * 0.8);
        z.y = clamp(z.y, FENCE_Y - 4, BOUNDS.y1);
        z.x = clamp(z.x, -14, VW + 14);
        z.walkT += dt * (z.tipo === 'corredor' ? 9 : 5);
        z.dir = Math.abs(dx) > Math.abs(dy) * 1.1 ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        if (bites(z)) { hurtPlayer(z); if (stale()) return; }
      }

      // coletáveis
      for (let i = pickups.length - 1; i >= 0; i--) {
        const p = pickups[i];
        p.t += dt;
        if (p.t >= p.life) { pickups.splice(i, 1); continue; }
        if (Math.hypot(p.x - player.x, (p.y - 3) - (player.y - 4)) < 10) {
          pickups.splice(i, 1);
          collect(p);
          if (stale()) return;
        }
      }
      // munição acabando e nenhuma caixa no chão: cai uma perto da varanda
      if (mag + reserve <= 2 && reloadT <= 0 && !pickups.some(function (p) { return p.tipo === 'municao'; })) {
        ammoHelpT += dt;
        if (ammoHelpT > 1.4) { ammoHelpT = 0; spawnPickup('municao'); addFloat(128, 60, 'CAIXA DE MUNIÇÃO!', '#ffe27a', 10); }
      } else ammoHelpT = 0;

      // ondas
      if (breakT > 0) {
        breakT -= dt;
        if (breakT <= 0) { beginWave(wave + 1); if (stale()) return; }
      } else if (!frozen) {
        spawnT -= dt;
        if (spawnT <= 0 && queue.length && aliveCount < maxAlive) {
          spawnZombie(queue.shift());
          spawnT = Math.max(0.5, 1.7 - 0.12 * wave) * (0.75 + rand() * 0.5);
        }
        if (!queue.length && aliveCount === 0 && !zombies.length && wave > 0) waveCleared();
      }
    }

    function bites(z) {
      const px2 = player.x - z.x, py2 = player.y - z.y, mr = z.r + PLAYER_R - 0.5;
      return player.invuln <= 0 && px2 * px2 + py2 * py2 < mr * mr;
    }

    function damageZombie(z, nx, ny, ix, iy) {
      const def = ZT[z.tipo];
      z.hp--;
      z.flash = 0.08;
      z.slowT = 0.25;
      z.kvx += nx * def.knock; z.kvy += ny * def.knock;
      burst(ix, iy, 3, ['#4f8a2c', '#86b450', '#2c4a1c'], 34);
      if (z.hp > 0) return;
      z.dying = 0.0001;
      z.flash = 0;
      kills++;
      score += def.pts;
      addFloat(z.x, z.y - 16, '+' + def.pts, '#e8f5c8', 9);
      burst(z.x, z.y - 6, 8, ['#4f8a2c', '#86b450', '#2c4a1c', '#3f6a26'], 46);
      // às vezes deixa cair alguma coisa
      const r = rand();
      const ammoChance = 0.15 + (reserve < 8 ? 0.15 : 0);
      if (r < ammoChance) spawnPickup('municao', clamp(z.x, 12, VW - 12), clamp(z.y, 44, PORCH_Y - 4));
      else if (hearts < HEARTS && r < ammoChance + 0.06) spawnPickup('cafe', clamp(z.x, 12, VW - 12), clamp(z.y, 44, PORCH_Y - 4));
      const gen = generation;
      emit('hit', { tipo: z.tipo, pontos: def.pts, total: score, abates: kills });
      // o recorde batido sai depois do 'hit' que bateu (se a partida ainda for a mesma)
      if (alive && gen === generation) checkRecord();
    }

    function hurtPlayer(z) {
      hearts = Math.max(0, hearts - 1);
      player.invuln = INVULN;
      shakeT = reduced ? 0 : 0.28;
      hurtFx = 0.6;
      // empurrão: abre espaço para fugir
      zombies.forEach(function (o) {
        if (o.dying) return;
        const dx = o.x - player.x, dy = o.y - player.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d < 26) { o.kvx += dx / d * 150; o.kvy += dy / d * 150; o.slowT = 0.5; }
      });
      announce(hearts > 0 ? 'Mordida! ' + hearts + (hearts === 1 ? ' coração.' : ' corações.') : 'Mordida!');
      const gen = generation;
      emit('hurt', { vidas: hearts });
      if (gen !== generation || !alive) return;
      if (hearts <= 0 && state === 'playing') gameOver();
    }

    function collect(p) {
      if (p.tipo === 'municao') {
        reserve += AMMO_BOX;
        addFloat(p.x, p.y - 10, 'MUNIÇÃO +' + AMMO_BOX, '#ffe27a', 9);
      } else if (hearts < HEARTS) {
        hearts++;
        addFloat(p.x, p.y - 10, 'CAFEZINHO! +1 VIDA', '#ffb59a', 9);
      } else {
        score += 25;
        addFloat(p.x, p.y - 10, 'CAFEZINHO +25', '#ffb59a', 9);
        checkRecord();
      }
      emit('pickup', { tipo: p.tipo, vidas: hearts, reserva: reserve, total: score });
      if (mag === 0 && reserve > 0 && reloadT <= 0) startReload();
    }

    function announce(t) { sr.textContent = t; }
    function emit(kind, detail) {
      if (typeof opts.onEvent !== 'function') return;
      try { opts.onEvent(kind, detail); } catch (err) { if (global.console) global.console.warn('[ZUMBIS] onEvent falhou:', err); }
    }

    /* ---------- tamanho e nitidez ---------- */
    function backingRatio() {
      const dpr = global.devicePixelRatio || 1;
      let proj = 1;
      // Dentro do matrix3d o canvas aparece ampliado ou reduzido; a área do retângulo
      // na tela dá a escala real (vale também com o giro de 90° do celular).
      try {
        const r = root.getBoundingClientRect();
        const ow = root.offsetWidth, oh = root.offsetHeight;
        if (ow > 0 && oh > 0 && r.width > 0 && r.height > 0 && isFinite(r.width)) proj = Math.sqrt((r.width * r.height) / (ow * oh));
      } catch (err) { proj = 1; }
      proj = clamp(proj, 0.5, 2.5);
      return clamp(dpr * proj, 1, 3);
    }
    function relayout() {
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (!cw || !ch) { L = null; return; }
      const Sraw = backingRatio();
      let S = Sraw;
      if (cw * ch * S * S > MAX_BACKING_PX) S = Math.max(1, Math.sqrt(MAX_BACKING_PX / (cw * ch)));
      const W = Math.max(1, Math.round(cw * S)), H = Math.max(1, Math.round(ch * S));
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;
      // fator inteiro para cada pixel do jogo virar um quadrado igual (nítido)
      let K = Math.floor(Math.min(W / VW, H / VH));
      if (K < 1) K = Math.min(W / VW, H / VH);
      const gw = Math.round(VW * K), gh = Math.round(VH * K);
      L = { S: S, Sraw: Sraw, W: W, H: H, K: K, gw: gw, gh: gh, ox: Math.floor((W - gw) / 2), oy: Math.floor((H - gh) / 2) };
      ctx.imageSmoothingEnabled = false;
    }
    function maybeRescale() {
      if (!L) { relayout(); return; }
      const S = backingRatio();
      if (Math.abs(S - L.Sraw) / L.Sraw > 0.12) relayout();
    }

    /* ---------- desenho do quintal (256×160) ---------- */
    function walkFrame(moving, walkT) { return moving ? (Math.floor(walkT) % 2 === 0 ? 1 : 2) : 0; }

    function drawWorld(demo) {
      const sx = shakeT > 0 && !reduced ? Math.round(Math.sin(time * 90) * 1.4) : 0;
      const sy = shakeT > 0 && !reduced ? Math.round(Math.cos(time * 77) * 1.2) : 0;
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.globalCompositeOperation = 'source-over';
      b.globalAlpha = 1;
      b.fillStyle = '#05070c'; b.fillRect(0, 0, VW, VH);
      b.setTransform(1, 0, 0, 1, sx, sy);
      b.drawImage(A.bg, 0, 0);

      const zs = demo ? demo.zombies : zombies;
      const pl = demo ? demo.player : player;

      // poças verdes dos zumbis que caíram
      decals.forEach(function (d) {
        b.globalAlpha = d.t > 6 ? Math.max(0, 1 - (d.t - 6) / 3) : 1;
        b.drawImage(A.puddle, Math.round(d.x - 4), Math.round(d.y - 2));
        if (d.big) b.drawImage(A.puddle, Math.round(d.x - 1), Math.round(d.y - 1));
      });
      b.globalAlpha = 1;

      // tudo que tem pé, em ordem de profundidade
      const items = [];
      OBST.forEach(function (o) { items.push({ y: o.y, k: 'o', o: o }); });
      pickups.forEach(function (p) { if (!demo) items.push({ y: p.y, k: 'p', o: p }); });
      zs.forEach(function (z) { items.push({ y: z.y, k: 'z', o: z }); });
      items.push({ y: pl.y + 0.1, k: 'j', o: pl });
      items.sort(function (a, c) { return a.y - c.y; });
      items.forEach(function (it) {
        if (it.k === 'o') drawObstacle(it.o, pl);
        else if (it.k === 'p') drawPickup(it.o);
        else if (it.k === 'z') drawZombie(it.o);
        else drawPlayer(it.o, !!demo);
      });
      b.globalAlpha = 1;
      parts.forEach(function (q) { b.fillStyle = q.c; b.fillRect(Math.round(q.x), Math.round(q.y), 1, 1); });

      // luz: mapa multiplicado por cima de tudo
      buildLight(pl, demo, sx, sy);
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.globalCompositeOperation = 'multiply';
      b.drawImage(lm, 0, 0);
      b.globalCompositeOperation = 'source-over';

      // o que brilha no escuro
      b.drawImage(A.sky, 0, 0);
      b.setTransform(1, 0, 0, 1, sx, sy);
      const flick = lampFlicker();
      b.fillStyle = 'rgba(255,240,170,' + (0.75 + 0.25 * flick) + ')';
      b.fillRect(OBST[1].x + 2, OBST[1].y - 26, 2, 1);
      zs.forEach(function (z) { drawZombieGlow(z); });
      pickups.forEach(function (p) {
        if (demo || !pickupVisible(p)) return;
        const tw = reduced ? 0 : Math.floor(time * 3 + p.x) % 4;
        b.fillStyle = '#fffbe0';
        b.fillRect(Math.round(p.x) + (tw === 0 ? -3 : 2), Math.round(p.y) - 8, 1, 1);
      });
      bullets.forEach(function (bl) {
        const x = Math.round(bl.x), y = Math.round(bl.y);
        const tx = Math.round(bl.x - bl.vx / BULLET_SPEED * 3), ty = Math.round(bl.y - bl.vy / BULLET_SPEED * 3);
        b.fillStyle = '#ffcf5a'; b.fillRect(tx, ty, 1, 1);
        b.fillStyle = '#ffe9a0'; b.fillRect(Math.round((x + tx) / 2), Math.round((y + ty) / 2), 1, 1);
        b.fillStyle = '#fffbe8'; b.fillRect(x, y, 2, 2);
      });
      if (!demo) {
        // ponta da lanterna e clarão do tiro
        const tip = gunTip(pl);
        b.fillStyle = '#fff6c8'; b.fillRect(tip.x, tip.y, 1, 1);
        if (muzzleT > 0 && !reduced) {
          b.fillStyle = '#fff6c8';
          b.fillRect(tip.x - 1, tip.y, 3, 1); b.fillRect(tip.x, tip.y - 1, 1, 3);
        }
        // barra de recarga em cima da cabeça
        if (reloadT > 0) {
          const bx = Math.round(pl.x - 7), by = Math.round(pl.y - 19);
          b.fillStyle = K_OUT; b.fillRect(bx - 1, by - 1, 16, 4);
          b.fillStyle = '#2a2f3a'; b.fillRect(bx, by, 14, 2);
          b.fillStyle = '#ffd36e'; b.fillRect(bx, by, Math.round(14 * (1 - reloadT / RELOAD_TIME)), 2);
        }
      }
      b.setTransform(1, 0, 0, 1, 0, 0);
    }

    function lampFlicker() {
      if (reduced) return 1;
      const t = lampT;
      // respira devagar e às vezes dá uma piscadinha fraca (nunca um clarão)
      const dip = (Math.sin(t * 0.7) > 0.985) ? 0.25 : 0;
      return 0.9 + Math.sin(t * 2.1) * 0.05 + Math.sin(t * 5.3) * 0.03 - dip;
    }

    function buildLight(pl, demo, sx, sy) {
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.globalCompositeOperation = 'source-over';
      lc.globalAlpha = 1;
      lc.drawImage(A.ambient, 0, 0);
      lc.globalCompositeOperation = 'lighter';
      lc.setTransform(1, 0, 0, 1, sx, sy);
      lc.globalAlpha = lampFlicker();
      lc.drawImage(A.lampLight, LAMP.x - 44, LAMP.y - 44);
      lc.globalAlpha = 1;
      lc.drawImage(A.aura, Math.round(pl.x) - 18, Math.round(pl.y - 6) - 18);
      // cone da lanterna
      const ang = pl.aimVis, cx = pl.x + Math.cos(ang) * 3, cy = pl.y - 7 + Math.sin(ang) * 2;
      coneLight(cx, cy, ang, 0.64, 92, 'rgba(255,240,205,', 0.32);
      coneLight(cx, cy, ang, 0.42, 118, 'rgba(255,246,218,', 0.95);
      if (!demo) {
        if (muzzleT > 0) {
          const tip = gunTip(pl);
          lc.globalAlpha = reduced ? 0.35 : 0.85;
          lc.drawImage(A.flash, tip.x - 22, tip.y - 22);
          lc.globalAlpha = 1;
        }
        pickups.forEach(function (p) { if (pickupVisible(p)) lc.drawImage(A.itemGlow, Math.round(p.x) - 10, Math.round(p.y - 3) - 10); });
      }
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.globalCompositeOperation = 'source-over';
    }
    function coneLight(cx, cy, ang, half, R, rgba, a) {
      const gr = lc.createRadialGradient(cx, cy, 2, cx, cy, R);
      gr.addColorStop(0, rgba + a + ')');
      gr.addColorStop(0.6, rgba + (a * 0.6) + ')');
      gr.addColorStop(1, rgba + '0)');
      lc.fillStyle = gr;
      lc.beginPath();
      lc.moveTo(cx, cy);
      lc.arc(cx, cy, R, ang - half, ang + half);
      lc.closePath();
      lc.fill();
    }

    function gunTip(pl) {
      const a = pl.aimVis;
      return { x: Math.round(pl.x + Math.cos(a) * 7), y: Math.round(pl.y - 7 + Math.sin(a) * 6) };
    }
    function dirOf(a) {
      const deg = a * 180 / Math.PI;
      if (deg > -45 && deg <= 45) return 'right';
      if (deg > 45 && deg <= 135) return 'down';
      if (deg > -135 && deg <= -45) return 'up';
      return 'left';
    }
    function drawGun(pl) {
      const a = pl.aimVis, hx = pl.x, hy = pl.y - 7;
      for (let i = 2; i <= 6; i++) {
        const x = Math.round(hx + Math.cos(a) * i), y = Math.round(hy + Math.sin(a) * i * 0.86);
        b.fillStyle = i >= 5 ? '#9aa3b2' : '#2b2f38';
        b.fillRect(x, y, 1, 1);
        if (i <= 4) { b.fillStyle = K_OUT; b.fillRect(x, y + 1, 1, 1); }
      }
    }
    function drawPlayer(pl, demo) {
      const dir = dirOf(pl.aimVis);
      const set = A.player;
      const fi = walkFrame(pl.moving, pl.walkT);
      const spr = set[dir][fi];
      const x = Math.round(pl.x - spr.width / 2), y = Math.round(pl.y - spr.height + 1);
      // sombra no chão
      b.fillStyle = 'rgba(0,0,0,0.35)'; b.fillRect(x + 2, Math.round(pl.y), spr.width - 4, 1);
      let alpha = 1;
      if (!demo && pl.invuln > 0) alpha = reduced ? 0.6 : (Math.floor(pl.invuln * 5) % 2 ? 0.35 : 1);  // 2,5 piscadas por segundo
      b.globalAlpha = alpha;
      if (dir === 'up') drawGun(pl);
      b.drawImage(spr, x, y);
      if (dir !== 'up') drawGun(pl);
      b.globalAlpha = 1;
    }
    function zombieFrame(z) {
      const set = A[z.tipo];
      const fi = z.emerge < 1 ? 0 : (Math.floor(z.walkT) % 2 ? 1 : 2);
      return { set: set, spr: set[z.dir][fi], white: set.white[z.dir][fi] };
    }
    function zombiePos(z, spr) {
      const bob = z.tipo === 'grandao' && !reduced && z.emerge >= 1 ? (Math.floor(z.walkT) % 2) : 0;
      return { x: Math.round(z.x - spr.width / 2), y: Math.round(z.y - spr.height + 1 - bob) };
    }
    function drawZombie(z) {
      const f = zombieFrame(z), spr = f.spr, p = zombiePos(z, spr);
      if (z.dying) {
        // afunda de volta para a terra
        const k = Math.min(1, z.dying / 0.5);
        const hv = Math.max(0, Math.round(spr.height * (1 - k)));
        if (hv > 0) b.drawImage(spr, 0, 0, spr.width, hv, p.x, p.y + (spr.height - hv), spr.width, hv);
        return;
      }
      b.globalAlpha = z.emerge < 1 ? Math.max(0.1, z.emerge) : 1;
      b.fillStyle = 'rgba(0,0,0,0.35)'; b.fillRect(p.x + 2, Math.round(z.y), spr.width - 4, 1);
      b.drawImage(spr, p.x, p.y);
      b.globalAlpha = 1;
    }
    function drawZombieGlow(z) {
      if (z.dying) return;
      const f = zombieFrame(z), p = zombiePos(z, f.spr);
      // um pouco da cor volta por cima do escuro: no breu ainda se vê a silhueta
      b.globalAlpha = 0.2 * (z.emerge < 1 ? z.emerge : 1);
      b.drawImage(f.spr, p.x, p.y);
      b.globalAlpha = 1;
      if (z.flash > 0) {
        b.globalAlpha = reduced ? 0.45 : 0.85;
        b.drawImage(f.white, p.x, p.y);
        b.globalAlpha = 1;
      }
      if (z.emerge < 0.5) return;
      b.fillStyle = EYE_GLOW[z.tipo];
      const eyes = f.set.eyes[z.dir];
      for (let i = 0; i < eyes.length; i++) b.fillRect(p.x + eyes[i][0], p.y + eyes[i][1], 1, 1);
    }
    function pickupVisible(p) {
      const left = p.life - p.t;
      if (left > 3) return true;
      return reduced ? true : Math.floor(left * 5) % 2 === 0;   // pisca devagar antes de sumir
    }
    function drawPickup(p) {
      if (!pickupVisible(p)) return;
      const spr = p.tipo === 'municao' ? A.ammo : A.coffee;
      const bob = reduced ? 0 : (Math.floor(time * 2 + p.x) % 2);
      const x = Math.round(p.x - spr.width / 2), y = Math.round(p.y - spr.height + 1 - bob);
      b.fillStyle = 'rgba(0,0,0,0.4)'; b.fillRect(x + 1, Math.round(p.y) + 1, spr.width - 2, 1);
      b.drawImage(spr, x, y);
      if (p.tipo === 'cafe' && !reduced) {
        const ph = Math.floor(time * 3) % 2;
        b.fillStyle = 'rgba(240,240,240,0.7)';
        b.fillRect(x + 2 + ph, y - 2, 1, 1); b.fillRect(x + 4 - ph, y - 3, 1, 1);
      }
    }
    function drawObstacle(o, pl) {
      let spr, ax, ay;
      if (o.kind === 'pequi') { spr = A.pequi; ax = 17; ay = 35; }
      else if (o.kind === 'poste') { spr = A.poste; ax = 5; ay = 33; }
      else if (o.kind === 'cupim') { spr = A.cupim; ax = 7; ay = 15; }
      else { spr = A.toco; ax = 5; ay = 8; }
      const x = o.x - ax, y = o.y - ay;
      // jogador escondido atrás da copa: a copa fica meio transparente
      if (o.kind === 'pequi' && pl.y < o.y && pl.y > o.y - 34 && Math.abs(pl.x - o.x) < 18) b.globalAlpha = 0.55;
      b.drawImage(spr, x, y);
      b.globalAlpha = 1;
    }

    /* ---------- desenho em resolução cheia (HUD e textos) ---------- */
    function font(px) { return Math.round(px) + 'px "VT323", "Courier New", monospace'; }
    function gx(x) { return L.ox + x * L.K; }
    function gy(y) { return L.oy + y * L.K; }
    function text(str, x, y, size, color, align, maxW, alpha) {
      ctx.font = font(size * L.K);
      ctx.textAlign = align || 'left';
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.lineWidth = Math.max(2, Math.round(L.K * 1.1));
      ctx.strokeStyle = '#05060a';
      const mw = maxW ? maxW * L.K : undefined;
      if (mw) { ctx.strokeText(str, gx(x), gy(y), mw); ctx.fillStyle = color; ctx.fillText(str, gx(x), gy(y), mw); }
      else { ctx.strokeText(str, gx(x), gy(y)); ctx.fillStyle = color; ctx.fillText(str, gx(x), gy(y)); }
      ctx.globalAlpha = 1;
    }
    function icon(spr, x, y) { ctx.drawImage(spr, gx(x), gy(y), spr.width * L.K, spr.height * L.K); }
    function veil(rgba) { ctx.fillStyle = rgba; ctx.fillRect(L.ox, L.oy, L.gw, L.gh); }

    function drawHud() {
      for (let i = 0; i < HEARTS; i++) icon(i < hearts ? A.heart : A.heartOff, 3 + i * 10, 3);
      const ax = 35;
      for (let i = 0; i < MAG; i++) icon(i < mag && reloadT <= 0 ? A.bullet : A.bulletOff, ax + i * 5, 3);
      const resColor = mag + reserve === 0 ? '#ff7a6a' : '#f4ead0';
      text(reloadT > 0 ? '...' : String(reserve), ax + MAG * 5 + 2, 1, 12, resColor, 'left');
      text('ONDA ' + Math.max(1, wave), 128, 1, 13, '#cfe9a8', 'center');
      text(fmt(score), 253, 1, 13, '#f4ead0', 'right');
      // números que sobem
      floats.forEach(function (f) {
        const k = f.t / f.life;
        text(f.text, f.x, f.y - k * 10, f.size, f.color, 'center', null, k > 0.7 ? (1 - k) / 0.3 : 1);
      });
      // recado grande no meio
      if (banner) {
        const k = banner.t / banner.life;
        const a = k < 0.12 ? k / 0.12 : k > 0.8 ? (1 - k) / 0.2 : 1;
        text(banner.title, 128, 52, 22, banner.color, 'center', 240, a);
        if (banner.sub) text(banner.sub, 128, 72, 11, '#f4ead0', 'center', 240, a);
      } else if (breakT > 0) {
        text('PRÓXIMA ONDA EM ' + Math.ceil(breakT), 128, 60, 12, '#cfe9a8', 'center', 240, 0.95);
      }
      // mordida: borda vermelha que some devagar (sem clarão)
      if (hurtFx > 0) {
        const a = (hurtFx / 0.6) * (reduced ? 0.22 : 0.42);
        const g = ctx.createRadialGradient(gx(128), gy(80), L.K * 40, gx(128), gy(80), L.K * 150);
        g.addColorStop(0, 'rgba(160,0,0,0)');
        g.addColorStop(1, 'rgba(160,0,0,' + a + ')');
        ctx.fillStyle = g; ctx.fillRect(L.ox, L.oy, L.gw, L.gh);
      }
      if (touchMode) drawTouch();
      else if (aimMode === 'mouse' && mouse.inside) drawCrosshair();
    }
    function drawCrosshair() {
      // mira grande, com contorno escuro: lê em cima do escuro e do capim iluminado
      const x = Math.round(gx(mouse.x)), y = Math.round(gy(mouse.y)), u = Math.max(1, Math.round(L.K));
      const arms = [[-7, 0, 4, 1], [3, 0, 4, 1], [0, -7, 1, 4], [0, 3, 1, 4]];
      ctx.fillStyle = K_OUT;
      arms.forEach(function (a) { ctx.fillRect(x + (a[0] - 1) * u - (u >> 1), y + (a[1] - 1) * u - (u >> 1), (a[2] + 2) * u, (a[3] + 2) * u); });
      ctx.fillRect(x - u - (u >> 1), y - u - (u >> 1), 3 * u, 3 * u);
      ctx.fillStyle = '#ffe9a0';
      arms.forEach(function (a) { ctx.fillRect(x + a[0] * u - (u >> 1), y + a[1] * u - (u >> 1), a[2] * u, a[3] * u); });
      ctx.fillStyle = '#ff7a5a';
      ctx.fillRect(x - (u >> 1), y - (u >> 1), u, u);
    }
    function ring(x, y, r, fill, stroke, w) {
      ctx.beginPath(); ctx.arc(gx(x), gy(y), r * L.K, 0, Math.PI * 2);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.lineWidth = Math.max(1, w * L.K); ctx.strokeStyle = stroke; ctx.stroke(); }
    }
    function drawTouch() {
      // joystick
      if (stick.id !== null) {
        ring(stick.bx, stick.by, 18, 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.35)', 1);
        ring(stick.kx, stick.ky, 8, 'rgba(255,255,255,0.38)', 'rgba(5,6,10,0.6)', 0.7);
      } else {
        ring(36, 124, 18, 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0.22)', 1);
        ring(36, 124, 7, 'rgba(255,255,255,0.18)', null, 0);
      }
      // tiro
      const down = fireTouch.id !== null;
      ring(BTN.fire.x, BTN.fire.y, BTN.fire.r, down ? 'rgba(255,211,110,0.4)' : 'rgba(255,211,110,0.18)', 'rgba(255,226,150,0.7)', 1);
      const fx = gx(BTN.fire.x), fy = gy(BTN.fire.y), u = L.K;
      ctx.strokeStyle = '#fff2c0'; ctx.lineWidth = Math.max(1, u);
      ctx.beginPath(); ctx.arc(fx, fy, 6 * u, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx - 10 * u, fy); ctx.lineTo(fx - 3 * u, fy); ctx.moveTo(fx + 3 * u, fy); ctx.lineTo(fx + 10 * u, fy);
      ctx.moveTo(fx, fy - 10 * u); ctx.lineTo(fx, fy - 3 * u); ctx.moveTo(fx, fy + 3 * u); ctx.lineTo(fx, fy + 10 * u); ctx.stroke();
      // recarregar e pausar
      ring(BTN.reload.x, BTN.reload.y, BTN.reload.r, 'rgba(255,255,255,0.14)', 'rgba(255,255,255,0.5)', 0.8);
      text('R', BTN.reload.x, BTN.reload.y - 6.5, 12, '#f4ead0', 'center');
      ring(BTN.pause.x, BTN.pause.y, BTN.pause.r, 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.45)', 0.8);
      ctx.fillStyle = '#f4ead0';
      ctx.fillRect(gx(BTN.pause.x - 3), gy(BTN.pause.y - 4), 2 * u, 8 * u);
      ctx.fillRect(gx(BTN.pause.x + 1), gy(BTN.pause.y - 4), 2 * u, 8 * u);
    }

    // Cena parada da tela de título
    const DEMO = {
      player: { x: 128, y: 112, aimVis: -1.0, moving: false, walkT: 0, invuln: 0 },
      zombies: [
        { tipo: 'normal', x: 168, y: 64, dir: 'down', walkT: 0, emerge: 1, dying: 0, flash: 0 },
        { tipo: 'corredor', x: 44, y: 58, dir: 'right', walkT: 1, emerge: 1, dying: 0, flash: 0 },
        { tipo: 'grandao', x: 228, y: 128, dir: 'left', walkT: 0, emerge: 1, dying: 0, flash: 0 },
        { tipo: 'normal', x: 56, y: 140, dir: 'right', walkT: 1, emerge: 1, dying: 0, flash: 0 }
      ]
    };

    function draw() {
      if (!alive) return;
      if (!L) relayout();
      if (!L) return;
      drawWorld(state === 'title' ? DEMO : null);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = false;
      // tarja em volta do quintal (o canvas raramente tem a proporção exata)
      ctx.fillStyle = '#05070c';
      if (L.oy > 0) { ctx.fillRect(0, 0, L.W, L.oy); ctx.fillRect(0, L.oy + L.gh, L.W, L.H - L.oy - L.gh); }
      if (L.ox > 0) { ctx.fillRect(0, 0, L.ox, L.H); ctx.fillRect(L.ox + L.gw, 0, L.W - L.ox - L.gw, L.H); }
      ctx.drawImage(buf, 0, 0, VW, VH, L.ox, L.oy, L.gw, L.gh);
      if (state === 'title') { drawTitle(); return; }
      drawHud();
      if (state === 'over') drawOver();
      else if (paused) drawPause();
    }

    function controlsLines() {
      if (touchMode) return ['JOYSTICK À ESQUERDA ANDA', 'TOQUE À DIREITA ATIRA PARA ONDE VOCÊ OLHA'];
      return ['WASD OU SETAS ANDAM  ·  MOUSE MIRA', 'CLIQUE OU ESPAÇO ATIRA  ·  R RECARREGA  ·  P PAUSA'];
    }
    function drawTitle() {
      veil('rgba(3,4,10,0.5)');
      text('NOITE DOS', 128, 14, 16, '#cfe9a8', 'center');
      text('ZUMBIS', 128, 25, 38, '#8fd16a', 'center');
      text('um quintal no Cerrado, uma lanterna e a lua cheia', 128, 60, 10, '#e6dcc4', 'center', 236);
      const cl = controlsLines();
      text(cl[0], 128, 92, 10, '#f4ead0', 'center', 240);
      text(cl[1], 128, 103, 10, '#f4ead0', 'center', 240);
      text(best > 0 ? 'RECORDE ' + fmt(best) : 'SOBREVIVA ÀS ONDAS', 128, 118, 11, '#ffd36e', 'center');
      text(touchMode ? 'TOQUE PARA COMEÇAR' : 'CLIQUE OU ENTER PARA COMEÇAR', 128, 136, 13, '#ffe9a0', 'center', 240);
    }
    function drawPause() {
      veil('rgba(3,4,10,0.6)');
      text('PAUSADO', 128, 52, 26, '#f4ead0', 'center');
      text(touchMode ? 'TOQUE PARA CONTINUAR' : 'P OU CLIQUE PARA CONTINUAR', 128, 84, 12, '#ffe9a0', 'center', 240);
      text('ONDA ' + Math.max(1, wave) + '  ·  ' + fmt(score) + ' PONTOS', 128, 100, 10, '#cfe9a8', 'center', 240);
      // pausado, o Esc segue para o desktop e fecha o Arcade (igual ao BLOCOS): avisa antes
      if (!touchMode) text('ESC DE NOVO FECHA O ARCADE', 128, 118, 10, '#ff9a8a', 'center', 240);
    }
    function drawOver() {
      const k = reduced ? 1 : overT;
      veil('rgba(24,3,6,' + (0.68 * k) + ')');
      if (k < 0.25) return;
      const a = Math.min(1, (k - 0.25) / 0.5);
      text('A NOITE TE PEGOU', 128, 22, 22, '#ff6b5a', 'center', 240, a);
      text(fmt(score) + ' PONTOS', 128, 50, 16, '#f4ead0', 'center', 240, a);
      text('ONDA ' + wave + '  ·  ' + kills + (kills === 1 ? ' ZUMBI' : ' ZUMBIS'), 128, 70, 11, '#cfe9a8', 'center', 240, a);
      text(novoRecorde ? 'NOVO RECORDE!' : 'RECORDE ' + fmt(best), 128, 86, 13, '#ffd36e', 'center', 240, a);
      const ready = now() - overAt > OVER_GUARD_MS;
      text(touchMode ? 'TOQUE PARA JOGAR DE NOVO' : 'CLIQUE OU ENTER PARA JOGAR DE NOVO', 128, 116, 12, '#ffe9a0', 'center', 240, ready ? a : a * 0.35);
      if (!ready && !raf && alive) global.setTimeout(function () { if (alive && state === 'over' && !raf) draw(); }, OVER_GUARD_MS + 30);
    }

    /* ---------- ligações ---------- */
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('keyup', onKeyUp);
    root.addEventListener('focusout', onFocusOut);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('lostpointercapture', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('contextmenu', onContextMenu);

    function onVisibility() {
      if (doc.hidden) { pauseGame('aba'); flushRecord(); stop(); }
      else if (alive) { draw(); kick(); }
    }
    doc.addEventListener('visibilitychange', onVisibility);

    function onMotionChange() {
      reduced = !!(mq && mq.matches);
      if (reduced) { shakeT = 0; overT = 1; }
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
      ro.observe(root);
    } else {
      global.addEventListener('resize', onResize);
    }

    // a fonte VT323 pode chegar depois do primeiro desenho
    function onFonts() { if (alive && !raf) draw(); }
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
          pontos: score, onda: wave, vidas: hearts, abates: kills, recorde: best, novoRecorde: novoRecorde,
          municao: { pente: mag, reserva: reserve, recarregando: reloadT > 0 },
          jogador: { x: +player.x.toFixed(2), y: +player.y.toFixed(2), mira: +(player.aim * 180 / Math.PI).toFixed(1), lanterna: +(player.aimVis * 180 / Math.PI).toFixed(1), andando: player.moving, invulneravel: player.invuln > 0 },
          mira: { modo: aimMode, x: +mouse.x.toFixed(2), y: +mouse.y.toFixed(2), dentro: mouse.inside, segurando: mouse.down },
          zumbis: zombies.map(function (z) { return { tipo: z.tipo, x: +z.x.toFixed(1), y: +z.y.toFixed(1), vida: z.hp, morrendo: !!z.dying, de: z.from }; }),
          fila: queue.length, filaTipos: queue.reduce(function (m, t) { m[t] = (m[t] || 0) + 1; return m; }, {}), intervalo: breakT > 0, recado: banner ? banner.title : null,
          coletaveis: pickups.map(function (p) { return { tipo: p.tipo, x: +p.x.toFixed(1), y: +p.y.toFixed(1) }; }),
          balas: bullets.length, tremor: shakeT > 0, quadros: frames, loopAtivo: !!raf, movimentoReduzido: reduced,
          toque: touchMode, joystick: stick.id !== null ? { x: +((stick.kx - stick.bx) / 18).toFixed(2), y: +((stick.ky - stick.by) / 18).toFixed(2) } : null,
          tiroToque: fireTouch.id !== null,
          canvas: { largura: canvas.width, altura: canvas.height, cssLargura: canvas.clientWidth, cssAltura: canvas.clientHeight, fator: L ? L.K : 0, escala: L ? +L.S.toFixed(3) : 0, ox: L ? L.ox : 0, oy: L ? L.oy : 0 }
        };
      },
      // Ganchos só para os testes (ninguém do desktop usa)
      _teste: {
        zumbi: function (tipo, x, y) { if (!alive || !ZT[tipo]) return null; const z = spawnZombie(tipo, x, y, true); z.dir = 'down'; if (!raf) draw(); return zombies.length - 1; },
        coletavel: function (tipo, x, y) { if (!alive) return null; spawnPickup(tipo === 'cafe' ? 'cafe' : 'municao', x, y); if (!raf) draw(); return pickups.length; },
        limpar: function () { zombies = []; queue = []; bullets = []; pickups = []; if (!raf) draw(); },
        congelar: function (v) { frozen = !!v; },
        jogador: function (x, y) { player.x = x; player.y = y; if (!raf) draw(); },
        municao: function (p, r) { mag = p; reserve = r; reloadT = 0; },
        vidas: function (n) { hearts = n; },
        // ponto do jogo -> px CSS dentro do canvas (para os testes acharem a tela)
        pontoCss: function (x, y) {
          if (!L) return null;
          const k = canvas.clientWidth / canvas.width;
          return { x: (L.ox + x * L.K) * k, y: (L.oy + y * L.K) * (canvas.clientHeight / canvas.height) };
        }
      },
      dispose: function () {
        if (!alive) return;
        recordDirty = true;
        flushRecord();
        alive = false;
        generation++;
        stop();
        releaseAll();
        root.removeEventListener('keydown', onKeyDown);
        root.removeEventListener('keyup', onKeyUp);
        root.removeEventListener('focusout', onFocusOut);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        canvas.removeEventListener('lostpointercapture', onPointerUp);
        canvas.removeEventListener('pointerleave', onPointerLeave);
        canvas.removeEventListener('contextmenu', onContextMenu);
        doc.removeEventListener('visibilitychange', onVisibility);
        if (mq) { try { mq.removeEventListener('change', onMotionChange); } catch (err) { try { mq.removeListener(onMotionChange); } catch (err2) { /* nada */ } } }
        if (ro) ro.disconnect(); else global.removeEventListener('resize', onResize);
        unwatchDpr();
        try { if (doc.fonts && doc.fonts.removeEventListener) doc.fonts.removeEventListener('loadingdone', onFonts); } catch (err) { /* nada */ }
        if (root.parentNode) root.parentNode.removeChild(root);
        removeStyle();
      }
    };
    return api;
  }

  global.AndreyZumbis = {
    create: create,
    getRecord: loadRecord,
    RECORD_KEY: RECORD_KEY
  };
})(window);
