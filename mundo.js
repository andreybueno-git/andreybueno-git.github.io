/*
 * mundo.js — MINI MUNDO, o mundinho de blocos do AndreyOS 24 (modo criativo).
 *
 * Contrato (o mesmo do AndreyBlocos, para o desktop hospedar igual):
 *   AndreyMundo.create(containerEl, { onEvent(kind, detail) }) -> api
 *     kind: 'start' | 'place' | 'break' | 'pick' | 'daynight' | 'reset' | 'pause' | 'resume'
 *     (extra: 'save' {ok} só quando muda se dá para gravar a ilha neste navegador)
 *   api.start(); api.pause(); api.resume(); api.isRunning()
 *   api.handleKey(key)   -> true se a tecla foi usada pelo jogo
 *   api.setVisible(bool) -> false pausa e para de desenhar
 *   api.dispose()        -> salva, solta tudo e libera o contexto WebGL (forceContextLoss)
 *
 * Extras opcionais (fora do contrato, ninguém precisa usar):
 *   api.handleKey(key, 'down' | 'up')  segurar/soltar de verdade (girar contínuo); sem o 2º
 *                                      argumento cada chamada é um toque (um passo)
 *   api.getState()                     retrato do mundo (testes e depuração)
 *   api.focus(); api.el                foca o mundo; nó raiz do componente
 *   api._teste                         projetar(x,y,z,face) e mirar(x,y) em px locais do canvas
 *   AndreyMundo.SAVE_KEY ('andreyos.mundo.v1')
 *   AndreyMundo.podeSalvar()           true se este navegador deixa gravar (localStorage)
 *
 * O jogo: uma ilha 16×16 (até 16 de altura para construir) com grama, terra, pedra,
 * areia, água, tronco, folhas, tábua, lanterna e um ipê-amarelo do Cerrado. Clique põe
 * o bloco escolhido na face clicada; clique direito, Shift+clique ou a ferramenta
 * QUEBRAR tira. No toque: toque põe, toque longo tira, arrastar gira, pinça aproxima.
 * O mundo fica salvo em localStorage (sempre em try/catch) e volta quando reabre.
 * Armazenamento bloqueado (modo privado, site barrado): o create testa e cada gravação
 * conta; getState().salvaOk diz a verdade para quem mostra "salvo neste navegador".
 *
 * Desenho: WebGLRenderer próprio (THREE global, r128) num canvas só, um contexto só.
 * O mundo vira DUAS malhas (blocos e água), refeitas inteiras a cada mudança (4096
 * células, cerca de 1 ms): só as faces que encostam no ar entram. A luz é a do
 * Minecraft, calculada na própria malha: luz do céu e luz de bloco (lanterna) por
 * vértice, mais oclusão ambiente nos cantos. Dia/noite troca só dois uniforms. As
 * texturas são pixel art 16×16 pintada em canvas, filtro nearest.
 * Desenha só quando algo muda ou a câmera anda: parado, nenhum laço de quadros.
 * Resolução em pixels do dispositivo (devicePixelRatio × escala da projeção 3D,
 * medida pela área real na tela), para ficar nítido dentro do matrix3d do monitor.
 *
 * Ponteiro: o canvas mora dentro do matrix3d do monitor (e às vezes girado 90° no
 * <dialog> ampliado do celular). Para saber onde o clique caiu usamos offsetX/offsetY
 * do próprio evento (o navegador já desfaz o transform), convertidos para pixels do
 * canvas por canvas.width / canvas.clientWidth. Nunca getBoundingClientRect para
 * mapear clique.
 *
 * Teclado: nenhum listener global. As teclas chegam por handleKey() (o desktop
 * repassa) ou por keydown dentro do próprio componente (canvas ou botões focados).
 * Quando o jogo usa a tecla, faz preventDefault + stopPropagation; a mesma tecla
 * chegando pelos dois caminhos no mesmo evento conta uma vez (janela de poucos ms).
 *
 * Eventos: o onEvent pode chamar start(), pause() ou dispose() de dentro do próprio
 * aviso; o jogo detecta e não continua por cima. start() com o jogo escondido
 * (setVisible(false) ou aba oculta) já nasce pausado, para isRunning() nunca dizer
 * true escondido. Diferente do BLOCOS, a pausa por ESCONDER volta sozinha quando o
 * jogo aparece de novo (não há relógio nem nada a perder); a pausa pedida (pause()
 * ou P) espera clique ou Enter.
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Mundo                                                               */
  /* ------------------------------------------------------------------ */

  const S = 16;                 // largura e fundo (x, z)
  const H = 16;                 // altura máxima (y)
  const N = S * S * H;
  const NIVEL_AGUA = 3;         // o mar vai até y = 3
  const SAVE_KEY = 'andreyos.mundo.v1';

  const AR = 0, GRAMA = 1, TERRA = 2, PEDRA = 3, AREIA = 4, AGUA = 5,
    TRONCO = 6, FOLHAS = 7, IPE = 8, TABUA = 9, LANTERNA = 10;
  const MAX_ID = 10;

  // tiles do atlas (4 × 4 de 16 px)
  const T = { gramaTopo: 0, gramaLado: 1, terra: 2, pedra: 3, areia: 4, agua: 5,
    troncoLado: 6, troncoTopo: 7, folhas: 8, ipe: 9, tabua: 10, lanterna: 11 };

  const BLOCOS = [
    null,
    { nome: 'grama', rotulo: 'GRAMA', topo: T.gramaTopo, lado: T.gramaLado, base: T.terra },
    { nome: 'terra', rotulo: 'TERRA', topo: T.terra, lado: T.terra, base: T.terra },
    { nome: 'pedra', rotulo: 'PEDRA', topo: T.pedra, lado: T.pedra, base: T.pedra },
    { nome: 'areia', rotulo: 'AREIA', topo: T.areia, lado: T.areia, base: T.areia },
    { nome: 'agua', rotulo: 'ÁGUA', topo: T.agua, lado: T.agua, base: T.agua },
    { nome: 'tronco', rotulo: 'TRONCO', topo: T.troncoTopo, lado: T.troncoLado, base: T.troncoTopo },
    { nome: 'folhas', rotulo: 'FOLHAS', topo: T.folhas, lado: T.folhas, base: T.folhas },
    { nome: 'ipe', rotulo: 'IPÊ-AMARELO', topo: T.ipe, lado: T.ipe, base: T.ipe },
    { nome: 'tabua', rotulo: 'TÁBUA', topo: T.tabua, lado: T.tabua, base: T.tabua },
    { nome: 'lanterna', rotulo: 'LANTERNA', topo: T.lanterna, lado: T.lanterna, base: T.lanterna }
  ];
  // OPACO: bloqueia luz, faz sombra nos cantos e esconde a face do vizinho.
  // Folhas e ipê são vazados (recorte por alfa): deixam ver e passar um pouco de luz.
  const OPACO = [0, 1, 1, 1, 1, 0, 1, 0, 0, 1, 1];
  const ATENUA = [0, 0, 0, 0, 0, 2, 0, 2, 2, 0, 0];
  const BARRA = [GRAMA, TERRA, PEDRA, AREIA, TRONCO, TABUA, IPE, LANTERNA];

  function idx(x, y, z) { return (y * S + z) * S + x; }
  function dentro(x, y, z) { return x >= 0 && x < S && z >= 0 && z < S && y >= 0 && y < H; }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function now() { return (global.performance && global.performance.now) ? global.performance.now() : Date.now(); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // Ruído de valor suave numa grade 6 × 6 (determinístico: a ilha nasce sempre igual).
  function ruido(seed) {
    const r = mulberry32(seed);
    const g = [];
    for (let i = 0; i < 49; i++) g.push(r());
    return function (x, z) {
      const fx = x / 3, fz = z / 3;
      const ix = Math.floor(fx), iz = Math.floor(fz);
      const tx = fx - ix, tz = fz - iz;
      const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
      const v = function (i, j) { return g[clamp(j, 0, 6) * 7 + clamp(i, 0, 6)]; };
      const a = v(ix, iz) + (v(ix + 1, iz) - v(ix, iz)) * sx;
      const b = v(ix, iz + 1) + (v(ix + 1, iz + 1) - v(ix, iz + 1)) * sx;
      return a + (b - a) * sz;
    };
  }

  // A ilha inicial: mar raso em volta, praia, grama, um morrinho de pedra no fundo,
  // um carvalho, um ipê-amarelo torto (Cerrado), um píer de tábua com lanterna.
  function gerarIlha() {
    const w = new Uint8Array(N);
    const ru = ruido(1987);
    const alt = new Int8Array(S * S);
    for (let z = 0; z < S; z++) {
      for (let x = 0; x < S; x++) {
        const dx = x - 7.5, dz = (z - 7.5) * 1.06;
        const d = Math.sqrt(dx * dx + dz * dz) + (ru(x, z) - 0.5) * 1.5;
        const morro = Math.max(0, 3.6 - Math.hypot(x - 11, z - 4.2) * 0.95);
        let h, topo, sub;
        if (d > 7.3) { h = ru(x + 4, z + 2) > 0.58 ? 2 : 1; topo = AREIA; sub = AREIA; }       // fundo do mar
        else if (d > 5.9) { h = d < 6.6 ? 4 : 3; topo = AREIA; sub = AREIA; }                  // praia
        else {
          h = 4 + Math.round(ru(x + 1, z + 6) * 1.2 + morro);
          topo = GRAMA; sub = TERRA;
          if (morro > 2.2) { topo = PEDRA; sub = PEDRA; }
          else if (morro > 1.5 && ru(x * 2, z) > 0.5) topo = PEDRA;
        }
        alt[z * S + x] = h;
        for (let y = 0; y <= h; y++) {
          let b;
          if (y === 0) b = PEDRA;
          else if (y === h) b = topo;
          else if (y >= h - 2) b = sub;
          else b = PEDRA;
          w[idx(x, y, z)] = b;
        }
        for (let y = h + 1; y <= NIVEL_AGUA; y++) w[idx(x, y, z)] = AGUA;
      }
    }
    const chao = function (x, z) { return alt[z * S + x]; };
    const por = function (x, y, z, b, soNoAr) {
      if (!dentro(x, y, z)) return;
      const i = idx(x, y, z);
      if (soNoAr && w[i] !== AR) return;
      w[i] = b;
    };

    // carvalho
    {
      const tx = 4, tz = 4, y0 = chao(tx, tz) + 1;
      for (let k = 0; k < 4; k++) por(tx, y0 + k, tz, TRONCO);
      for (let dy = 2; dy <= 3; dy++) {
        for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) {
          if (Math.abs(a) === 2 && Math.abs(c) === 2 && (dy === 3 || (a + c) % 4 === 0)) continue;
          por(tx + a, y0 + dy, tz + c, FOLHAS, true);
        }
      }
      for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) por(tx + a, y0 + 4, tz + c, FOLHAS, true);
      por(tx, y0 + 5, tz, FOLHAS, true); por(tx + 1, y0 + 5, tz, FOLHAS, true); por(tx, y0 + 5, tz - 1, FOLHAS, true);
    }
    // ipê-amarelo: tronco torto e copa larga e baixa, toda florida
    {
      const tx = 6, tz = 10, y0 = chao(tx, tz) + 1;
      por(tx, y0, tz, TRONCO); por(tx, y0 + 1, tz, TRONCO); por(tx, y0 + 2, tz, TRONCO);
      por(tx + 1, y0 + 2, tz, TRONCO); por(tx + 1, y0 + 3, tz, TRONCO);
      por(tx - 1, y0 + 3, tz, TRONCO);
      const cx = tx + 0.5, cz = tz;
      for (let a = -3; a <= 3; a++) for (let c = -3; c <= 3; c++) {
        const r1 = Math.hypot(a - 0.5, c) ;
        if (r1 <= 2.9) por(Math.round(cx + a - 0.5), y0 + 4, cz + c, IPE, true);
        if (r1 <= 2.2) por(Math.round(cx + a - 0.5), y0 + 5, cz + c, IPE, true);
        if (r1 <= 1.2) por(Math.round(cx + a - 0.5), y0 + 6, cz + c, IPE, true);
      }
      por(tx - 2, y0 + 3, tz, IPE, true); por(tx + 3, y0 + 3, tz + 1, IPE, true);
    }
    // moitinhas
    por(11, chao(11, 10) + 1, 10, FOLHAS, true);
    por(3, chao(3, 9) + 1, 9, FOLHAS, true);
    // píer: tábuas sobre a água, saindo da praia para a frente, com lanterna na ponta
    {
      const px = 10;
      let z0 = -1;
      for (let z = S - 1; z >= 8; z--) { if (chao(px, z) >= NIVEL_AGUA) { z0 = z + 1; break; } }
      if (z0 > 0 && z0 < S) {
        for (let z = z0; z < S; z++) por(px, NIVEL_AGUA, z, TABUA);
        por(px, NIVEL_AGUA + 1, S - 1, LANTERNA);
      }
    }
    // lanterna perto do ipê
    por(8, chao(8, 8) + 1, 8, LANTERNA, true);
    return w;
  }

  /* ------------------------------------------------------------------ */
  /* Salvar (localStorage sempre em try/catch, dado salvo tratado como    */
  /* hostil: tamanho, ids e somas conferidos antes de usar)              */
  /* ------------------------------------------------------------------ */

  function rle(w) {
    const out = [];
    let b = w[0], n = 0;
    for (let i = 0; i < N; i++) {
      if (w[i] === b) n++;
      else { out.push(b, n); b = w[i]; n = 1; }
    }
    out.push(b, n);
    return out;
  }
  function unrle(arr) {
    if (!Array.isArray(arr) || arr.length % 2 || arr.length > N * 2) return null;
    const w = new Uint8Array(N);
    let p = 0;
    for (let k = 0; k < arr.length; k += 2) {
      const b = arr[k], n = arr[k + 1];
      if (!Number.isInteger(b) || b < 0 || b > MAX_ID || !Number.isInteger(n) || n < 1 || p + n > N) return null;
      w.fill(b, p, p + n);
      p += n;
    }
    return p === N ? w : null;
  }
  function lerSalvo() {
    try {
      const raw = global.localStorage.getItem(SAVE_KEY);
      if (!raw || raw.length > 200000) return null;
      const d = JSON.parse(raw);
      if (!d || d.v !== 1 || d.s !== S || d.h !== H) return null;
      const w = unrle(d.rle);
      if (!w) return null;
      const c = d.cam || {};
      const num = function (v, a, b, def) { return (typeof v === 'number' && isFinite(v)) ? clamp(v, a, b) : def; };
      return {
        mundo: w,
        noite: d.noite === true,
        slot: Number.isInteger(d.slot) ? clamp(d.slot, 0, BARRA.length - 1) : 0,
        cam: { yaw: num(c.yaw, -1e6, 1e6, null), pitch: num(c.pitch, PITCH_MIN, PITCH_MAX, null), zoom: num(c.zoom, ZOOM_MIN, ZOOM_MAX, null) }
      };
    } catch (err) { return null; }
  }
  function gravar(dado) {
    try { global.localStorage.setItem(SAVE_KEY, JSON.stringify(dado)); return true; } catch (err) { return false; }
  }
  // Dá para gravar? setItem/removeItem de uma chave de teste (modo privado ou bloqueado: não)
  function podeSalvar() {
    try {
      const k = SAVE_KEY + '.teste';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return true;
    } catch (err) { return false; }
  }
  function apagarSalvo() {
    try { global.localStorage.removeItem(SAVE_KEY); } catch (err) { /* sem armazenamento: nada a apagar */ }
  }

  /* ------------------------------------------------------------------ */
  /* Texturas: pixel art 16 × 16 pintada em canvas                       */
  /* ------------------------------------------------------------------ */

  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function pal(arr) { return arr.map(hexRgb); }
  const P_GRAMA = pal(['#5da83a', '#55a034', '#67b443', '#4f962f', '#6dbb48', '#5aa538']);
  const P_TERRA = pal(['#7b5434', '#70492c', '#86603e', '#654226', '#8d6844']);
  const P_PEDRA = pal(['#7f7f7f', '#888888', '#767676', '#919191', '#6e6e6e']);
  const P_AREIA = pal(['#ddd096', '#e5d9a4', '#d4c589', '#eadfae', '#cfbf80']);
  const P_AGUA = pal(['#2f6fd4', '#3577da', '#2a66c6', '#3c80e0']);
  const P_TRONCO = pal(['#6b4a2b', '#5f4126', '#775333', '#563a21']);
  const P_FOLHAS = pal(['#3f8c2b', '#367c25', '#489a33', '#2f6e20', '#3c8529']);
  const P_IPE = pal(['#f6c915', '#ffd93b', '#eab20c', '#fde36a', '#f2bd10']);
  const P_TABUA = pal(['#b48a52', '#a67e49', '#bf955d']);

  function pintarAtlas(doc) {
    const c = doc.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    const img = g.createImageData(64, 64);
    const d = img.data;
    const r = mulberry32(240917);
    function at(t, x, y) { return (((t >> 2) * 16 + y) * 64 + (t & 3) * 16 + x) * 4; }
    function put(t, x, y, rgb, a) {
      if (x < 0 || y < 0 || x > 15 || y > 15) return;
      const i = at(t, x, y);
      d[i] = clamp(Math.round(rgb[0]), 0, 255); d[i + 1] = clamp(Math.round(rgb[1]), 0, 255); d[i + 2] = clamp(Math.round(rgb[2]), 0, 255);
      d[i + 3] = a === undefined ? 255 : a;
    }
    function get(t, x, y) { const i = at(t, x, y); return [d[i], d[i + 1], d[i + 2]]; }
    function esc(rgb, f) { return [rgb[0] * f, rgb[1] * f, rgb[2] * f]; }
    function sorteia(p) { return p[(r() * p.length) | 0]; }
    function chuvisco(t, p) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(t, x, y, sorteia(p)); }
    function pontos(t, n, f) { for (let k = 0; k < n; k++) { const x = (r() * 16) | 0, y = (r() * 16) | 0; put(t, x, y, esc(get(t, x, y), f)); } }

    // grama (topo): verde salpicado, com fios mais claros
    chuvisco(T.gramaTopo, P_GRAMA); pontos(T.gramaTopo, 22, 1.14); pontos(T.gramaTopo, 14, 0.84);
    // terra
    chuvisco(T.terra, P_TERRA);
    for (let k = 0; k < 9; k++) { const x = (r() * 15) | 0, y = (r() * 16) | 0; put(T.terra, x, y, esc(get(T.terra, x, y), 0.8)); put(T.terra, x + 1, y, esc(get(T.terra, x + 1, y), 0.8)); }
    for (let k = 0; k < 6; k++) put(T.terra, (r() * 16) | 0, (r() * 16) | 0, hexRgb('#a2825c'));
    // grama (lado): terra com a franja verde escorrendo
    chuvisco(T.gramaLado, P_TERRA); pontos(T.gramaLado, 12, 0.82);
    for (let x = 0; x < 16; x++) {
      const fundo = 2 + (r() < 0.6 ? 1 : 0) + (r() < 0.28 ? 1 : 0);
      for (let y = 0; y <= fundo; y++) put(T.gramaLado, x, y, esc(sorteia(P_GRAMA), y === fundo ? 0.82 : 0.95));
    }
    // pedra: cinza com rachaduras
    chuvisco(T.pedra, P_PEDRA); pontos(T.pedra, 10, 1.12);
    for (let k = 0; k < 6; k++) {
      let x = (r() * 16) | 0, y = (r() * 16) | 0;
      const n = 2 + ((r() * 3) | 0);
      for (let s = 0; s < n; s++) { put(T.pedra, x, y, hexRgb('#5c5c5c')); x += r() < 0.5 ? 1 : 0; y += r() < 0.6 ? 1 : 0; }
    }
    // areia
    chuvisco(T.areia, P_AREIA); pontos(T.areia, 10, 0.88);
    // água: azul com marolas claras
    chuvisco(T.agua, P_AGUA);
    for (let k = 0; k < 7; k++) {
      const y = (r() * 16) | 0, x0 = (r() * 13) | 0, n = 2 + ((r() * 3) | 0);
      for (let s = 0; s < n; s++) put(T.agua, x0 + s, y, hexRgb('#6aa9f4'));
    }
    // tronco (lado): casca em faixas verticais
    for (let x = 0; x < 16; x++) {
      const base = sorteia(P_TRONCO), sulco = r() < 0.3;
      for (let y = 0; y < 16; y++) put(T.troncoLado, x, y, esc(base, (sulco ? 0.78 : 1) * (0.9 + r() * 0.2)));
    }
    // tronco (topo): anéis
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dd = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      let cor;
      if (dd > 6.6) cor = esc(sorteia(P_TRONCO), 0.95);
      else cor = ((Math.floor(dd) & 1) ? hexRgb('#a07a4b') : hexRgb('#b98f5c'));
      put(T.troncoTopo, x, y, esc(cor, 0.94 + r() * 0.1));
    }
    // folhas: verde com furos (recorte)
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (r() < 0.15) put(T.folhas, x, y, [0, 0, 0], 0);
      else put(T.folhas, x, y, esc(sorteia(P_FOLHAS), r() < 0.2 ? 0.8 : 1));
    }
    // ipê: flores amarelas, uns galhinhos e furos
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const q = r();
      if (q < 0.11) put(T.ipe, x, y, [0, 0, 0], 0);
      else if (q < 0.17) put(T.ipe, x, y, hexRgb('#7a5f22'));
      else if (q < 0.24) put(T.ipe, x, y, hexRgb('#e2920c'));
      else put(T.ipe, x, y, sorteia(P_IPE));
    }
    // tábua: quatro pranchas com emendas alternadas
    for (let y = 0; y < 16; y++) {
      const tab = y >> 2, base = P_TABUA[tab % 3], emenda = (tab * 7 + 3) & 15;
      for (let x = 0; x < 16; x++) {
        let cor = esc(base, 0.93 + r() * 0.14);
        if ((y & 3) === 3) cor = esc(base, 0.68);
        else if (x === emenda) cor = esc(base, 0.74);
        put(T.tabua, x, y, cor);
      }
    }
    // lanterna: moldura de ferro, duas grades e o miolo aceso
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let cor;
      if (x === 0 || y === 0 || x === 15 || y === 15) cor = hexRgb('#2a2119');
      else if (x === 1 || y === 1 || x === 14 || y === 14) cor = hexRgb('#5b4631');
      else if ((x === 5 || x === 10) && y > 1 && y < 14) cor = hexRgb('#3b2d20');
      else {
        const dd = Math.hypot(x - 7.5, y - 7.5);
        cor = dd < 2.6 ? hexRgb('#fff5c4') : dd < 4.6 ? hexRgb('#ffe07a') : hexRgb('#ffc441');
        cor = esc(cor, 0.95 + r() * 0.08);
      }
      put(T.lanterna, x, y, cor);
    }
    g.putImageData(img, 0, 0);

    // cor média de cada tile (fagulhas ao quebrar)
    const media = [];
    for (let t = 0; t < 12; t++) {
      let R = 0, G = 0, B = 0, n = 0;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const i = at(t, x, y); if (d[i + 3] > 0) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; } }
      media.push(n ? [R / n / 255, G / n / 255, B / n / 255] : [1, 1, 1]);
    }
    return { canvas: c, media: media };
  }

  // Ícone isométrico de um bloco (como no inventário), desenhado a partir do atlas.
  function iconeBloco(doc, atlas, b) {
    const Z = 96, hw = 42, hh = 21, sh = 42, y0 = 6, cx = 48;
    const c = doc.createElement('canvas');
    c.width = Z; c.height = Z;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const def = BLOCOS[b];
    function face(t, a, bb, cc, dd, e, f, escuro) {
      g.setTransform(a, bb, cc, dd, e, f);
      g.globalCompositeOperation = 'source-over';
      g.drawImage(atlas, (t & 3) * 16, (t >> 2) * 16, 16, 16, 0, 0, 16, 16);
      if (escuro) {
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = 'rgba(0,0,0,' + escuro + ')';
        g.fillRect(0, 0, 16, 16);
      }
    }
    const u = 1 / 16;
    face(def.lado, hw * u, hh * u, 0, sh * u, cx - hw, y0 + hh, 0.22);          // esquerda
    face(def.lado, hw * u, -hh * u, 0, sh * u, cx, y0 + 2 * hh, 0.4);           // direita
    face(def.topo, hw * u, hh * u, -hw * u, hh * u, cx, y0, 0);                  // topo
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    try { return c.toDataURL('image/png'); } catch (err) { return ''; }
  }

  // Pixel art em SVG (nítida em qualquer escala): mapa de letras -> retângulos.
  function svgPixel(mapa, cores) {
    const h = mapa.length, w = mapa[0].length;
    let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true" focusable="false" shape-rendering="crispEdges">';
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        const ch = mapa[y][x];
        let n = 1;
        while (x + n < w && mapa[y][x + n] === ch) n++;
        if (cores[ch]) s += '<rect x="' + x + '" y="' + y + '" width="' + n + '" height="1" fill="' + cores[ch] + '"/>';
        x += n;
      }
    }
    return s + '</svg>';
  }
  const ICON = {
    picareta: svgPixel([
      '................',
      '....#######.....',
      '...#mmmmmmm##...',
      '....###mmmmmm#..',
      '.......#hmmmmm#.',
      '......#h#..#mm#.',
      '.....#h#....#m#.',
      '....#h#.....#m#.',
      '...#h#......#m#.',
      '..#h#........#..',
      '.#h#............',
      '#h#.............',
      '##..............',
      '................'
    ], { '#': '#1f1f1f', m: '#d3dae0', h: '#9b6a35' }),
    sol: svgPixel([
      '.....yy.....',
      '.y...yy...y.',
      '..y......y..',
      '....YYYY....',
      '...YyyyyY...',
      'yy.YyyyyY.yy',
      'yy.YyyyyY.yy',
      '...YyyyyY...',
      '....YYYY....',
      '..y......y..',
      '.y...yy...y.',
      '.....yy.....'
    ], { y: '#ffe36a', Y: '#f2a81d' }),
    lua: svgPixel([
      '....WWWW....',
      '..WWww......',
      '.Www........',
      '.Ww.........',
      'Www.........',
      'Www.........',
      'Www.........',
      'Www......W..',
      '.Ww.....WW..',
      '.WWw...WW...',
      '..WWWWWW....',
      '....WWW.....'
    ], { W: '#f3efd8', w: '#c9c3a4' }),
    refaz: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18.5 8.5A7.5 7.5 0 1 0 19.5 14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"/><polygon points="20.5,2.5 21,10.5 13.5,9" fill="currentColor"/></svg>'
  };

  /* ------------------------------------------------------------------ */
  /* Estilos (injetados uma vez, com prefixo próprio)                    */
  /* ------------------------------------------------------------------ */

  const STYLE_ID = 'andrey-mundo-estilo';
  let styleRefs = 0;
  const ESTRELAS = [[8, 12], [17, 7], [26, 18], [35, 9], [44, 15], [53, 6], [61, 20], [70, 10], [79, 16], [88, 7], [94, 22], [12, 30], [31, 27], [57, 31], [83, 29], [22, 40], [66, 38], [91, 41]]
    .map(function (p, i) { const r = i % 3 ? 1.2 : 1.8; return 'radial-gradient(' + r + 'px ' + r + 'px at ' + p[0] + '% ' + p[1] + '%,#fff 60%,transparent 100%)'; }).join(',');
  const CSS = [
    // aspect-ratio só vale quando o pai não tem altura definida (height:100% vira auto)
    '.mnd{position:relative;display:block;width:100%;height:100%;min-height:300px;aspect-ratio:820/580;box-sizing:border-box;margin:0;padding:0;overflow:hidden;isolation:isolate;background:#8cc8ff;color:#fff;font-family:"VT323","Courier New",monospace;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}',
    '.mnd *{box-sizing:border-box}',
    '.mnd .mnd-ceu,.mnd .mnd-noite{position:absolute;left:0;top:0;width:100%;height:100%;z-index:0;pointer-events:none;overflow:hidden}',
    '.mnd .mnd-ceu{background:linear-gradient(#69b3fb,#a9d8ff 58%,#dcf1ff)}',
    '.mnd .mnd-ceu i,.mnd .mnd-noite i{position:absolute;display:block}',
    '.mnd .mnd-sol{right:13%;top:17%;width:46px;height:46px;background:#fff6b0;box-shadow:0 0 0 7px rgba(255,246,176,.35),0 0 0 15px rgba(255,246,176,.15)}',
    '.mnd .mnd-nuvem{width:84px;height:16px;background:#fff;opacity:.92;box-shadow:16px -12px 0 -2px #fff,40px -12px 0 0 #fff,-18px 4px 0 -4px #fff}',
    '.mnd .mnd-nuvem--a{left:9%;top:15%}',
    '.mnd .mnd-nuvem--b{left:56%;top:26%;transform:scale(.7);opacity:.8}',
    '.mnd .mnd-noite{background:linear-gradient(#050a1f,#101c44 62%,#1d2d5a);opacity:0;transition:opacity .7s ease}',
    '.mnd.mnd--noite .mnd-noite{opacity:1}',
    '.mnd .mnd-lua{right:14%;top:17%;width:38px;height:38px;background:#efeacf;box-shadow:inset -9px -6px 0 0 #cfc8a6,0 0 0 8px rgba(239,234,207,.12)}',
    '.mnd .mnd-estrelas{left:0;top:0;width:100%;height:100%;background:' + ESTRELAS + '}',
    '.mnd .mnd-canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:block;z-index:1;outline:none;touch-action:none;-webkit-tap-highlight-color:transparent;cursor:pointer}',
    '.mnd.mnd--quebrar .mnd-canvas{cursor:crosshair}',
    '.mnd .mnd-canvas:focus-visible{box-shadow:inset 0 0 0 3px #ffd84a}',
    '.mnd .mnd-topo{position:absolute;z-index:2;left:8px;right:8px;top:8px;display:flex;align-items:flex-start;justify-content:space-between;gap:8px;pointer-events:none}',
    '.mnd .mnd-dica{margin:0;padding:3px 8px 4px;max-width:64%;background:rgba(0,0,0,.45);color:#fff;font-size:21px;line-height:1.05;text-shadow:2px 2px 0 rgba(0,0,0,.55)}',
    '.mnd .mnd-dica b{color:#ffe36a;font-weight:normal}',
    '.mnd .mnd-acoes{display:flex;gap:6px;pointer-events:auto}',
    '.mnd .mnd-btn{height:44px;min-width:44px;margin:0;padding:0 10px;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:2px solid #111;border-radius:0;background:#8b8b8b;box-shadow:inset 2px 2px 0 #c8c8c8,inset -2px -3px 0 #4f4f4f;color:#fff;font:inherit;font-size:22px;line-height:1;letter-spacing:1px;text-transform:none;text-shadow:2px 2px 0 #3c3c3c;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}',
    '.mnd .mnd-btn:hover{background:#7f8cc4}',
    '.mnd .mnd-btn:active{box-shadow:inset -2px -2px 0 #c8c8c8,inset 2px 3px 0 #4f4f4f}',
    '.mnd .mnd-btn:focus-visible{outline:3px solid #ffd84a;outline-offset:1px}',
    '.mnd .mnd-btn svg{width:22px;height:22px;flex:0 0 auto;display:block;pointer-events:none}',
    '.mnd .mnd-btn.is-armado{background:#b2453b}',
    '.mnd .mnd-base{position:absolute;z-index:2;left:0;right:0;bottom:8px;display:flex;flex-direction:column;align-items:center;gap:5px;pointer-events:none}',
    '.mnd .mnd-nome{min-height:24px;margin:0;padding:0 8px;font-size:25px;line-height:24px;color:#fff;text-shadow:2px 2px 0 #3c3c3c;opacity:0;transition:opacity .25s ease}',
    '.mnd .mnd-nome.is-on{opacity:1}',
    '.mnd .mnd-nome.is-aviso{color:#ffb0a6}',
    '.mnd .mnd-barra{display:flex;align-items:center;padding:3px;background:rgba(10,10,10,.55);border:2px solid #0b0b0b;box-shadow:inset 0 0 0 2px #5a5a5a;pointer-events:auto}',
    '.mnd .mnd-slot{position:relative;width:52px;height:52px;margin:0;padding:0;display:flex;align-items:center;justify-content:center;border:3px solid;border-color:#3d3d3d #7c7c7c #7c7c7c #3d3d3d;border-radius:0;background:rgba(139,139,139,.42);color:#fff;font:inherit;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}',
    '.mnd .mnd-slot:hover{background:rgba(190,190,190,.5)}',
    '.mnd .mnd-slot img{width:38px;height:38px;display:block;pointer-events:none}',
    '.mnd .mnd-slot svg{width:34px;height:34px;display:block;pointer-events:none}',
    '.mnd .mnd-slot.is-sel{z-index:1;border-color:#fff;background:rgba(255,255,255,.2);box-shadow:0 0 0 2px #111}',
    '.mnd .mnd-slot:focus-visible{outline:3px solid #ffd84a;outline-offset:1px;z-index:2}',
    '.mnd .mnd-num{position:absolute;left:3px;top:0;font-size:16px;line-height:16px;color:#fff;text-shadow:1px 1px 0 #000;pointer-events:none}',
    '.mnd .mnd-sep{flex:0 0 8px}',
    '.mnd .mnd-veu{position:absolute;z-index:3;left:0;top:0;width:100%;height:100%;display:none;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:rgba(0,0,0,.48);text-align:center;pointer-events:none}',
    '.mnd .mnd-veu.is-on{display:flex}',
    '.mnd .mnd-veu strong{font-size:46px;font-weight:normal;letter-spacing:3px;color:#fff;text-shadow:3px 3px 0 #3c3c3c}',
    '.mnd .mnd-veu span{font-size:23px;color:#e8e8e8;text-shadow:2px 2px 0 #222}',
    '.mnd .mnd-anel{position:absolute;z-index:2;left:0;top:0;width:64px;height:64px;margin:-32px 0 0 -32px;display:none;pointer-events:none}',
    '.mnd .mnd-anel.is-on{display:block}',
    '.mnd .mnd-anel svg{width:100%;height:100%;display:block}',
    '.mnd .mnd-anel-p{stroke-dasharray:100.6;stroke-dashoffset:100.6}',
    '.mnd .mnd-anel.is-on .mnd-anel-p{animation:mnd-anel 450ms linear forwards}',
    '@keyframes mnd-anel{to{stroke-dashoffset:0}}',
    '.mnd .mnd-mira{position:absolute;z-index:2;left:50%;top:50%;width:20px;height:20px;margin:-10px 0 0 -10px;display:none;pointer-events:none}',
    '.mnd.mnd--mira .mnd-mira{display:block}',
    '.mnd .mnd-mira::before,.mnd .mnd-mira::after{content:"";position:absolute;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.6)}',
    '.mnd .mnd-mira::before{left:9px;top:0;width:2px;height:20px}',
    '.mnd .mnd-mira::after{left:0;top:9px;width:20px;height:2px}',
    // dedo: no celular o desktop inteiro aparece reduzido (~0,5), então os alvos crescem
    // ~87 px na superfície = 44 px na tela do celular com o desktop ampliado (girado, ~0,51);
    // --mnd-cabe (relayout) é o maior lado que deixa os 9 slots caberem na largura da ilha.
    '@media (pointer: coarse){.mnd .mnd-slot{width:86px;height:86px;width:min(88px,var(--mnd-cabe,86px));height:min(88px,var(--mnd-cabe,86px));border-width:4px}.mnd .mnd-sep{flex-basis:6px}.mnd .mnd-slot img{width:74%;height:74%}.mnd .mnd-slot svg{width:64%;height:64%}' +
      '.mnd .mnd-num{font-size:24px;line-height:24px}.mnd .mnd-btn{height:62px;min-width:62px;padding:0 14px;font-size:28px}.mnd .mnd-btn svg{width:28px;height:28px}' +
      '.mnd .mnd-dica{font-size:25px}.mnd .mnd-nome{font-size:30px;line-height:30px;min-height:30px}.mnd .mnd-anel{width:96px;height:96px;margin:-48px 0 0 -48px}}',
    '.mnd.mnd--estreito .mnd-slot{width:40px;height:40px;border-width:2px}',
    '.mnd.mnd--estreito .mnd-slot img{width:28px;height:28px}',
    '.mnd.mnd--estreito .mnd-slot svg{width:26px;height:26px}',
    '.mnd.mnd--estreito .mnd-num{font-size:13px;line-height:13px}',
    '.mnd.mnd--estreito .mnd-btn span{display:none}',
    '.mnd.mnd--estreito .mnd-dica{font-size:15px;max-width:52%}',
    '.mnd .mnd-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
    '@media (prefers-reduced-motion: reduce){.mnd .mnd-noite,.mnd .mnd-nome{transition:none}}'
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

  /* ------------------------------------------------------------------ */
  /* Câmera, luz e malha                                                 */
  /* ------------------------------------------------------------------ */

  const FOV = 32;
  const PITCH_MIN = 0.16, PITCH_MAX = 1.36;
  const ZOOM_MIN = 0.36, ZOOM_MAX = 1.7;
  const ALVO = [8, 2.9, 8];         // centro da órbita (um pouco abaixo do meio: a barra mora embaixo)
  const RAIO_CABE = 13.2;           // o que precisa caber na tela no zoom 1
  const PASSO_GIRO = Math.PI / 12;  // 15° por toque
  const PASSO_INCL = 0.12;
  const VEL_GIRO = 1.9;             // rad/s segurando
  const VEL_INCL = 1.1;
  const ESPERA_SEGURAR = 0.22;      // s antes de virar giro contínuo
  const DUP_WINDOW_MS = 8;
  const MAX_BACKING_PX = 2600000;
  const LONGO_MS = 450;
  const FOLGA_MOUSE = 4, FOLGA_TOQUE = 10;   // px locais: mais que isso já é arrasto
  const NARROW_PX = 560;
  const MAX_FAG = 72;            // fagulhas ao mesmo tempo

  // Curvas da luz (0..15 -> brilho). Céu mais suave, lanterna cai mais rápido.
  const CURVA_CEU = [], CURVA_BLOCO = [];
  for (let l = 0; l <= 15; l++) {
    CURVA_CEU.push(0.16 + 0.84 * Math.pow(l / 15, 1.55));
    CURVA_BLOCO.push(l ? Math.min(1, Math.pow(l / 15, 1.9) * 1.06) : 0);
  }
  const AO_CURVA = [0.5, 0.67, 0.83, 1];
  const DIA = { ceu: [1, 1, 1], luz: [0.78, 0.72, 0.6] };
  const NOITE = { ceu: [0.23, 0.27, 0.47], luz: [1, 0.86, 0.6] };

  // Faces: normal, sombreamento fixo (estilo Minecraft) e os 4 cantos [x, y, z, u, v].
  // Triângulos (0,1,2)(2,1,3); a diagonal troca quando a oclusão pede.
  const FACES = [
    { n: [-1, 0, 0], sombra: 0.72, c: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
    { n: [1, 0, 0], sombra: 0.72, c: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
    { n: [0, -1, 0], sombra: 0.5, c: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
    { n: [0, 1, 0], sombra: 1, c: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
    { n: [0, 0, -1], sombra: 0.86, c: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
    { n: [0, 0, 1], sombra: 0.86, c: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] }
  ];
  const VIZ6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

  const VS = [
    'attribute float aSombra;',
    'attribute vec2 aLuz;',
    'varying vec2 vUv;',
    'varying float vSombra;',
    'varying vec2 vLuz;',
    'void main() {',
    '  vUv = uv; vSombra = aSombra; vLuz = aLuz;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');
  const FS = [
    'uniform sampler2D uMapa;',
    'uniform vec3 uCeu;',
    'uniform vec3 uLuz;',
    'uniform float uOpac;',
    'uniform float uCorte;',
    'varying vec2 vUv;',
    'varying float vSombra;',
    'varying vec2 vLuz;',
    'void main() {',
    '  vec4 t = texture2D(uMapa, vUv);',
    '  if (t.a < uCorte) discard;',
    '  vec3 l = max(uCeu * vLuz.x, uLuz * vLuz.y);',
    '  gl_FragColor = vec4(t.rgb * vSombra * l, uOpac);',
    '}'
  ].join('\n');

  function el(doc, tag, cls) { const e = doc.createElement(tag); if (cls) e.className = cls; return e; }

  // Tecla -> ação
  function actionFor(key) {
    switch (key) {
      case 'ArrowLeft': case 'Left': case 'q': case 'Q': return 'giraEsq';
      case 'ArrowRight': case 'Right': case 'e': case 'E': return 'giraDir';
      case 'ArrowUp': case 'Up': case 'w': case 'W': return 'sobe';
      case 'ArrowDown': case 'Down': case 's': case 'S': return 'desce';
      case '+': case '=': return 'perto';
      case '-': case '_': return 'longe';
      case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8': return 'slot' + key;
      case '9': case '0': return 'ferramenta';
      case 'x': case 'X': return 'alternaFerramenta';
      case 'n': case 'N': return 'noite';
      case ' ': case 'Spacebar': case 'Space': case 'Enter': return 'por';
      case 'Backspace': case 'Delete': case 'Del': return 'quebrar';
      case 'p': case 'P': return 'pausa';
      default: return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* create                                                              */
  /* ------------------------------------------------------------------ */

  function create(containerEl, opts) {
    if (!containerEl || !containerEl.appendChild) throw new Error('MINI MUNDO: informe o elemento onde o jogo vai morar.');
    opts = opts || {};
    const doc = global.document;
    const THREE = global.THREE;

    /* ---------- DOM ---------- */
    addStyle();
    const root = el(doc, 'div', 'mnd');
    const ceuEl = el(doc, 'div', 'mnd-ceu');
    ceuEl.innerHTML = '<i class="mnd-sol"></i><i class="mnd-nuvem mnd-nuvem--a"></i><i class="mnd-nuvem mnd-nuvem--b"></i>';
    const noiteEl = el(doc, 'div', 'mnd-noite');
    noiteEl.innerHTML = '<i class="mnd-estrelas"></i><i class="mnd-lua"></i>';
    const canvas = el(doc, 'canvas', 'mnd-canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-roledescription', 'jogo');
    canvas.setAttribute('aria-label', 'MINI MUNDO, ilha de blocos. Clique põe o bloco escolhido, clique direito ou Shift mais clique tira. ' +
      'Setas, Q e E giram; W e S mudam o ângulo; mais e menos aproximam. Teclas 1 a 8 escolhem o bloco, 9 ou X a picareta. ' +
      'Espaço põe e Backspace tira o bloco na mira do centro. N alterna dia e noite.');
    const topo = el(doc, 'div', 'mnd-topo');
    const dica = el(doc, 'p', 'mnd-dica');
    dica.setAttribute('aria-hidden', 'true');
    const acoes = el(doc, 'div', 'mnd-acoes');
    const btnNoite = el(doc, 'button', 'mnd-btn');
    btnNoite.type = 'button';
    const btnRefaz = el(doc, 'button', 'mnd-btn');
    btnRefaz.type = 'button';
    acoes.appendChild(btnNoite);
    acoes.appendChild(btnRefaz);
    topo.appendChild(dica);
    topo.appendChild(acoes);
    const base = el(doc, 'div', 'mnd-base');
    const nomeEl = el(doc, 'p', 'mnd-nome');
    nomeEl.setAttribute('aria-hidden', 'true');
    const barra = el(doc, 'div', 'mnd-barra');
    barra.setAttribute('role', 'toolbar');
    barra.setAttribute('aria-label', 'Blocos do MINI MUNDO');
    base.appendChild(nomeEl);
    base.appendChild(barra);
    const veu = el(doc, 'div', 'mnd-veu');
    veu.setAttribute('aria-hidden', 'true');
    const anel = el(doc, 'div', 'mnd-anel');
    anel.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16" fill="none" stroke="rgba(0,0,0,.4)" stroke-width="6"/>' +
      '<circle class="mnd-anel-p" cx="20" cy="20" r="16" fill="none" stroke="#ff6a4a" stroke-width="5" transform="rotate(-90 20 20)"/></svg>';
    const mira = el(doc, 'div', 'mnd-mira');
    const sr = el(doc, 'div', 'mnd-sr');
    sr.setAttribute('aria-live', 'polite');
    [ceuEl, noiteEl, canvas, mira, anel, topo, base, veu, sr].forEach(function (n) { root.appendChild(n); });
    containerEl.appendChild(root);

    /* ---------- estado ---------- */
    let alive = true;
    let visible = true;
    let estado = 'titulo';        // 'titulo' | 'jogando'
    let pausado = false, motivoPausa = null;
    let geracao = 0;              // muda a cada start/reset/dispose: detecta reentrância pelo onEvent
    let mundo, mundoSalvo = false;
    let slot = 0, ferramenta = 'por', noite = false, mixNoite = 0;
    const cam = { yaw: Math.PI / 4, pitch: 0.6, zoom: 1, tYaw: Math.PI / 4, tPitch: 0.6, tZoom: 1 };
    let distBase = 40;
    let raf = 0, lastT = null, quadros = 0, rebuilds = 0;
    let L = null;                 // { W, H, cw, ch, S, Sraw }
    let modoMira = false;         // teclado: a mira é o centro da tela
    let ultimoTipo = (global.matchMedia && global.matchMedia('(pointer: coarse)').matches) ? 'touch' : 'mouse';
    let mouseLocal = null;        // última posição do mouse em cima do canvas (px locais)
    let alvo = null;              // bloco na mira { x, y, z, b, n }
    let alvoChave = '';
    let salvarT = 0, sujo = false;
    let nomeT = 0, armadoT = 0, armado = false;
    let perdido = false, semWebGL = false;
    let salvaOk = podeSalvar();   // o navegador deixa gravar a ilha? (cada gravação confere de novo)
    const seg = { giro: 0, incl: 0, desde: 0 };       // teclas seguradas
    const segKeys = new Set();
    const dup = { key: null, src: null, t: -1, res: false };
    const ptrs = new Map();
    let pinca = null, longoT = 0, longoRaf = 0;
    const fagulhas = [];

    const mq = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let reduced = !!(mq && mq.matches);

    const salvo = lerSalvo();
    if (salvo) {
      mundo = salvo.mundo; mundoSalvo = true;
      noite = salvo.noite; slot = salvo.slot;
      if (salvo.cam.yaw !== null) cam.yaw = cam.tYaw = salvo.cam.yaw;
      if (salvo.cam.pitch !== null) cam.pitch = cam.tPitch = salvo.cam.pitch;
      if (salvo.cam.zoom !== null) cam.zoom = cam.tZoom = salvo.cam.zoom;
    } else {
      mundo = gerarIlha();
    }
    mixNoite = noite ? 1 : 0;

    /* ---------- WebGL ---------- */
    let renderer = null;
    if (THREE && THREE.WebGLRenderer) {
      try {
        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'low-power' });
      } catch (err) { renderer = null; }
    }
    if (!renderer) semWebGL = true;

    let cena = null, camera = null, textura = null, U = null, matSolido = null, matAgua = null, malhaSolida = null, malhaAgua = null;
    let contorno = null, matContorno = null, destaque = null, matDestaque = null, tinta = null, matTinta = null;
    let pontosFag = null, matFag = null, geoFag = null;
    let atlas = null;
    const raycaster = THREE ? new THREE.Raycaster() : null;
    const ndc = THREE ? new THREE.Vector2() : null;
    const ceu = new Uint8Array(N), luzB = new Uint8Array(N);
    const fila = new Int32Array(N * 16);

    if (!semWebGL) {
      renderer.setPixelRatio(1);
      renderer.setClearColor(0x000000, 0);
      cena = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(FOV, 1.4, 0.5, 300);
      atlas = pintarAtlas(doc);
      textura = new THREE.CanvasTexture(atlas.canvas);
      textura.magFilter = THREE.NearestFilter;
      textura.minFilter = THREE.NearestFilter;
      textura.generateMipmaps = false;
      U = { uMapa: { value: textura }, uCeu: { value: new THREE.Vector3(1, 1, 1) }, uLuz: { value: new THREE.Vector3(0, 0, 0) } };
      matSolido = new THREE.ShaderMaterial({
        uniforms: { uMapa: U.uMapa, uCeu: U.uCeu, uLuz: U.uLuz, uOpac: { value: 1 }, uCorte: { value: 0.5 } },
        vertexShader: VS, fragmentShader: FS
      });
      matAgua = new THREE.ShaderMaterial({
        uniforms: { uMapa: U.uMapa, uCeu: U.uCeu, uLuz: U.uLuz, uOpac: { value: 0.74 }, uCorte: { value: -1 } },
        vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false
      });
      malhaSolida = new THREE.Mesh(new THREE.BufferGeometry(), matSolido);
      malhaAgua = new THREE.Mesh(new THREE.BufferGeometry(), matAgua);
      malhaAgua.renderOrder = 1;
      cena.add(malhaSolida);
      cena.add(malhaAgua);
      montarMira3d();
      montarFagulhas();
      canvas.addEventListener('webglcontextlost', onContextLost, false);
      canvas.addEventListener('webglcontextrestored', onContextRestored, false);
    }

    /* ---------- luz (céu e lanterna), estilo Minecraft ---------- */
    function blocoEm(x, y, z) { return dentro(x, y, z) ? mundo[idx(x, y, z)] : AR; }
    function opacoEm(x, y, z) { return dentro(x, y, z) && OPACO[mundo[idx(x, y, z)]] ? 1 : 0; }
    function ceuEm(x, y, z) {
      if (dentro(x, y, z)) return ceu[idx(x, y, z)];
      return y < 0 ? 9 : 15;            // fora da ilha é ar aberto; embaixo, um pouco de sombra
    }
    function blocoLuzEm(x, y, z) { return dentro(x, y, z) ? luzB[idx(x, y, z)] : 0; }

    function espalhar(arr, fim) {
      let ini = 0;
      while (ini < fim) {
        const i = fila[ini++];
        const l = arr[i];
        if (l <= 1) continue;
        const x = i % S, z = ((i / S) | 0) % S, y = (i / (S * S)) | 0;
        for (let k = 0; k < 6; k++) {
          const nx = x + VIZ6[k][0], ny = y + VIZ6[k][1], nz = z + VIZ6[k][2];
          if (!dentro(nx, ny, nz)) continue;
          const j = idx(nx, ny, nz), b = mundo[j];
          if (OPACO[b]) continue;
          const nl = l - 1 - ATENUA[b];
          if (nl > arr[j] && fim < fila.length) { arr[j] = nl; fila[fim++] = j; }
        }
      }
    }
    function calcularLuz() {
      ceu.fill(0); luzB.fill(0);
      let fim = 0;
      for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
        const borda = x === 0 || z === 0 || x === S - 1 || z === S - 1;
        let l = 15;
        for (let y = H - 1; y >= 0; y--) {
          const i = idx(x, y, z), b = mundo[i];
          if (OPACO[b]) { l = 0; continue; }
          l = Math.max(0, l - ATENUA[b]);
          let v = l;
          if (borda && v < 14 - ATENUA[b]) v = 14 - ATENUA[b];    // o ar de fora da ilha é claro
          ceu[i] = v;
          if (v > 1) fila[fim++] = i;
        }
      }
      espalhar(ceu, fim);
      fim = 0;
      for (let i = 0; i < N; i++) if (mundo[i] === LANTERNA) { luzB[i] = 14; fila[fim++] = i; }
      espalhar(luzB, fim);
    }

    /* ---------- malha ---------- */
    function mostraFace(b, viz) {
      if (viz === AR) return true;
      if (b === AGUA) return false;            // água só aparece encostando no ar
      if (viz === AGUA) return true;           // o fundo do mar aparece debaixo d'água
      return !OPACO[viz];                      // folhas e ipê deixam ver o vizinho
    }
    function novoBuffer() { return { pos: [], uv: [], sombra: [], luz: [], ind: [] }; }
    const UVE = 0.004;   // recuo em fração de tile: o nearest não pega o tile vizinho na borda

    function montarMalha() {
      calcularLuz();
      const sol = novoBuffer(), ag = novoBuffer();
      const bri = [0, 0, 0, 0];
      for (let y = 0; y < H; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
        const b = mundo[idx(x, y, z)];
        if (!b) continue;
        const def = BLOCOS[b];
        const agua = b === AGUA;
        const brilha = b === LANTERNA;
        const aguaRasa = agua && blocoEm(x, y + 1, z) !== AGUA;
        for (let f = 0; f < 6; f++) {
          const F = FACES[f], n = F.n;
          const nx = x + n[0], ny = y + n[1], nz = z + n[2];
          if (!mostraFace(b, blocoEm(nx, ny, nz))) continue;
          const tile = n[1] > 0 ? def.topo : (n[1] < 0 ? def.base : def.lado);
          const col = tile & 3, row = tile >> 2;
          const B = agua ? ag : sol;
          const v0 = B.pos.length / 3;
          const ax = n[0] !== 0 ? 0 : (n[1] !== 0 ? 1 : 2);
          for (let k = 0; k < 4; k++) {
            const p = F.c[k];
            const py = (aguaRasa && p[1] === 1) ? y + 0.875 : y + p[1];
            B.pos.push(x + p[0], py, z + p[2]);
            B.uv.push((col + (p[3] ? 1 - UVE : UVE)) / 4, 1 - (row + (p[4] ? UVE : 1 - UVE)) / 4);
            let sombra, lc, lb;
            if (brilha) { sombra = 1; lc = 1; lb = 1.25; }
            else if (agua) {
              sombra = F.sombra;
              lc = CURVA_CEU[ceuEm(nx, ny, nz)]; lb = CURVA_BLOCO[blocoLuzEm(nx, ny, nz)];
            } else {
              // vizinhos do canto, do lado de fora da face
              let ax1 = 0, ay1 = 0, az1 = 0, ax2 = 0, ay2 = 0, az2 = 0;
              if (ax === 0) { ay1 = p[1] ? 1 : -1; az2 = p[2] ? 1 : -1; }
              else if (ax === 1) { ax1 = p[0] ? 1 : -1; az2 = p[2] ? 1 : -1; }
              else { ax1 = p[0] ? 1 : -1; ay2 = p[1] ? 1 : -1; }
              const o1 = opacoEm(nx + ax1, ny + ay1, nz + az1);
              const o2 = opacoEm(nx + ax2, ny + ay2, nz + az2);
              const oc = opacoEm(nx + ax1 + ax2, ny + ay1 + ay2, nz + az1 + az2);
              const ao = (o1 && o2) ? 0 : 3 - (o1 + o2 + oc);
              sombra = F.sombra * AO_CURVA[ao];
              // luz: média das células abertas em volta do canto
              let sc = CURVA_CEU[ceuEm(nx, ny, nz)], sb = CURVA_BLOCO[blocoLuzEm(nx, ny, nz)], cnt = 1;
              if (!o1) { sc += CURVA_CEU[ceuEm(nx + ax1, ny + ay1, nz + az1)]; sb += CURVA_BLOCO[blocoLuzEm(nx + ax1, ny + ay1, nz + az1)]; cnt++; }
              if (!o2) { sc += CURVA_CEU[ceuEm(nx + ax2, ny + ay2, nz + az2)]; sb += CURVA_BLOCO[blocoLuzEm(nx + ax2, ny + ay2, nz + az2)]; cnt++; }
              if (!oc && !(o1 && o2)) { sc += CURVA_CEU[ceuEm(nx + ax1 + ax2, ny + ay1 + ay2, nz + az1 + az2)]; sb += CURVA_BLOCO[blocoLuzEm(nx + ax1 + ax2, ny + ay1 + ay2, nz + az1 + az2)]; cnt++; }
              lc = sc / cnt; lb = sb / cnt;
            }
            B.sombra.push(sombra);
            B.luz.push(lc, lb);
            bri[k] = sombra * Math.max(lc, lb * 0.6);
          }
          // a diagonal liga o par mais claro: sem listras escuras atravessando a face
          if (bri[0] + bri[3] > bri[1] + bri[2]) B.ind.push(v0, v0 + 1, v0 + 3, v0, v0 + 3, v0 + 2);
          else B.ind.push(v0, v0 + 1, v0 + 2, v0 + 2, v0 + 1, v0 + 3);
        }
      }
      trocarGeo(malhaSolida, sol);
      trocarGeo(malhaAgua, ag);
      rebuilds++;
    }
    function trocarGeo(mesh, B) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
      g.setAttribute('aSombra', new THREE.Float32BufferAttribute(B.sombra, 1));
      g.setAttribute('aLuz', new THREE.Float32BufferAttribute(B.luz, 2));
      g.setIndex(B.ind);
      g.computeBoundingSphere();
      const old = mesh.geometry;
      mesh.geometry = g;
      if (old) old.dispose();
    }

    /* ---------- mira 3D: contorno do bloco, face onde o novo bloco gruda ---------- */
    function caixaEm(arr, ind, x0, y0, z0, x1, y1, z1) {
      const v = arr.length / 3;
      const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      P.forEach(function (p) { arr.push(p[0], p[1], p[2]); });
      [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]]
        .forEach(function (t) { ind.push(v + t[0], v + t[1], v + t[2]); });
    }
    function montarMira3d() {
      const pos = [], ind = [];
      const a = -0.012, b = 1.012, e = 0.034;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        const p = i ? b : a, q = j ? b : a;
        caixaEm(pos, ind, a - e, p - e, q - e, b + e, p + e, q + e);   // arestas em x
        caixaEm(pos, ind, p - e, a - e, q - e, p + e, b + e, q + e);   // em y
        caixaEm(pos, ind, p - e, q - e, a - e, p + e, q + e, b + e);   // em z
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(ind);
      matContorno = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide });
      contorno = new THREE.Mesh(g, matContorno);
      contorno.renderOrder = 3;
      contorno.visible = false;
      cena.add(contorno);
      matDestaque = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      destaque = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), matDestaque);
      destaque.renderOrder = 2;
      destaque.visible = false;
      cena.add(destaque);
      matTinta = new THREE.MeshBasicMaterial({ color: 0xff3b2b, transparent: true, opacity: 0.22, depthWrite: false });
      tinta = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), matTinta);
      tinta.renderOrder = 2;
      tinta.visible = false;
      cena.add(tinta);
    }
    function mostrarAlvo(h) {
      if (!contorno) return;
      if (!h || estado !== 'jogando' || pausado) { contorno.visible = destaque.visible = tinta.visible = false; return; }
      const quebra = ferramenta === 'quebrar';
      contorno.visible = true;
      contorno.position.set(h.x, h.y, h.z);
      matContorno.color.setHex(quebra ? 0xff4d3d : 0x111111);
      matContorno.opacity = quebra ? 0.9 : 0.72;
      tinta.visible = quebra;
      if (quebra) tinta.position.set(h.x + 0.5, h.y + 0.5, h.z + 0.5);
      destaque.visible = !quebra && !!h.n;
      if (destaque.visible) {
        const n = h.n;
        destaque.position.set(h.x + 0.5 + n[0] * 0.503, h.y + 0.5 + n[1] * 0.503, h.z + 0.5 + n[2] * 0.503);
        destaque.rotation.set(n[1] ? -Math.PI / 2 * n[1] : 0, n[0] ? Math.PI / 2 * n[0] : (n[2] < 0 ? Math.PI : 0), 0);
      }
    }

    /* ---------- fagulhas ao quebrar (quadradinhos que caem) ---------- */
    function montarFagulhas() {
      geoFag = new THREE.BufferGeometry();
      geoFag.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_FAG * 3), 3));
      geoFag.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_FAG * 3), 3));
      geoFag.setDrawRange(0, 0);
      matFag = new THREE.PointsMaterial({ size: 0.2 / Math.tan(FOV * Math.PI / 360), sizeAttenuation: true, vertexColors: true });
      pontosFag = new THREE.Points(geoFag, matFag);
      pontosFag.frustumCulled = false;
      pontosFag.renderOrder = 4;
      cena.add(pontosFag);
    }
    function soltarFagulhas(x, y, z, b) {
      if (reduced || !geoFag) return;
      const cor = atlas.media[BLOCOS[b].lado];
      const luz = 1 - mixNoite * 0.62;
      const r = Math.random;
      for (let k = 0; k < 12 && fagulhas.length < MAX_FAG; k++) {
        const f = 0.75 + r() * 0.4;
        fagulhas.push({
          x: x + 0.2 + r() * 0.6, y: y + 0.2 + r() * 0.6, z: z + 0.2 + r() * 0.6,
          vx: (r() - 0.5) * 3.2, vy: 1.2 + r() * 2.4, vz: (r() - 0.5) * 3.2,
          vida: 0.45 + r() * 0.35,
          c: [cor[0] * f * luz, cor[1] * f * luz, cor[2] * f * luz]
        });
      }
    }
    function atualizarFagulhas(dt) {
      if (!geoFag) return false;
      for (let i = fagulhas.length - 1; i >= 0; i--) {
        const p = fagulhas[i];
        p.vida -= dt;
        if (p.vida <= 0) { fagulhas.splice(i, 1); continue; }
        p.vy -= 14 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      }
      const pa = geoFag.attributes.position.array, ca = geoFag.attributes.color.array;
      fagulhas.forEach(function (p, i) { pa[i * 3] = p.x; pa[i * 3 + 1] = p.y; pa[i * 3 + 2] = p.z; ca[i * 3] = p.c[0]; ca[i * 3 + 1] = p.c[1]; ca[i * 3 + 2] = p.c[2]; });
      geoFag.attributes.position.needsUpdate = true;
      geoFag.attributes.color.needsUpdate = true;
      geoFag.setDrawRange(0, fagulhas.length);
      return fagulhas.length > 0;
    }

    /* ---------- mira: raio do clique até o primeiro bloco (DDA na grade) ---------- */
    function lancarRaio(o, d) {
      const O = [o.x, o.y, o.z], D = [d.x, d.y, d.z], HI = [S, H, S];
      let t0 = 0, t1 = 1e9, eixo = -1;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(D[a]) < 1e-9) { if (O[a] < 0 || O[a] > HI[a]) return null; continue; }
        let ta = (0 - O[a]) / D[a], tb = (HI[a] - O[a]) / D[a];
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        if (ta > t0) { t0 = ta; eixo = a; }
        if (tb < t1) t1 = tb;
        if (t0 > t1) return null;
      }
      const P = [0, 1, 2].map(function (a) { return O[a] + D[a] * (t0 + 1e-5); });
      const c = [0, 1, 2].map(function (a) { return clamp(Math.floor(P[a]), 0, HI[a] - 1); });
      const passo = D.map(function (v) { return v > 0 ? 1 : -1; });
      const tMax = [0, 1, 2].map(function (a) { return Math.abs(D[a]) < 1e-9 ? Infinity : ((c[a] + (passo[a] > 0 ? 1 : 0)) - O[a]) / D[a]; });
      const tDelta = D.map(function (v) { return Math.abs(v) < 1e-9 ? Infinity : Math.abs(1 / v); });
      let n = null;
      if (eixo >= 0) { n = [0, 0, 0]; n[eixo] = -passo[eixo]; }
      for (let k = 0; k < 3 * (S + H + S); k++) {
        if (!dentro(c[0], c[1], c[2])) return null;
        const b = mundo[idx(c[0], c[1], c[2])];
        if (b && b !== AGUA) return n ? { x: c[0], y: c[1], z: c[2], b: b, n: n } : null;   // a água não segura a mira
        let a = 0;
        if (tMax[1] < tMax[a]) a = 1;
        if (tMax[2] < tMax[a]) a = 2;
        c[a] += passo[a];
        tMax[a] += tDelta[a];
        n = [0, 0, 0]; n[a] = -passo[a];
      }
      return null;
    }
    // px locais do canvas (offsetX/offsetY) -> pixels do canvas -> coordenadas normalizadas -> raio
    function mirar(lx, ly) {
      if (!camera || !L) return null;
      const cw = canvas.clientWidth || L.cw, ch = canvas.clientHeight || L.ch;
      if (!cw || !ch) return null;
      const px = lx * canvas.width / cw, py = ly * canvas.height / ch;
      ndc.set(px / canvas.width * 2 - 1, -(py / canvas.height) * 2 + 1);
      aplicarCamera();
      raycaster.setFromCamera(ndc, camera);
      return lancarRaio(raycaster.ray.origin, raycaster.ray.direction);
    }
    function alvoAtual() {
      if (estado !== 'jogando' || pausado) return null;
      if (modoMira) return mirar((canvas.clientWidth || 0) / 2, (canvas.clientHeight || 0) / 2);
      if (mouseLocal && !ptrs.size) return mirar(mouseLocal[0], mouseLocal[1]);
      return null;
    }
    function chaveDe(h) { return h ? h.x + ',' + h.y + ',' + h.z + ':' + (h.n ? h.n.join('') : '') : ''; }

    /* ---------- câmera ---------- */
    function aplicarCamera() {
      if (!camera) return;
      const dist = distBase * cam.zoom;
      const cp = Math.cos(cam.pitch);
      camera.position.set(ALVO[0] + Math.sin(cam.yaw) * cp * dist, ALVO[1] + Math.sin(cam.pitch) * dist, ALVO[2] + Math.cos(cam.yaw) * cp * dist);
      camera.lookAt(ALVO[0], ALVO[1], ALVO[2]);
      camera.updateMatrixWorld();
    }
    function suavizar(dt) {
      if (reduced) { cam.yaw = cam.tYaw; cam.pitch = cam.tPitch; cam.zoom = cam.tZoom; return false; }
      const k = 1 - Math.exp(-dt * 14);
      cam.yaw += (cam.tYaw - cam.yaw) * k;
      cam.pitch += (cam.tPitch - cam.pitch) * k;
      cam.zoom += (cam.tZoom - cam.zoom) * k;
      const longe = Math.abs(cam.tYaw - cam.yaw) > 1e-4 || Math.abs(cam.tPitch - cam.pitch) > 1e-4 || Math.abs(cam.tZoom - cam.zoom) > 1e-4;
      if (!longe) { cam.yaw = cam.tYaw; cam.pitch = cam.tPitch; cam.zoom = cam.tZoom; }
      return longe;
    }
    function girar(dYaw, dPitch, direto) {
      cam.tYaw += dYaw;
      cam.tPitch = clamp(cam.tPitch + dPitch, PITCH_MIN, PITCH_MAX);
      if (direto) { cam.yaw = cam.tYaw; cam.pitch = cam.tPitch; }
      agendarSalvar(false);
      pedirQuadro();
    }
    function aproximar(f, direto) {
      cam.tZoom = clamp(cam.tZoom * f, ZOOM_MIN, ZOOM_MAX);
      if (direto) cam.zoom = cam.tZoom;
      agendarSalvar(false);
      pedirQuadro();
    }

    /* ---------- dia e noite ---------- */
    function aplicarCeu() {
      if (!U) return;
      const m = mixNoite;
      U.uCeu.value.set(DIA.ceu[0] + (NOITE.ceu[0] - DIA.ceu[0]) * m, DIA.ceu[1] + (NOITE.ceu[1] - DIA.ceu[1]) * m, DIA.ceu[2] + (NOITE.ceu[2] - DIA.ceu[2]) * m);
      U.uLuz.value.set(DIA.luz[0] + (NOITE.luz[0] - DIA.luz[0]) * m, DIA.luz[1] + (NOITE.luz[1] - DIA.luz[1]) * m, DIA.luz[2] + (NOITE.luz[2] - DIA.luz[2]) * m);
    }
    function atualizarCeu(dt) {
      const alvoM = noite ? 1 : 0;
      if (mixNoite === alvoM) return false;
      if (reduced) mixNoite = alvoM;
      else {
        const v = dt / 0.7;
        mixNoite = alvoM > mixNoite ? Math.min(alvoM, mixNoite + v) : Math.max(alvoM, mixNoite - v);
      }
      aplicarCeu();
      return mixNoite !== alvoM;
    }
    function rotularBotoes() {
      btnNoite.innerHTML = (noite ? ICON.sol : ICON.lua) + '<span>' + (noite ? 'DIA' : 'NOITE') + '</span>';
      btnNoite.setAttribute('aria-label', noite ? 'Virar dia (tecla N)' : 'Virar noite (tecla N)');
      btnNoite.title = btnNoite.getAttribute('aria-label');
      btnRefaz.innerHTML = ICON.refaz + '<span>' + (armado ? 'CERTEZA?' : 'RECOMEÇAR') + '</span>';
      btnRefaz.setAttribute('aria-label', armado ? 'Confirmar: recomeçar a ilha do zero' : 'Recomeçar a ilha');
      btnRefaz.title = btnRefaz.getAttribute('aria-label');
      btnRefaz.classList.toggle('is-armado', armado);
      root.classList.toggle('mnd--noite', noite);
    }
    function alternarNoite() {
      if (!podeJogar()) return false;
      noite = !noite;
      rotularBotoes();
      anunciar(noite ? 'Noite. As lanternas acendem.' : 'Dia.');
      agendarSalvar(true);
      pedirQuadro();
      const gen = geracao;
      emit('daynight', { noite: noite });
      if (gen !== geracao || !alive) return true;
      return true;
    }

    /* ---------- barra de blocos ---------- */
    const slotBtns = [];
    BARRA.forEach(function (b, i) {
      const bt = el(doc, 'button', 'mnd-slot');
      bt.type = 'button';
      const src = atlas ? iconeBloco(doc, atlas.canvas, b) : '';
      bt.innerHTML = (src ? '<img alt="" draggable="false" src="' + src + '">' : '') + '<span class="mnd-num" aria-hidden="true">' + (i + 1) + '</span>';
      bt.setAttribute('aria-label', BLOCOS[b].rotulo.toLowerCase() + ' (tecla ' + (i + 1) + ')');
      bt.title = BLOCOS[b].rotulo + '  [' + (i + 1) + ']';
      bt.dataset.slot = String(i);
      barra.appendChild(bt);
      slotBtns.push(bt);
    });
    const sep = el(doc, 'span', 'mnd-sep');
    sep.setAttribute('aria-hidden', 'true');
    barra.appendChild(sep);
    const btnPica = el(doc, 'button', 'mnd-slot mnd-slot--ferramenta');
    btnPica.type = 'button';
    btnPica.innerHTML = ICON.picareta + '<span class="mnd-num" aria-hidden="true">9</span>';
    btnPica.setAttribute('aria-label', 'Picareta: quebrar blocos (tecla 9 ou X)');
    btnPica.title = 'QUEBRAR  [9 / X]';
    barra.appendChild(btnPica);

    function marcarBarra() {
      slotBtns.forEach(function (bt, i) {
        const sel = ferramenta === 'por' && i === slot;
        bt.classList.toggle('is-sel', sel);
        bt.setAttribute('aria-pressed', sel ? 'true' : 'false');
      });
      const q = ferramenta === 'quebrar';
      btnPica.classList.toggle('is-sel', q);
      btnPica.setAttribute('aria-pressed', q ? 'true' : 'false');
      root.classList.toggle('mnd--quebrar', q);
    }
    function mostrarNome(txt, aviso) {
      nomeEl.textContent = txt;
      nomeEl.classList.toggle('is-aviso', !!aviso);
      nomeEl.classList.add('is-on');
      if (nomeT) global.clearTimeout(nomeT);
      nomeT = global.setTimeout(function () { nomeT = 0; nomeEl.classList.remove('is-on'); }, aviso ? 1800 : 1300);
    }
    function escolher(i, ferr) {
      if (!podeJogar()) return false;
      const antes = ferramenta + ':' + slot;
      if (ferr === 'quebrar') ferramenta = 'quebrar';
      else { ferramenta = 'por'; slot = clamp(i, 0, BARRA.length - 1); }
      marcarBarra();
      const rot = ferramenta === 'quebrar' ? 'PICARETA' : BLOCOS[BARRA[slot]].rotulo;
      mostrarNome(rot, false);
      if (antes === ferramenta + ':' + slot) { pedirQuadro(); return true; }
      anunciar(ferramenta === 'quebrar' ? 'Picareta: clique tira blocos.' : 'Bloco: ' + BLOCOS[BARRA[slot]].rotulo.toLowerCase() + '.');
      agendarSalvar(false);
      pedirQuadro();
      emit('pick', ferramenta === 'quebrar' ? { slot: 8, bloco: null, ferramenta: 'quebrar' } : { slot: slot, bloco: BLOCOS[BARRA[slot]].nome, ferramenta: 'por' });
      return true;
    }

    /* ---------- pôr e tirar ---------- */
    // Com o contexto WebGL perdido (véu "UM INSTANTE") nada entra: nem clique, nem tecla.
    function podeJogar() { return alive && !semWebGL && !perdido && estado === 'jogando' && !pausado; }
    function porNoAlvo(h) {
      if (!podeJogar()) return false;
      if (!h) return false;
      if (!h.n) return false;
      const x = h.x + h.n[0], y = h.y + h.n[1], z = h.z + h.n[2];
      if (!dentro(x, y, z)) { mostrarNome(y >= H ? 'ALTO DEMAIS' : 'FORA DA ILHA', true); return false; }
      const i = idx(x, y, z);
      if (mundo[i] !== AR && mundo[i] !== AGUA) return false;
      const b = BARRA[slot];
      mundo[i] = b;
      mudou();
      anunciar(BLOCOS[b].rotulo.toLowerCase() + ' colocado.');
      const gen = geracao;
      emit('place', { x: x, y: y, z: z, bloco: BLOCOS[b].nome });
      if (gen !== geracao || !alive) return true;
      return true;
    }
    function quebrarAlvo(h) {
      if (!podeJogar()) return false;
      if (!h) return false;
      if (h.y === 0) { mostrarNome('A BASE DA ILHA NÃO SAI', true); return false; }
      const i = idx(h.x, h.y, h.z), b = mundo[i];
      if (!b || b === AGUA) return false;
      mundo[i] = AR;
      inundar(h.x, h.y, h.z);
      soltarFagulhas(h.x, h.y, h.z, b);
      mudou();
      anunciar(BLOCOS[b].rotulo.toLowerCase() + ' tirado.');
      const gen = geracao;
      emit('break', { x: h.x, y: h.y, z: h.z, bloco: BLOCOS[b].nome });
      if (gen !== geracao || !alive) return true;
      return true;
    }
    // Buraco encostado no mar (até o nível da água) se enche, e a água desce pelo buraco.
    function inundar(x, y, z) {
      if (y > NIVEL_AGUA) return;
      const temAgua = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].some(function (d) { return blocoEm(x + d[0], y + d[1], z + d[2]) === AGUA; });
      if (!temAgua) return;
      const q = [[x, y, z]];
      let n = 0;
      while (q.length && n < 160) {
        const p = q.shift();
        const i = idx(p[0], p[1], p[2]);
        if (mundo[i] !== AR) continue;
        mundo[i] = AGUA; n++;
        [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]].forEach(function (d) {
          const a = p[0] + d[0], b2 = p[1] + d[1], c = p[2] + d[2];
          if (dentro(a, b2, c) && b2 <= NIVEL_AGUA && mundo[idx(a, b2, c)] === AR) q.push([a, b2, c]);
        });
      }
    }
    function mudou() {
      montarMalha();
      agendarSalvar(true);
      alvoChave = '';
      pedirQuadro();
    }
    function contarBlocos() {
      let n = 0;
      for (let i = 0; i < N; i++) if (mundo[i] && mundo[i] !== AGUA) n++;
      return n;
    }

    /* ---------- salvar ---------- */
    function salvarAgora() {
      if (salvarT) { global.clearTimeout(salvarT); salvarT = 0; }
      if (!sujo) return;
      sujo = false;
      const ok = gravar({ v: 1, s: S, h: H, rle: rle(mundo), noite: noite, slot: slot,
        cam: { yaw: Math.round(cam.tYaw * 1000) / 1000, pitch: Math.round(cam.tPitch * 1000) / 1000, zoom: Math.round(cam.tZoom * 1000) / 1000 } });
      if (ok) mundoSalvo = true;
      if (ok !== salvaOk) {
        salvaOk = ok;
        anunciar(ok ? 'A ilha voltou a ser salva neste navegador.' : 'Este navegador não deixa salvar a ilha.');
        if (alive) emit('save', { ok: ok });
      }
    }
    function agendarSalvar(mundoMudou) {
      if (semWebGL) return;
      sujo = true;
      if (salvarT) global.clearTimeout(salvarT);
      salvarT = global.setTimeout(function () { salvarT = 0; if (alive) salvarAgora(); }, mundoMudou ? 500 : 1200);
    }
    function recomecar() {
      if (!alive || semWebGL || estado !== 'jogando') return false;
      desarmar();
      geracao++;
      const gen = geracao;
      mundo = gerarIlha();
      apagarSalvo();
      mundoSalvo = false;
      sujo = false;
      if (salvarT) { global.clearTimeout(salvarT); salvarT = 0; }
      fagulhas.length = 0;
      cam.tYaw = Math.PI / 4; cam.tPitch = 0.6; cam.tZoom = 1;
      if (reduced) { cam.yaw = cam.tYaw; cam.pitch = cam.tPitch; cam.zoom = cam.tZoom; }
      montarMalha();
      alvoChave = '';
      anunciar('Ilha recomeçada.');
      mostrarNome('ILHA NOVA', false);
      pedirQuadro();
      emit('reset', {});
      if (gen !== geracao || !alive) return true;
      return true;
    }
    function armar() {
      armado = true;
      rotularBotoes();
      if (armadoT) global.clearTimeout(armadoT);
      armadoT = global.setTimeout(function () { armadoT = 0; if (alive) desarmar(); }, 3000);
      anunciar('Aperte de novo para recomeçar a ilha do zero.');
    }
    function desarmar() {
      if (armadoT) { global.clearTimeout(armadoT); armadoT = 0; }
      if (!armado) return;
      armado = false;
      rotularBotoes();
    }

    /* ---------- partida ---------- */
    function startGame() {
      if (semWebGL) return;
      geracao++;
      const gen = geracao;
      estado = 'jogando';
      pausado = false; motivoPausa = null;
      soltarTudo();
      atualizarVeu();
      maybeRescale();
      anunciar('MINI MUNDO. Clique põe, clique direito tira.');
      emit('start', { mundoSalvo: mundoSalvo, blocos: contarBlocos(), noite: noite });
      if (gen !== geracao || !alive) return;
      // Começou com o jogo escondido: já nasce pausado (volta sozinho quando aparecer).
      if (!visible || doc.hidden) { pauseGame(!visible ? 'oculto' : 'aba'); return; }
      pedirQuadro();
    }
    function pauseGame(motivo) {
      if (estado !== 'jogando' || pausado) return false;
      pausado = true;
      motivoPausa = motivo || 'jogador';
      soltarTudo();
      cancelarPonteiros();
      salvarAgora();
      atualizarVeu();
      mostrarAlvo(null);
      anunciar('Pausado.');
      emit('pause', { motivo: motivoPausa });
      if (alive && !raf) desenharJa();
      return true;
    }
    function resumeGame() {
      if (estado !== 'jogando' || !pausado) return false;
      if (!visible || doc.hidden) return false;
      pausado = false; motivoPausa = null;
      atualizarVeu();
      maybeRescale();
      anunciar('Continuando.');
      const gen = geracao;
      emit('resume', {});
      if (gen !== geracao || !alive) return true;
      alvoChave = '';
      pedirQuadro();
      return true;
    }
    function autoRetomar() {
      if (pausado && (motivoPausa === 'oculto' || motivoPausa === 'aba')) resumeGame();
    }
    function atualizarVeu() {
      let a = '', b = '';
      if (semWebGL) { a = 'MINI MUNDO'; b = 'este navegador não desenha 3D (WebGL).'; }
      else if (perdido) { a = 'UM INSTANTE'; b = 'a placa de vídeo cochilou. voltando…'; }
      else if (estado === 'titulo') { a = 'MINI MUNDO'; b = 'clique ou Enter para começar'; }
      else if (pausado && motivoPausa !== 'oculto' && motivoPausa !== 'aba') { a = 'PAUSADO'; b = 'clique ou Enter para continuar'; }
      veu.classList.toggle('is-on', !!a);
      if (a) veu.innerHTML = '<strong>' + a + '</strong><span>' + b + '</span>';
    }
    function atualizarDica() {
      dica.innerHTML = ultimoTipo === 'touch'
        ? '<b>toque</b> põe · <b>segure</b> tira · <b>arraste</b> gira · <b>pinça</b> zoom'
        : '<b>clique</b> põe · <b>direito</b>/<b>Shift</b> tira · <b>arraste</b> gira · <b>roda</b> zoom';
    }

    /* ---------- laço (só enquanto algo anda) ---------- */
    function podeDesenhar() { return alive && !semWebGL && !perdido && visible && !doc.hidden && !!L; }
    function pedirQuadro() {
      if (!raf && podeDesenhar()) { raf = global.requestAnimationFrame(quadro); }
    }
    function parar() {
      if (raf) global.cancelAnimationFrame(raf);
      raf = 0; lastT = null;
    }
    function quadro(ts) {
      raf = 0;
      if (!podeDesenhar()) { lastT = null; return; }
      const dt = lastT === null ? 1 / 60 : Math.min(0.05, Math.max(0, (ts - lastT) / 1000));
      lastT = ts;
      let anima = false;
      // teclas seguradas: depois da espera, gira sem parar
      if ((seg.giro || seg.incl) && podeJogar()) {
        if (now() - seg.desde > ESPERA_SEGURAR * 1000) {
          cam.tYaw += seg.giro * VEL_GIRO * dt;
          cam.tPitch = clamp(cam.tPitch + seg.incl * VEL_INCL * dt, PITCH_MIN, PITCH_MAX);
          agendarSalvar(false);
        }
        anima = true;
      }
      if (suavizar(dt)) anima = true;
      if (atualizarFagulhas(dt)) anima = true;
      if (atualizarCeu(dt)) anima = true;
      desenharJa();
      if (anima && podeDesenhar()) raf = global.requestAnimationFrame(quadro);
      else lastT = null;
    }
    function desenharJa() {
      if (!podeDesenhar()) return;
      aplicarCamera();
      const h = alvoAtual();
      alvo = h;
      alvoChave = chaveDe(h);
      mostrarAlvo(h);
      root.classList.toggle('mnd--mira', modoMira && podeJogar());
      try { renderer.render(cena, camera); } catch (err) { if (global.console) global.console.warn('[MINI MUNDO] desenho falhou:', err); }
      quadros++;
    }

    function anunciar(t) { sr.textContent = t; }
    function emit(kind, detail) {
      if (typeof opts.onEvent !== 'function') return;
      try { opts.onEvent(kind, detail); } catch (err) { if (global.console) global.console.warn('[MINI MUNDO] onEvent falhou:', err); }
    }

    /* ---------- tamanho e nitidez ---------- */
    function backingRatio() {
      const dpr = global.devicePixelRatio || 1;
      let proj = 1;
      // Dentro do matrix3d (ou girado no ampliado) o canvas aparece noutra escala:
      // a área real na tela dá a escala média sem depender da rotação.
      try {
        const r = root.getBoundingClientRect();
        const a = root.offsetWidth * root.offsetHeight;
        if (a > 0 && r.width > 0 && r.height > 0 && isFinite(r.width)) proj = Math.sqrt((r.width * r.height) / a);
      } catch (err) { proj = 1; }
      // menor que 1 também vale (o monitor mostra o jogo reduzido): não desenha pixel que
      // ninguém vê; a folga de 10% cobre o lado do quadro mais perto da câmera.
      proj = clamp(proj, 0.5, 2.5);
      return clamp(dpr * proj * 1.1, 1, 2.5);
    }
    function relayout() {
      const narrow = root.clientWidth > 0 && root.clientWidth < NARROW_PX;
      if (root.classList.contains('mnd--estreito') !== narrow) root.classList.toggle('mnd--estreito', narrow);
      // lado máximo de cada slot para a barra (9 slots + separador + bordas) caber na largura
      if (root.clientWidth > 0) {
        const cabe = Math.max(40, Math.floor((root.clientWidth - 8 - 6 - 10) / (BARRA.length + 1))) + 'px';   // folga, separador, moldura
        if (root.style.getPropertyValue('--mnd-cabe') !== cabe) root.style.setProperty('--mnd-cabe', cabe);
      }
      const cw = root.clientWidth, ch = root.clientHeight;
      if (!cw || !ch || semWebGL) { L = null; return; }
      const Sraw = backingRatio();
      let Sc = Sraw;
      if (cw * ch * Sc * Sc > MAX_BACKING_PX) Sc = Math.max(1, Math.sqrt(MAX_BACKING_PX / (cw * ch)));
      const W = Math.max(1, Math.round(cw * Sc)), Hh = Math.max(1, Math.round(ch * Sc));
      if (canvas.width !== W || canvas.height !== Hh) renderer.setSize(W, Hh, false);
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
      const tv = Math.tan(FOV * Math.PI / 360);
      distBase = RAIO_CABE / Math.min(tv, tv * camera.aspect);
      L = { W: W, H: Hh, cw: cw, ch: ch, S: Sc, Sraw: Sraw };
    }
    function maybeRescale() {
      if (!L) { relayout(); return; }
      const s = backingRatio();
      if (Math.abs(s - L.Sraw) / L.Sraw > 0.12) { relayout(); pedirQuadro(); }
    }

    /* ---------- entrada: teclado ---------- */
    function soltarTudo() { seg.giro = 0; seg.incl = 0; segKeys.clear(); }
    function atualizarSeg() {
      let g = 0, i = 0;
      segKeys.forEach(function (a) {
        if (a === 'giraEsq') g -= 1; else if (a === 'giraDir') g += 1;
        else if (a === 'sobe') i += 1; else if (a === 'desce') i -= 1;
      });
      seg.giro = clamp(g, -1, 1); seg.incl = clamp(i, -1, 1);
    }
    // mode: 'tap' (um passo) | 'hold' (segura até soltar)
    function doAction(a, mode) {
      if (perdido) return false;          // esperando a placa de vídeo voltar
      if (estado === 'titulo') {
        if (a === 'por') { startGame(); return true; }
        return false;
      }
      if (pausado) {
        if (a === 'por' || a === 'pausa') return resumeGame();
        return false;
      }
      if (!podeJogar()) return false;
      switch (a) {
        case 'giraEsq': case 'giraDir': case 'sobe': case 'desce': {
          modoMira = true;
          const gy = a === 'giraEsq' ? -1 : a === 'giraDir' ? 1 : 0;
          const inc = a === 'sobe' ? 1 : a === 'desce' ? -1 : 0;
          if (mode === 'hold') {
            if (segKeys.has(a)) return true;            // repetição do sistema: o laço já gira
            segKeys.add(a); seg.desde = now(); atualizarSeg();
          }
          girar(gy * PASSO_GIRO, inc * PASSO_INCL, false);
          return true;
        }
        case 'perto': modoMira = true; aproximar(0.86, false); return true;
        case 'longe': modoMira = true; aproximar(1 / 0.86, false); return true;
        case 'ferramenta': return escolher(slot, 'quebrar');
        case 'alternaFerramenta': return escolher(slot, ferramenta === 'quebrar' ? 'por' : 'quebrar');
        case 'noite': return alternarNoite();
        case 'pausa': pauseGame('jogador'); return true;
        case 'por': case 'quebrar': {
          modoMira = modoMira || !mouseLocal;
          aplicarCamera();
          const h = alvoAtual();
          if (a === 'quebrar' || ferramenta === 'quebrar') quebrarAlvo(h); else porNoAlvo(h);
          pedirQuadro();
          return true;
        }
        default:
          if (a.indexOf('slot') === 0) return escolher(Number(a.slice(4)) - 1, 'por');
      }
      return false;
    }
    function release(a) {
      if (segKeys.delete(a)) atualizarSeg();
    }
    function gameKeyLive(a) { return podeJogar() && !!a; }
    function isDuplicate(key, src) {
      const t = now();
      if (dup.key === key && dup.src !== src && t - dup.t < DUP_WINDOW_MS) { dup.key = null; return true; }
      dup.key = key; dup.src = src; dup.t = t;
      return false;
    }
    function handleKey(key, phase) {
      if (!alive || typeof key !== 'string') return false;
      const a = actionFor(key);
      if (!a) return false;
      if (phase === 'up') { release(a); return gameKeyLive(a); }
      if (isDuplicate(key, 'ext')) return dup.res;
      const used = doAction(a, phase === 'down' ? 'hold' : 'tap');
      dup.res = used;
      return used;
    }
    function onKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Enter/Espaço num botão focado ativam o botão (o navegador cuida)
      if ((e.key === 'Enter' || e.key === ' ') && e.target !== canvas && e.target.closest && e.target.closest('button')) return;
      const a = actionFor(e.key);
      if (!a) return;
      let used;
      if (isDuplicate(e.key, 'dom')) used = dup.res;
      else if (e.repeat) used = (a === 'perto' || a === 'longe') ? doAction(a, 'tap') : gameKeyLive(a);   // o laço já cuida do giro segurado
      else used = doAction(a, 'hold');
      dup.res = used;
      if (used) { e.preventDefault(); e.stopPropagation(); }
    }
    function onKeyUp(e) {
      const a = actionFor(e.key);
      if (!a) return;
      release(a);
      if (gameKeyLive(a)) e.stopPropagation();
    }
    function onFocusOut(e) {
      if (!e.relatedTarget || !root.contains(e.relatedTarget)) soltarTudo();
    }
    function focusCanvas() {
      try { canvas.focus({ preventScroll: true }); } catch (err) { canvas.focus(); }
    }

    /* ---------- entrada: ponteiro (mouse, toque, caneta) ---------- */
    // Coordenadas locais do canvas: offsetX/offsetY (o navegador já desfaz o matrix3d).
    function local(e) { return [e.offsetX, e.offsetY]; }
    function cancelarLongo() {
      if (longoT) { global.clearTimeout(longoT); longoT = 0; }
      if (longoRaf) { global.cancelAnimationFrame(longoRaf); longoRaf = 0; }
      anel.classList.remove('is-on');
    }
    function cancelarPonteiros() {
      cancelarLongo();
      ptrs.forEach(function (p, id) { try { canvas.releasePointerCapture(id); } catch (err) { /* já solto */ } });
      ptrs.clear();
      pinca = null;
    }
    function trocarTipo(t) {
      const tipo = t === 'mouse' ? 'mouse' : 'touch';
      if (tipo !== ultimoTipo) { ultimoTipo = tipo; atualizarDica(); }
    }
    function onPointerDown(e) {
      if (!alive || e.target !== canvas) return;
      trocarTipo(e.pointerType);
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
      // Com mouse o próprio clique foca o canvas (sem anel de foco); focar antes por script
      // faria o Chrome tratar como foco de teclado e acender o contorno amarelo.
      if (e.pointerType !== 'mouse') focusCanvas();
      if (perdido) return;
      if (estado === 'titulo') { startGame(); return; }
      if (pausado) { resumeGame(); return; }
      if (!podeJogar()) return;
      const q = local(e);
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* sem captura: segue */ }
      const p = { x: q[0], y: q[1], x0: q[0], y0: q[1], t0: e.timeStamp, botao: e.button, shift: e.shiftKey, tipo: e.pointerType || 'mouse', moveu: false, feito: false };
      ptrs.set(e.pointerId, p);
      if (e.pointerType === 'mouse') modoMira = false;
      if (ptrs.size === 1 && p.tipo !== 'mouse') {
        // toque longo = quebrar (com o anel enchendo no lugar do dedo)
        anel.style.transform = 'translate(' + Math.round(q[0]) + 'px,' + Math.round(q[1]) + 'px)';
        anel.classList.remove('is-on');
        void anel.offsetWidth;   // reinicia a animação do anel
        anel.classList.add('is-on');
        // O tempo vence, mas a decisão espera dois quadros: com o celular engasgado (quadro de
        // 600 ms), o "soltar" ou o arrasto que ficaram na fila chegam antes e um toque curto não
        // vira quebra por engano. Num celular normal isso são uns 33 ms a mais.
        longoT = global.setTimeout(function () {
          longoT = 0;
          let n = 0;
          const confere = function () {
            longoRaf = 0;
            if (!alive || !ptrs.has(e.pointerId) || p.moveu || ptrs.size !== 1) { anel.classList.remove('is-on'); return; }
            if (++n < 2) { longoRaf = global.requestAnimationFrame(confere); return; }
            anel.classList.remove('is-on');
            p.feito = true;
            quebrarAlvo(mirar(p.x0, p.y0));
            try { if (global.navigator && global.navigator.vibrate) global.navigator.vibrate(12); } catch (err) { /* sem vibração */ }
          };
          longoRaf = global.requestAnimationFrame(confere);
        }, LONGO_MS);
      } else if (ptrs.size >= 2) {
        cancelarLongo();
        ptrs.forEach(function (o) { o.moveu = true; });
        pinca = null;
      }
      pedirQuadro();
    }
    function vao() {
      const ps = Array.from(ptrs.values());
      const a = ps[0], b = ps[1];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
    function onPointerMove(e) {
      if (!alive) return;
      const p = ptrs.get(e.pointerId);
      if (!p) {
        if (e.target !== canvas) return;
        if (e.pointerType === 'mouse' || !e.pointerType) {
          mouseLocal = local(e);
          if (modoMira) modoMira = false;
          if (!podeJogar()) return;
          const k = chaveDe(mirar(mouseLocal[0], mouseLocal[1]));
          if (k !== alvoChave) pedirQuadro();
        }
        return;
      }
      const q = local(e);
      const cw = canvas.clientWidth || 1, ch = canvas.clientHeight || 1;
      if (ptrs.size === 1) {
        const dx = q[0] - p.x, dy = q[1] - p.y;
        const folga = p.tipo === 'mouse' ? FOLGA_MOUSE : FOLGA_TOQUE;
        if (!p.moveu && Math.hypot(q[0] - p.x0, q[1] - p.y0) > folga) { p.moveu = true; cancelarLongo(); }
        if (p.moveu) girar(-dx * (2.8 / cw), dy * (2.2 / ch), true);
        p.x = q[0]; p.y = q[1];
        if (p.tipo === 'mouse') mouseLocal = q;
      } else {
        p.x = q[0]; p.y = q[1];
        const v = vao();
        if (pinca && v.d > 4 && pinca.d > 4) {
          aproximar(pinca.d / v.d, true);
          girar(-(v.mx - pinca.mx) * (2.8 / cw), (v.my - pinca.my) * (2.2 / ch), true);
        }
        pinca = v;
      }
    }
    function onPointerUp(e) {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      ptrs.delete(e.pointerId);
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* já solto */ }
      if (ptrs.size < 2) pinca = null;
      cancelarLongo();
      if (e.type === 'pointercancel' || !alive) return;
      if (!p.moveu && !p.feito && podeJogar()) {
        const q = local(e);
        // o ponto de origem vale mais que o de soltura (dedo escorrega um pouco)
        const h = mirar(p.x0, p.y0);
        if (p.tipo === 'mouse') {
          if (p.botao === 2 || p.shift || ferramenta === 'quebrar') quebrarAlvo(h); else porNoAlvo(h);
          mouseLocal = q;
        } else if (ferramenta === 'quebrar' || (e.timeStamp - p.t0) >= LONGO_MS) quebrarAlvo(h);   // segurou (pelo relógio do evento)
        else porNoAlvo(h);
      }
      pedirQuadro();
    }
    function onPointerLeave(e) {
      if (e.pointerType === 'mouse' && !ptrs.size) { mouseLocal = null; pedirQuadro(); }
    }
    function onWheel(e) {
      if (!podeJogar()) return;
      e.preventDefault();
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= 400;
      dy = clamp(dy, -240, 240);
      aproximar(Math.exp(dy * (e.ctrlKey ? 0.006 : 0.0016)), false);
    }
    function onContextMenu(e) { e.preventDefault(); }

    /* ---------- botões ---------- */
    function botao(bt, fn) {
      // pointerdown não rouba o foco do mundo; o clique (mouse, toque ou teclado) faz a ação
      bt.addEventListener('pointerdown', function (e) { if (e.pointerType === 'mouse' && e.button !== 0) return; e.preventDefault(); trocarTipo(e.pointerType); });
      bt.addEventListener('click', function (e) {
        e.preventDefault();
        if (!alive) return;
        if (estado === 'titulo') { startGame(); if (!podeJogar()) return; }
        else if (pausado && !resumeGame()) return;
        fn();
      });
      bt.addEventListener('contextmenu', onContextMenu);
    }
    slotBtns.forEach(function (bt, i) { botao(bt, function () { escolher(i, 'por'); }); });
    botao(btnPica, function () { escolher(slot, ferramenta === 'quebrar' ? 'por' : 'quebrar'); });
    botao(btnNoite, function () { alternarNoite(); });
    botao(btnRefaz, function () { if (armado) recomecar(); else armar(); });

    /* ---------- perda de contexto ---------- */
    function onContextLost(e) {
      e.preventDefault();
      perdido = true;
      parar();
      soltarTudo();
      cancelarPonteiros();
      atualizarVeu();
    }
    // Os buffers, VAOs e a textura de antes morreram com o contexto velho: dispose neles
    // só daria "INVALID_OPERATION: delete: object does not belong to this context".
    // As malhas ganham geometrias novas (as velhas são largadas, sem dispose) e o
    // three sobe tudo de novo no contexto que voltou.
    function renovarGpu() {
      malhaSolida.geometry = new THREE.BufferGeometry();     // montarMalha() refaz as duas
      malhaAgua.geometry = new THREE.BufferGeometry();
      contorno.geometry = contorno.geometry.clone();
      destaque.geometry = destaque.geometry.clone();
      tinta.geometry = tinta.geometry.clone();
      geoFag = geoFag.clone();
      pontosFag.geometry = geoFag;
      const nova = textura.clone();
      nova.needsUpdate = true;
      textura = nova;
      U.uMapa.value = nova;
    }
    function onContextRestored() {
      if (!alive) return;
      perdido = false;
      renovarGpu();
      relayout();
      montarMalha();
      atualizarVeu();
      pedirQuadro();
    }

    /* ---------- ligações ---------- */
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('keyup', onKeyUp);
    root.addEventListener('focusout', onFocusOut);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);

    function onVisibility() {
      if (doc.hidden) { pauseGame('aba'); salvarAgora(); parar(); }
      else { maybeRescale(); if (visible) autoRetomar(); pedirQuadro(); }
    }
    doc.addEventListener('visibilitychange', onVisibility);

    function onMotionChange() {
      reduced = !!(mq && mq.matches);
      if (reduced) { fagulhas.length = 0; cam.yaw = cam.tYaw; cam.pitch = cam.tPitch; cam.zoom = cam.tZoom; mixNoite = noite ? 1 : 0; aplicarCeu(); }
      pedirQuadro();
    }
    if (mq) {
      try { mq.addEventListener('change', onMotionChange); } catch (err) { try { mq.addListener(onMotionChange); } catch (err2) { /* sem aviso de mudança */ } }
    }

    let ro = null;
    function onResize() { relayout(); if (!raf) desenharJa(); }
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
    // A câmera do quarto "entra na tela" sem mudar o tamanho do elemento: confere a escala
    // de vez em quando (uma medida só, nada de desenhar) para a nitidez acompanhar.
    const escalaT = global.setInterval(function () { if (alive && visible && !doc.hidden) maybeRescale(); }, 1000);

    rotularBotoes();
    marcarBarra();
    atualizarDica();
    if (!semWebGL) { aplicarCeu(); montarMalha(); }
    relayout();
    atualizarVeu();
    desenharJa();

    /* ---------- API ---------- */
    const api = {
      el: root,
      start: function () { if (alive) startGame(); },
      pause: function () { return alive ? pauseGame('api') : false; },
      resume: function () { return alive ? resumeGame() : false; },
      isRunning: function () { return alive && !semWebGL && !perdido && estado === 'jogando' && !pausado; },
      handleKey: handleKey,
      setVisible: function (v) {
        if (!alive) return;
        visible = !!v;
        if (!visible) { pauseGame('oculto'); soltarTudo(); cancelarPonteiros(); salvarAgora(); parar(); }
        else { relayout(); autoRetomar(); pedirQuadro(); }
      },
      focus: function () { if (alive) focusCanvas(); },
      getState: function () {
        const cont = {};
        for (let i = 0; i < N; i++) { const b = mundo[i]; if (b) cont[BLOCOS[b].nome] = (cont[BLOCOS[b].nome] || 0) + 1; }
        return {
          estado: estado, pausado: pausado, motivoPausa: motivoPausa, rodando: api.isRunning(), visivel: visible,
          noite: noite, mixNoite: Math.round(mixNoite * 100) / 100, slot: slot, ferramenta: ferramenta,
          bloco: ferramenta === 'quebrar' ? null : BLOCOS[BARRA[slot]].nome,
          blocos: contarBlocos(), contagem: cont, mundoSalvo: mundoSalvo,
          camera: { yaw: cam.yaw, pitch: cam.pitch, zoom: cam.zoom, alvoYaw: cam.tYaw, alvoPitch: cam.tPitch, alvoZoom: cam.tZoom },
          alvo: alvo ? { x: alvo.x, y: alvo.y, z: alvo.z, bloco: BLOCOS[alvo.b].nome, face: alvo.n } : null,
          modoMira: modoMira, quadros: quadros, refeitas: rebuilds, loopAtivo: !!raf, fagulhas: fagulhas.length,
          movimentoReduzido: reduced, semWebGL: semWebGL, contextoPerdido: perdido, salvaOk: salvaOk,
          faces: malhaSolida && malhaSolida.geometry.index ? (malhaSolida.geometry.index.count / 6) : 0,
          facesAgua: malhaAgua && malhaAgua.geometry.index ? (malhaAgua.geometry.index.count / 6) : 0,
          canvas: { largura: canvas.width, altura: canvas.height, cssLargura: canvas.clientWidth, cssAltura: canvas.clientHeight, escala: L ? L.S : 0 }
        };
      },
      // Só para testes: onde um bloco aparece no canvas (px locais) e o que um ponto mira.
      _teste: {
        projetar: function (x, y, z, face) {
          if (!camera || !L) return null;
          aplicarCamera();
          const f = face || [0, 1, 0];
          const v = new THREE.Vector3(x + 0.5 + f[0] * 0.5, y + 0.5 + f[1] * 0.5, z + 0.5 + f[2] * 0.5).project(camera);
          return [(v.x + 1) / 2 * canvas.clientWidth, (1 - v.y) / 2 * canvas.clientHeight];
        },
        mirar: function (lx, ly) { const h = mirar(lx, ly); return h ? { x: h.x, y: h.y, z: h.z, bloco: BLOCOS[h.b].nome, face: h.n } : null; },
        topo: function (x, z) { for (let y = H - 1; y >= 0; y--) { const b = blocoEm(x, y, z); if (b && b !== AGUA) return y; } return -1; },
        blocoEm: function (x, y, z) { const b = blocoEm(x, y, z); return b ? BLOCOS[b].nome : 'ar'; }
      },
      dispose: function () {
        if (!alive) return;
        salvarAgora();
        alive = false;
        geracao++;
        parar();
        cancelarPonteiros();
        if (nomeT) global.clearTimeout(nomeT);
        if (armadoT) global.clearTimeout(armadoT);
        if (salvarT) global.clearTimeout(salvarT);
        global.clearInterval(escalaT);
        root.removeEventListener('keydown', onKeyDown);
        root.removeEventListener('keyup', onKeyUp);
        root.removeEventListener('focusout', onFocusOut);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        canvas.removeEventListener('pointerleave', onPointerLeave);
        canvas.removeEventListener('wheel', onWheel, { passive: false });
        canvas.removeEventListener('contextmenu', onContextMenu);
        canvas.removeEventListener('webglcontextlost', onContextLost, false);
        canvas.removeEventListener('webglcontextrestored', onContextRestored, false);
        doc.removeEventListener('visibilitychange', onVisibility);
        if (mq) { try { mq.removeEventListener('change', onMotionChange); } catch (err) { try { mq.removeListener(onMotionChange); } catch (err2) { /* nada */ } } }
        if (ro) ro.disconnect(); else global.removeEventListener('resize', onResize);
        unwatchDpr();
        if (!semWebGL) {
          [malhaSolida, malhaAgua, contorno, destaque, tinta, pontosFag].forEach(function (m) { if (m && m.geometry) m.geometry.dispose(); });
          [matSolido, matAgua, matContorno, matDestaque, matTinta, matFag].forEach(function (m) { if (m) m.dispose(); });
          if (textura) textura.dispose();
          try { renderer.dispose(); } catch (err) { /* nada */ }
          try { renderer.forceContextLoss(); } catch (err) { /* sem a extensão: o navegador recolhe sozinho */ }
          renderer = null; cena = null;
        }
        if (root.parentNode) root.parentNode.removeChild(root);
        removeStyle();
      }
    };
    return api;
  }

  global.AndreyMundo = {
    create: create,
    podeSalvar: podeSalvar,
    SAVE_KEY: SAVE_KEY
  };
})(window);
