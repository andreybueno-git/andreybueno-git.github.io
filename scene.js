/* AndreyOS · teaser 3D · scene.js
 *
 * O quarto do Andrey em Three.js r128 (global THREE), todo procedural: piso de
 * madeira, paredes, tapete, janela com o céu da hora real, mesa com o PC antigo
 * (CRT bege 4:3 de tela abaulada + gabinete horizontal com botão de power e LED),
 * teclado, mouse com fio, caneca com vapor, luminária com poeira no feixe,
 * estante com 8 objetos de projeto, mural de cortiça e impressora 3D.
 * Nenhuma textura externa: tudo sai de CanvasTexture desenhada aqui.
 *
 * Contrato (SPEC.md):
 *   AndreyScene.init({ canvas, onPick(name), reducedMotion }) -> api
 *   api.setPower('off'|'warmup'|'bios'|'on'), api.setBiosLines(lines),
 *   api.goTo('door'|'desk'|'screen'|'shelf'|'board'|'window', { instant }),
 *   api.getScreenCorners() -> [TL, TR, BR, BL] em px CSS de viewport, ou null,
 *   api.isScreenFacing(), api.setPaused(b), api.setReducedMotion(b),
 *   api.setTheme('classico'|'ambar'|'fosforo'|'noite'), api.pulse('key'|'win'|'error'),
 *   api.resize(), api.dispose()
 * Extras opcionais (não quebram o contrato):
 *   init({ hour, onHover(name|null), onFrame(api) }), api.getState(),
 *   AndreyScene.PROJECTS, AndreyScene.STOPS, api._pickPoint(name) (só para teste).
 *
 * Sincronia com o desktop projetado: getScreenCorners() devolve os cantos da pose do QUADRO atual
 * (o mesmo carimbo de tempo do rAF que desenha a cena), chamado antes ou depois do nosso rAF.
 * Assim o desktop HTML não escorrega sobre a moldura durante o voo da câmera.
 * Render sob demanda: com animação decorativa a cena desenha todo quadro; com movimento reduzido
 * ou pausa ela só desenha quando algo muda (e, pausada e ociosa, nem pede rAF).
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- dados

  var PROJECTS = [
    { id: 'vereda', nome: 'Vereda', objeto: 'luminária' },
    { id: 'flashclip', nome: 'FlashClip Natal', objeto: 'globo de neve' },
    { id: 'prolog', nome: 'Paradigmas: Prolog', objeto: 'livro' },
    { id: 'frontend', nome: 'Front-end E1–E3', objeto: 'caderno azul' },
    { id: 'g2', nome: 'Projeto G2 (Svelte)', objeto: 'mini kanban' },
    { id: 'metadados', nome: 'Metadados Zero', objeto: 'câmera' },
    { id: 'festejo', nome: 'festejo-app', objeto: 'caixa de papelão' },
    { id: 'jogo', nome: 'Tudo Tem Preço', objeto: 'cartucho roxo' },
    { id: 'kage', nome: 'Kage no Toki', objeto: 'katana no suporte' },
    { id: 'pecas', nome: 'Peças impressas em 3D', objeto: 'medalha impressa' }
  ];

  var STOP_NAMES = ['pc', 'door', 'desk', 'screen', 'shelf', 'board', 'window'];

  // Paradas fixas ('pc' e 'screen' são calculadas a partir do monitor e da tela).
  // tilt = quanto a inclinação pelo ponteiro vale nessa parada.
  var STOPS = {
    door: { pos: [0.0, 1.55, 2.85], target: [-0.08, 1.0, -1.8], tilt: 1 },
    desk: { pos: [0.04, 1.31, -0.92], target: [-0.1, 1.0, -2.05], tilt: 0.35 },
    shelf: { pos: [-1.5, 1.32, 0.12], target: [-2.3, 1.17, -2.3], tilt: 0.8 },
    board: { pos: [0.95, 1.5, -0.95], target: [2.96, 1.46, -1.42], tilt: 0.8 },
    window: { pos: [0.85, 1.42, 0.15], target: [1.62, 1.62, -2.6], tilt: 0.8 }
  };

  // Temas da tela: cor/brilho da luz que o CRT joga na mesa e o fundo do modo 'on'.
  // As cores do papel de parede e da barra copiam as variáveis de desktop.css (--wall-*, --face, --hi,
  // --text): quando o desktop HTML some (câmera longe) e a textura assume, a tela não "pula" de cor.
  var THEMES = {
    sistema: { light: '#e6ebee', power: 1.0, a: '#c9c9c9', b: '#c9c9c9', sun: '#000000', sun2: '#000000', sunA: 0, h1: '#c9c9c9', h2: '#c9c9c9', ink: '#000000', icon: '#000000',
      bar: '#ffffff', barHi: '#000000', barLo: '#000000', barInk: '#000000', mono: true },
    grafite: { light: '#d9a07a', power: 0.8, a: '#0b0e13', b: '#2b1d17', sun: '#e8743b', sun2: '#f2b25c', sunA: 0, h1: '#101216', h2: '#0b0c0f', ink: 'rgba(150,154,161,.55)', icon: '#ebe6dd',
      bar: '#111316', barHi: '#2c3036', barLo: '#2c3036', barInk: '#ebe6dd', mono: false },
    classico: { light: '#86d8cf', power: 0.95, a: '#1d6a66', b: '#2c8c85', sun: '#f6c35a', sun2: '#e2713a', sunA: 0.92, h1: '#17534f', h2: '#0f3e3b', ink: 'rgba(255,249,232,.9)', icon: '#fff9e8',
      bar: '#e7ddc7', barHi: '#fffbf0', barLo: '#9c8f74', barInk: '#221d15', mono: false },
    ambar: { light: '#ffb54f', power: 0.8, a: '#0b0700', b: '#160e00', sun: '#6e4805', sun2: '#2c1c02', sunA: 0.92, h1: '#1a1101', h2: '#100a00', ink: '#ffb733', icon: '#ffb733', grid: 'rgba(255,176,0,.07)',
      bar: '#1a1102', barHi: '#ffc760', barLo: '#5a3a05', barInk: '#ffb733', mono: true },
    fosforo: { light: '#62ff8e', power: 0.75, a: '#000a02', b: '#001405', sun: '#0c5a1f', sun2: '#032008', sunA: 0.92, h1: '#021a07', h2: '#010f04', ink: '#4dff7a', icon: '#4dff7a', grid: 'rgba(51,255,102,.07)',
      bar: '#031105', barHi: '#6dff8f', barLo: '#0b4418', barInk: '#4dff7a', mono: true },
    noite: { light: '#7a8cff', power: 0.6, a: '#0a1030', b: '#1d2b66', sun: '#eef1ff', sun2: '#9aaaf0', sunA: 0.55, h1: '#111a45', h2: '#0a1133', ink: '#dfe5ff', icon: '#e8ecff', stars: true,
      bar: '#283156', barHi: '#6474b4', barLo: '#161c38', barInk: '#e8ecff', mono: false }
  };

  // Hora do dia: luz ambiente, luz da janela, luminária e céu.
  var PHASES = {
    noite: { hemiSky: '#55618c', hemiGround: '#4a3020', hemi: 0.42, fill: '#8ea8ff', fillI: 0.2, bounce: '#ffc792', bounceI: 0.2, lamp: 2.8,
      patch: '#7f98ff', patchI: 0.3, beam: 0.07, exposure: 1.12, bg: '#06080e', dir: [-0.25, -0.7, 0.67], shelf: 0.95, fairy: 0.85, deco: 1 },
    entardecer: { hemiSky: '#ffc59a', hemiGround: '#4f3221', hemi: 0.75, fill: '#ff9c5c', fillI: 0.8, bounce: '#ffc08a', bounceI: 0.3, lamp: 1.9,
      patch: '#ff9852', patchI: 0.8, beam: 0.15, exposure: 1.02, bg: '#120a0a', dir: [-0.5, -0.42, 0.75], shelf: 0.7, fairy: 0.6, deco: 0.7 },
    dia: { hemiSky: '#dbeaff', hemiGround: '#95725a', hemi: 1.0, fill: '#fff1da', fillI: 1.15, bounce: '#ffe6c8', bounceI: 0.4, lamp: 1.15,
      patch: '#fff0d2', patchI: 0.85, beam: 0.14, exposure: 0.95, bg: '#1a1714', dir: [-0.32, -0.78, 0.54], shelf: 0.45, fairy: 0.3, deco: 0.35 }
  };

  var VT = "'VT323', 'Courier New', monospace";
  var HAND = "'Caveat', 'Bradley Hand', 'Noteworthy', 'Segoe Print', 'Comic Sans MS', cursive";
  var SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

  // ---------------------------------------------------------------- utilidades

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function damp(cur, target, rate, dt) { return cur + (target - cur) * (1 - Math.exp(-rate * dt)); }
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function prefersReduced() {
    try { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function rr(x, X, Y, w, h, r) {
    x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r);
    x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath();
  }
  function phaseForHour(h) {
    if (h >= 19 || h < 5) return 'noite';
    if (h < 7 || h >= 17) return 'entardecer';
    return 'dia';
  }

  // ---------------------------------------------------------------- init

  function init(opts) {
    opts = opts || {};
    var T = global.THREE;
    if (!T) throw new Error('AndreyScene: o Three.js (vendor/three.min.js) não foi carregado.');
    var canvas = opts.canvas;
    if (!canvas || typeof canvas.getContext !== 'function') throw new Error('AndreyScene: passe um <canvas> em init({ canvas }).');

    var onPick = typeof opts.onPick === 'function' ? opts.onPick : function () {};
    var onHover = typeof opts.onHover === 'function' ? opts.onHover : null;
    var onFrame = typeof opts.onFrame === 'function' ? opts.onFrame : null;
    var reduced = typeof opts.reducedMotion === 'boolean' ? opts.reducedMotion : prefersReduced();
    var hourOverride = typeof opts.hour === 'number' && isFinite(opts.hour) ? ((Math.floor(opts.hour) % 24) + 24) % 24 : null;

    var renderer;
    try {
      renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      throw new Error('AndreyScene: este navegador não conseguiu abrir o WebGL (' + (err && err.message ? err.message : err) + ').');
    }
    if (!renderer.getContext()) throw new Error('AndreyScene: WebGL indisponível neste navegador.');

    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 1.75));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    // A única luz com sombra (luminária) e quase tudo que ela pega são estáticos: o mapa de sombra
    // é desenhado uma vez e só refeito quando algo debaixo dela se mexe (tecla afundando, botão).
    // Medido: 409 → 347 chamadas de desenho por quadro (o passe de sombra deixa de rodar todo quadro).
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    var maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    var scene = new T.Scene();
    var camera = new T.PerspectiveCamera(38, 16 / 10, 0.03, 40);
    var room = new T.Group(); room.name = 'quarto'; scene.add(room);
    var fx = new T.Group(); fx.name = 'efeitos'; scene.add(fx); // poeira, vapor, feixes: fora do raycast

    var textures = [];
    var V = function (x, y, z) { return new T.Vector3(x, y, z); };

    function lin(hex) { return new T.Color(hex).convertSRGBToLinear(); }
    var LC = {};
    function linc(hex) { return LC[hex] || (LC[hex] = lin(hex)); } // cor linear em cache (não alocar por quadro)
    function std(hex, o) {
      var m = new T.MeshStandardMaterial({ color: lin(hex), roughness: 0.75, metalness: 0, envMapIntensity: 0.5 });
      if (o) Object.keys(o).forEach(function (k) { if (k === 'emissive') m.emissive = lin(o[k]); else m[k] = o[k]; });
      return m;
    }
    function add(parent, geo, mat, x, y, z, o) {
      var m = new T.Mesh(geo, mat);
      m.position.set(x || 0, y || 0, z || 0);
      m.castShadow = !(o && o.cast === false);
      m.receiveShadow = !(o && o.receive === false);
      parent.add(m);
      return m;
    }
    function canvasTex(w, h, draw, o) {
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var x = c.getContext('2d');
      draw(x, w, h);
      var t = new T.CanvasTexture(c);
      t.encoding = T.sRGBEncoding; t.anisotropy = maxAniso;
      if (o && o.repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(o.repeat[0], o.repeat[1]); }
      textures.push(t);
      return t;
    }
    function texRepeat(base, rx, ry) {
      var t = base.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rx, ry); textures.push(t); return t;
    }
    // Retângulo arredondado como THREE.Shape (ou Path, para furos).
    function rrShape(w, h, r, cx, cy, path) {
      var s = path || new T.Shape(), x = (cx || 0) - w / 2, y = (cy || 0) - h / 2;
      r = Math.max(1e-4, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4));
      s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
      s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
      s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
      return s;
    }
    // Caixa de cantos arredondados (r128 não tem RoundedBoxGeometry).
    function rbox(w, h, d, r) {
      var b = Math.min(r * 0.6, d * 0.3, w * 0.3, h * 0.3);
      var s = rrShape(w - 2 * b, h - 2 * b, r - b);
      var g = new T.ExtrudeGeometry(s, { depth: Math.max(1e-4, d - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 4 });
      g.center();
      return g;
    }
    var Y_AXIS = V(0, 1, 0);
    function rod(parent, a, b, r, mat, seg, r2) {
      var dir = V(0, 0, 0).subVectors(b, a), len = dir.length();
      var m = new T.Mesh(new T.CylinderGeometry(r2 == null ? r : r2, r, len, seg || 12), mat);
      m.position.copy(a).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(Y_AXIS, dir.normalize());
      m.castShadow = true; m.receiveShadow = true;
      parent.add(m);
      return m;
    }
    function tube(parent, pts, r, mat) {
      var curve = new T.CatmullRomCurve3(pts);
      var m = new T.Mesh(new T.TubeGeometry(curve, Math.max(12, pts.length * 10), r, 6, false), mat);
      m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
    }

    // Sombra de contato macia (blob) para "assentar" os objetos.
    var blobTex = canvasTex(128, 128, function (x) {
      var g = x.createRadialGradient(64, 64, 2, 64, 64, 64);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.45, 'rgba(0,0,0,.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    });
    function blob(parent, x, y, z, w, d, op, rotY) {
      var m = new T.Mesh(new T.PlaneGeometry(w, d), new T.MeshBasicMaterial({ color: 0x000000, map: blobTex, transparent: true, opacity: op, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.rotation.x = -Math.PI / 2; if (rotY) m.rotation.z = rotY;
      m.position.set(x, y, z); m.userData.noPick = true; m.renderOrder = 1;
      parent.add(m); return m;
    }

    // ------------------------------------------------------------ texturas

    var floorTex = canvasTex(1024, 1024, function (x, w, h) {
      var R = rng(11), n = 8, pw = w / n;
      for (var i = 0; i < n; i++) {
        var x0 = i * pw, jo = R() * h, cols = [];
        for (var c = 0; c < 2; c++) cols.push('hsl(' + (22 + R() * 9).toFixed(1) + ',' + (34 + R() * 14).toFixed(1) + '%,' + (27 + R() * 12).toFixed(1) + '%)');
        for (var k = -1; k < 3; k++) {
          var y0 = jo + k * h / 2 - h;
          for (var rep = 0; rep < 2; rep++) {
            var yy = y0 + rep * h;
            x.fillStyle = cols[((k % 2) + 2) % 2]; x.fillRect(x0, yy, pw, h / 2);
            for (var g = 0; g < 16; g++) {
              var gx = x0 + 4 + R() * (pw - 8), wv = (R() - 0.5) * 16;
              x.strokeStyle = 'rgba(' + (R() < 0.5 ? '35,18,8' : '255,225,190') + ',' + (0.05 + R() * 0.09).toFixed(3) + ')';
              x.lineWidth = 0.6 + R() * 1.6;
              x.beginPath(); x.moveTo(gx, yy); x.bezierCurveTo(gx + wv, yy + h * 0.15, gx - wv, yy + h * 0.35, gx + wv * 0.5, yy + h / 2); x.stroke();
            }
            if (R() < 0.35) {
              var kx = x0 + 20 + R() * (pw - 40), ky = yy + 40 + R() * (h / 2 - 80);
              for (var q = 0; q < 4; q++) { x.strokeStyle = 'rgba(40,20,8,' + (0.25 - q * 0.05) + ')'; x.lineWidth = 1.2; x.beginPath(); x.ellipse(kx, ky, 4 + q * 4, 9 + q * 7, 0, 0, Math.PI * 2); x.stroke(); }
            }
            x.fillStyle = 'rgba(18,9,4,.85)'; x.fillRect(x0, yy, pw, 2);
            x.fillStyle = 'rgba(255,230,200,.10)'; x.fillRect(x0, yy + 2, pw, 2);
          }
        }
        x.fillStyle = 'rgba(16,8,3,.9)'; x.fillRect(x0, 0, 2.5, h);
        x.fillStyle = 'rgba(255,230,200,.08)'; x.fillRect(x0 + 2.5, 0, 2, h);
      }
    }, { repeat: [6.2, 7] });

    var deskTex = canvasTex(1024, 512, function (x, w, h) {
      var R = rng(23);
      x.fillStyle = '#a4734b'; x.fillRect(0, 0, w, h);
      for (var b = 0; b < 3; b++) {
        x.fillStyle = 'hsla(' + (26 + R() * 6) + ',45%,' + (38 + R() * 8) + '%,.55)'; x.fillRect(0, b * h / 3, w, h / 3);
      }
      for (var i = 0; i < 140; i++) {
        var y = R() * h, a = (R() - 0.5) * 22;
        x.strokeStyle = 'rgba(' + (R() < 0.6 ? '60,30,12' : '255,220,170') + ',' + (0.05 + R() * 0.1).toFixed(3) + ')';
        x.lineWidth = 0.6 + R() * 1.8;
        x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(w * 0.3, y + a, w * 0.6, y - a, w, y + a * 0.4); x.stroke();
      }
      x.fillStyle = 'rgba(30,14,6,.5)'; x.fillRect(0, h / 3, w, 1.5); x.fillRect(0, 2 * h / 3, w, 1.5);
    }, { repeat: [0.62, 1.3] });

    var plasterTex = canvasTex(256, 256, function (x, w, h) {
      var R = rng(5); x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
      // manchas grandes e suaves (massa corrida de verdade nunca é lisa) e depois o grão fino
      for (var b = 0; b < 46; b++) { var bx = R() * w, by = R() * h, br = 20 + R() * 70, gb = x.createRadialGradient(bx, by, 0, bx, by, br); var c = R() < 0.55 ? '70,52,30' : '255,250,240'; gb.addColorStop(0, 'rgba(' + c + ',' + (0.025 + R() * 0.04).toFixed(3) + ')'); gb.addColorStop(1, 'rgba(' + c + ',0)'); x.fillStyle = gb; x.fillRect(bx - br, by - br, br * 2, br * 2); }
      for (var i = 0; i < 2600; i++) { x.fillStyle = 'rgba(' + (R() < 0.5 ? '0,0,0' : '255,255,255') + ',' + (R() * 0.05).toFixed(3) + ')'; x.fillRect(R() * w, R() * h, 1 + R() * 2, 1 + R() * 2); }
    }, { repeat: [5, 3] });
    // Relevo do reboco: ruído em várias escalas, usado como bumpMap (a luz rasante da janela mostra a textura).
    var plasterBump = canvasTex(256, 256, function (x, w, h) {
      var R = rng(17); x.fillStyle = '#808080'; x.fillRect(0, 0, w, h);
      [[30, 22, .10], [120, 7, .10], [900, 2, .16]].forEach(function (o) { for (var i = 0; i < o[0]; i++) { var px = R() * w, py = R() * h, r = o[1] * (0.6 + R()), gg = x.createRadialGradient(px, py, 0, px, py, r), v = R() < 0.5 ? 0 : 255; gg.addColorStop(0, 'rgba(' + v + ',' + v + ',' + v + ',' + o[2] + ')'); gg.addColorStop(1, 'rgba(' + v + ',' + v + ',' + v + ',0)'); x.fillStyle = gg; x.fillRect(px - r, py - r, r * 2, r * 2); } });
    }, { repeat: [5, 3] });
    plasterBump.encoding = T.LinearEncoding;

    var beadTex = canvasTex(128, 64, function (x, w, h) {
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
      x.fillStyle = 'rgba(0,0,0,.28)'; x.fillRect(0, 0, 3, h);
      x.fillStyle = 'rgba(255,255,255,.4)'; x.fillRect(3, 0, 2, h);
      x.fillStyle = 'rgba(0,0,0,.06)'; x.fillRect(w * 0.5, 0, w * 0.5, h);
    });

    var rugTex = canvasTex(1024, 704, function (x, w, h) {
      var R = rng(31), fr = 34, X0 = fr, W = w - 2 * fr;
      x.clearRect(0, 0, w, h);
      x.strokeStyle = '#e8d9bb'; x.lineWidth = 4; x.lineCap = 'round';
      for (var y = 10; y < h - 8; y += 10) {
        x.beginPath(); x.moveTo(fr, y); x.lineTo(4 + R() * 6, y + (R() - 0.5) * 6); x.stroke();
        x.beginPath(); x.moveTo(w - fr, y); x.lineTo(w - 4 - R() * 6, y + (R() - 0.5) * 6); x.stroke();
      }
      x.fillStyle = '#7b2e2a'; x.fillRect(X0, 0, W, h);
      function band(inset, th, col) { x.fillStyle = col; x.fillRect(X0 + inset, inset, W - 2 * inset, th); x.fillRect(X0 + inset, h - inset - th, W - 2 * inset, th); x.fillRect(X0 + inset, inset, th, h - 2 * inset); x.fillRect(X0 + W - inset - th, inset, th, h - 2 * inset); }
      band(14, 26, '#e3cfa6'); band(40, 34, '#c4893a'); band(74, 8, '#e3cfa6');
      // zig-zag na faixa ocre
      x.fillStyle = '#2f5d58';
      for (var zx = X0 + 50; zx < X0 + W - 60; zx += 34) { x.beginPath(); x.moveTo(zx, 43); x.lineTo(zx + 17, 71); x.lineTo(zx + 34, 43); x.closePath(); x.fill(); x.beginPath(); x.moveTo(zx, h - 43); x.lineTo(zx + 17, h - 71); x.lineTo(zx + 34, h - 43); x.closePath(); x.fill(); }
      // losangos do campo
      var cx0 = X0 + 82, cy0 = 82, cw = W - 164, ch = h - 164, cols = 7, rows = 4;
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        var px = cx0 + (c + 0.5) * cw / cols, py = cy0 + (r + 0.5) * ch / rows, rx = cw / cols * 0.42, ry = ch / rows * 0.42;
        var alt = (r + c) % 2;
        x.fillStyle = alt ? '#c4893a' : '#e3cfa6';
        x.beginPath(); x.moveTo(px, py - ry); x.lineTo(px + rx, py); x.lineTo(px, py + ry); x.lineTo(px - rx, py); x.closePath(); x.fill();
        x.fillStyle = '#7b2e2a';
        x.beginPath(); x.moveTo(px, py - ry * 0.62); x.lineTo(px + rx * 0.62, py); x.lineTo(px, py + ry * 0.62); x.lineTo(px - rx * 0.62, py); x.closePath(); x.fill();
        x.fillStyle = alt ? '#2f5d58' : '#c4893a';
        x.beginPath(); x.moveTo(px, py - ry * 0.3); x.lineTo(px + rx * 0.3, py); x.lineTo(px, py + ry * 0.3); x.lineTo(px - rx * 0.3, py); x.closePath(); x.fill();
      }
      // fibra
      for (var i = 0; i < 9000; i++) { x.fillStyle = 'rgba(' + (R() < 0.5 ? '0,0,0' : '255,240,220') + ',' + (R() * 0.09).toFixed(3) + ')'; x.fillRect(X0 + R() * W, R() * h, 1 + R() * 2.5, 1); }
    });

    var corkTex = canvasTex(512, 384, function (x, w, h) {
      var R = rng(41); x.fillStyle = '#b78653'; x.fillRect(0, 0, w, h);
      for (var i = 0; i < 7000; i++) { var d = R(); x.fillStyle = d < 0.45 ? 'rgba(90,52,22,' + (0.2 + R() * 0.4).toFixed(2) + ')' : d < 0.8 ? 'rgba(230,190,130,' + (0.2 + R() * 0.4).toFixed(2) + ')' : 'rgba(60,32,12,.5)'; x.fillRect(R() * w, R() * h, 1 + R() * 3, 1 + R() * 2.5); }
    });

    function noteTex(bg, lines, o) {
      o = o || {};
      return canvasTex(256, 256, function (x, w, h) {
        x.fillStyle = bg; x.fillRect(0, 0, w, h);
        var g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(0,0,0,.07)'); g.addColorStop(0.16, 'rgba(255,255,255,.12)'); g.addColorStop(0.8, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.16)');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        x.fillStyle = '#2b2622'; x.textAlign = 'center'; x.textBaseline = 'middle';
        var size = o.size || 44, lh = size * 1.08, y0 = (o.y || h / 2) - (lines.length - 1) * lh / 2;
        x.font = size + 'px ' + HAND;
        var fit = size;
        lines.forEach(function (t) { while (fit > 20 && x.measureText(t).width > w - 34) { fit -= 2; x.font = fit + 'px ' + HAND; } });
        lines.forEach(function (t, i) { x.save(); x.translate(w / 2 + (i % 2 ? 4 : -3), y0 + i * lh); x.rotate((i % 2 ? 1 : -1) * 0.02); x.fillText(t, 0, 0); x.restore(); });
        if (o.arrow) {
          x.strokeStyle = '#c0362c'; x.lineWidth = 7; x.lineCap = 'round'; x.lineJoin = 'round';
          x.beginPath(); x.moveTo(128, 178); x.quadraticCurveTo(150, 206, 150, 238); x.stroke();
          x.beginPath(); x.moveTo(130, 220); x.lineTo(150, 240); x.lineTo(170, 218); x.stroke();
        }
        if (o.underline) { x.strokeStyle = '#c0362c'; x.lineWidth = 4; x.beginPath(); x.moveTo(50, o.underline); x.quadraticCurveTo(128, o.underline + 8, 206, o.underline - 2); x.stroke(); }
      });
    }

    // ------------------------------------------------------------ materiais base

    var M = {
      floor: std('#ffffff', { map: floorTex, roughness: 0.6 }),
      wall: std('#e6d5b5', { map: texRepeat(plasterTex, 1.2, 1.2), bumpMap: texRepeat(plasterBump, 6, 3.6), bumpScale: 0.0035, roughness: 0.95, envMapIntensity: 0.35 }),
      wallSide: std('#dccaa8', { map: plasterTex, bumpMap: plasterBump, bumpScale: 0.0035, roughness: 0.95, envMapIntensity: 0.35 }),
      // lambri: o mesmo desenho das tábuas vira relevo (o friso afunda), e a tinta tem um brilho acetinado
      bead: std('#33605a', { map: texRepeat(beadTex, 60, 1), bumpMap: texRepeat(beadTex, 60, 1), bumpScale: 0.004, roughness: 0.55 }),
      beadSide: std('#33605a', { map: texRepeat(beadTex, 70, 1), bumpMap: texRepeat(beadTex, 70, 1), bumpScale: 0.004, roughness: 0.55 }),
      rail: std('#6e4a32', { roughness: 0.6 }),
      base: std('#3e2a1d', { roughness: 0.7 }),
      ceiling: std('#8a7560', { roughness: 1 }),
      // tampo de madeira envernizada: o veio vira relevo leve e o verniz reflete a janela e a luminária
      desk: std('#ffffff', { map: deskTex, bumpMap: deskTex, bumpScale: 0.0012, roughness: 0.38, envMapIntensity: 0.8 }),
      deskDark: std('#7a5034', { roughness: 0.6 }),
      shelf: std('#704a31', { roughness: 0.62 }),
      shelfBack: std('#4f3423', { roughness: 0.8 }),
      frameWhite: std('#ece2cf', { roughness: 0.6 }),
      // o PC desenhado (reserva), o teclado e o mouse: grafite, como o monitor gerado
      beigeMon: std('#2b2e33', { roughness: 0.62 }),
      beigeCase: std('#26292d', { roughness: 0.62 }),
      beigeDark: std('#1d1f23', { roughness: 0.6 }),
      beigeKey: std('#ffffff', { roughness: 0.55 }),
      black: std('#141312', { roughness: 0.55 }),
      darkGray: std('#2c2e31', { roughness: 0.5, metalness: 0.2 }),
      metal: std('#b9b9b4', { roughness: 0.35, metalness: 0.75 }),
      brass: std('#c79a4a', { roughness: 0.35, metalness: 0.8 }),
      cable: std('#1c1e22', { roughness: 0.6 }),
      cableDark: std('#26241f', { roughness: 0.6 }),
      lamp: std('#c9962c', { roughness: 0.42, metalness: 0.25 }),
      fabric: std('#e3d6bc', { roughness: 0.95, side: T.DoubleSide }),
      leaf: std('#4e7d3b', { roughness: 0.7 }),
      leafDark: std('#355c2a', { roughness: 0.7 }),
      terracotta: std('#b4603d', { roughness: 0.8 }),
      paper: std('#f4efe4', { roughness: 0.9 })
    };

    // ------------------------------------------------------------ quarto

    var H = 3.0, ZB = -2.5, WX0 = 1.05, WX1 = 2.15, WY0 = 1.05, WY1 = 2.3, DESK_Y = 0.775;

    var floor = add(room, new T.PlaneGeometry(8, 12), M.floor, 0, 0, 1.5, { cast: false });
    floor.rotation.x = -Math.PI / 2;
    var ceil = add(room, new T.PlaneGeometry(8, 12), M.ceiling, 0, H, 1.5, { cast: false, receive: false });
    ceil.rotation.x = Math.PI / 2;

    // Escurece as paredes em direção ao teto (cor por vértice): dá profundidade sem luz extra.
    function wallShade(geo) {
      var p = geo.attributes.position, cols = new Float32Array(p.count * 3);
      for (var i = 0; i < p.count; i++) { var y = p.getY(i), k = clamp((y - 1.3) / 1.7, 0, 1); var v = 1 - 0.5 * k * k * (3 - 2 * k); cols[i * 3] = v; cols[i * 3 + 1] = v; cols[i * 3 + 2] = v; }
      geo.setAttribute('color', new T.BufferAttribute(cols, 3));
      return geo;
    }
    M.wall.vertexColors = true; M.wallSide.vertexColors = true;
    // Parede do fundo numa peça só, com o vão da janela (peças separadas davam frestas de z-fighting).
    (function () {
      var sh = new T.Shape(); sh.moveTo(-3.2, 0); sh.lineTo(3.2, 0); sh.lineTo(3.2, H); sh.lineTo(-3.2, H); sh.lineTo(-3.2, 0);
      var hole = new T.Path(); hole.moveTo(WX0, WY0); hole.lineTo(WX0, WY1); hole.lineTo(WX1, WY1); hole.lineTo(WX1, WY0); hole.lineTo(WX0, WY0);
      sh.holes.push(hole);
      var g = new T.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: false, curveSegments: 1 });
      add(room, wallShade(g), M.wall, 0, 0, ZB - 0.12, { cast: false });
    })();
    var sideGeo = new T.BoxGeometry(0.12, H, 9.5, 1, 6, 1); sideGeo.translate(0, H / 2, 0); wallShade(sideGeo);
    add(room, sideGeo, M.wallSide, 3.06, 0, 2.2, { cast: false });
    add(room, sideGeo.clone(), M.wallSide, -3.06, 0, 2.2, { cast: false });
    // lambri verde (meia parede), roda-meio e rodapé
    add(room, new T.BoxGeometry(6.0, 0.92, 0.02), M.bead, 0, 0.46, ZB + 0.01, { cast: false });
    add(room, new T.BoxGeometry(6.0, 0.035, 0.04), M.rail, 0, 0.93, ZB + 0.02, { cast: false });
    add(room, new T.BoxGeometry(6.0, 0.1, 0.03), M.base, 0, 0.05, ZB + 0.025, { cast: false });
    [[2.99, -1], [-2.99, 1]].forEach(function (s) {
      add(room, new T.BoxGeometry(0.02, 0.92, 7), M.beadSide, s[0], 0.46, 1.0, { cast: false });
      add(room, new T.BoxGeometry(0.04, 0.035, 7), M.rail, s[0] + s[1] * 0.01, 0.93, 1.0, { cast: false });
      add(room, new T.BoxGeometry(0.03, 0.1, 7), M.base, s[0] + s[1] * 0.015, 0.05, 1.0, { cast: false });
    });

    // ---------------- janela + céu
    var skyCanvas = document.createElement('canvas'); skyCanvas.width = 1024; skyCanvas.height = 1024;
    var skyTex = new T.CanvasTexture(skyCanvas); skyTex.encoding = T.sRGBEncoding; textures.push(skyTex);
    var sky = add(room, new T.PlaneGeometry(2.6, 2.2), new T.MeshBasicMaterial({ map: skyTex, toneMapped: false }), (WX0 + WX1) / 2, 1.7, -3.0, { cast: false, receive: false });
    sky.userData.pick = 'window';

    var windowGroup = new T.Group(); windowGroup.userData.pick = 'window'; room.add(windowGroup);
    var wf = M.frameWhite, WCX = (WX0 + WX1) / 2, WCY = (WY0 + WY1) / 2;
    add(windowGroup, new T.BoxGeometry(WX1 - WX0, 0.05, 0.1), wf, WCX, WY1 - 0.025, -2.56);
    add(windowGroup, new T.BoxGeometry(WX1 - WX0, 0.05, 0.1), wf, WCX, WY0 + 0.025, -2.56);
    add(windowGroup, new T.BoxGeometry(0.05, WY1 - WY0, 0.1), wf, WX0 + 0.025, WCY, -2.56);
    add(windowGroup, new T.BoxGeometry(0.05, WY1 - WY0, 0.1), wf, WX1 - 0.025, WCY, -2.56);
    add(windowGroup, new T.BoxGeometry(0.035, WY1 - WY0 - 0.08, 0.05), wf, WCX, WCY, -2.57);
    add(windowGroup, new T.BoxGeometry(WX1 - WX0 - 0.08, 0.035, 0.05), wf, WCX, WCY + 0.05, -2.57);
    add(windowGroup, new T.BoxGeometry(WX1 - WX0 + 0.22, 0.035, 0.2), wf, WCX, WY0 - 0.012, -2.43);
    add(windowGroup, new T.BoxGeometry(WX1 - WX0 + 0.14, 0.07, 0.025), wf, WCX, WY0 - 0.06, -2.49);
    var glass = add(windowGroup, new T.PlaneGeometry(WX1 - WX0 - 0.06, WY1 - WY0 - 0.06), new T.MeshStandardMaterial({ color: lin('#a9c2d6'), transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0, depthWrite: false }), WCX, WCY, -2.575, { cast: false, receive: false });
    glass.userData.pick = 'window';
    // cortinas de linho num varão
    var rodMat = M.brass;
    rod(room, V(WX0 - 0.3, 2.47, -2.42), V(WX1 + 0.3, 2.47, -2.42), 0.012, rodMat, 10);
    [WX0 - 0.31, WX1 + 0.31].forEach(function (x) { var k = add(room, new T.SphereGeometry(0.022, 12, 10), rodMat, x, 2.47, -2.42); k.castShadow = false; });
    function curtain(cx, w) {
      var g = new T.PlaneGeometry(w, 1.5, 36, 1), p = g.attributes.position;
      for (var i = 0; i < p.count; i++) { var u = (p.getX(i) / w) + 0.5; p.setZ(i, Math.sin(u * Math.PI * 7) * 0.022 + Math.sin(u * Math.PI * 2.3) * 0.01); }
      g.computeVertexNormals();
      var m = add(room, g, M.fabric, cx, 2.47 - 0.75, -2.4);
      return m;
    }
    curtain(WX0 - 0.13, 0.38); curtain(WX1 + 0.13, 0.38);
    // vasinhos no peitoril
    (function () {
      var pot = add(room, new T.CylinderGeometry(0.05, 0.038, 0.09, 18), M.terracotta, WX0 + 0.16, WY0 + 0.05, -2.45);
      pot.castShadow = true;
      var R = rng(77);
      for (var i = 0; i < 7; i++) {
        var lf = add(room, new T.ConeGeometry(0.018, 0.22 + R() * 0.12, 6), i % 2 ? M.leaf : M.leafDark, WX0 + 0.16 + (R() - 0.5) * 0.04, WY0 + 0.17 + R() * 0.04, -2.45 + (R() - 0.5) * 0.03);
        lf.scale.z = 0.35; lf.rotation.set((R() - 0.5) * 0.5, R() * Math.PI, (R() - 0.5) * 0.6);
      }
      var pot2 = add(room, new T.CylinderGeometry(0.04, 0.032, 0.06, 16), std('#e9e1d2', { roughness: 0.6 }), WX1 - 0.18, WY0 + 0.035, -2.45);
      pot2.castShadow = true;
      var cac = add(room, new T.SphereGeometry(0.035, 14, 12), std('#5f8a4a', { roughness: 0.7 }), WX1 - 0.18, WY0 + 0.095, -2.45);
      cac.scale.y = 1.25;
    })();

    // ---------------- tapete
    var rug = add(room, new T.PlaneGeometry(2.7, 1.86), std('#d9d0c4', { map: rugTex, roughness: 1, alphaTest: 0.4 }), 0.05, 0.004, -0.72, { cast: false });
    rug.rotation.x = -Math.PI / 2;

    // ---------------- quadro (pôster) acima da mesa
    var posterTex = canvasTex(512, 704, function (x, w, h) {
      x.fillStyle = '#efe4cc'; x.fillRect(0, 0, w, h);
      var sx0 = w / 2, sy0 = 330;
      for (var i = 0; i < 6; i++) { x.fillStyle = ['#f2b64c', '#ee9a43', '#e47e3c', '#d76236', '#c64a31', '#a8392c'][i]; x.beginPath(); x.arc(sx0, sy0, 170, Math.PI + i * Math.PI / 6 * 0, 0); x.fill(); }
      var gs = x.createLinearGradient(0, sy0 - 170, 0, sy0); gs.addColorStop(0, '#f6c35a'); gs.addColorStop(1, '#d4543a');
      x.fillStyle = gs; x.beginPath(); x.arc(sx0, sy0, 170, Math.PI, 0); x.fill();
      x.fillStyle = '#efe4cc'; for (var s = 0; s < 6; s++) x.fillRect(80, sy0 - 26 - s * 24, w - 160, 4 + s * 0.8);
      x.fillStyle = '#2f5d58'; x.beginPath(); x.moveTo(0, 400); x.quadraticCurveTo(140, 300, 280, 380); x.quadraticCurveTo(400, 440, w, 360); x.lineTo(w, 520); x.lineTo(0, 520); x.fill();
      x.fillStyle = '#244843'; x.beginPath(); x.moveTo(0, 460); x.quadraticCurveTo(200, 400, 340, 450); x.quadraticCurveTo(440, 480, w, 440); x.lineTo(w, 560); x.lineTo(0, 560); x.fill();
      x.fillStyle = '#1b2f2c'; x.fillRect(0, 548, w, 16);
      x.fillStyle = '#2b2622'; x.font = 'bold 40px ' + SANS; x.textAlign = 'center'; x.fillText('AndreyOS 24', w / 2, 622);
      x.font = '22px ' + SANS; x.fillStyle = '#6b5b4b'; x.fillText('agora com mais pixels', w / 2, 660);
    });
    var poster = new T.Group(); poster.position.set(-0.14, 1.9, ZB + 0.012); room.add(poster);
    add(poster, new T.BoxGeometry(0.52, 0.7, 0.022), M.deskDark, 0, 0, 0);
    add(poster, new T.PlaneGeometry(0.47, 0.65), std('#ffffff', { map: posterTex, roughness: 0.8 }), 0, 0, 0.0115, { cast: false });

    // ---------------- relógio de parede (hora real)
    var clockTex = canvasTex(256, 256, function (x) {
      x.fillStyle = '#f3ead8'; x.beginPath(); x.arc(128, 128, 126, 0, Math.PI * 2); x.fill();
      x.strokeStyle = '#2b2622';
      for (var i = 0; i < 60; i++) { var a = i / 60 * Math.PI * 2, r1 = i % 5 ? 112 : 100; x.lineWidth = i % 5 ? 2 : 6; x.beginPath(); x.moveTo(128 + Math.sin(a) * r1, 128 - Math.cos(a) * r1); x.lineTo(128 + Math.sin(a) * 120, 128 - Math.cos(a) * 120); x.stroke(); }
      x.fillStyle = '#8a7b68'; x.font = '18px ' + SANS; x.textAlign = 'center'; x.fillText('quarto', 128, 172);
    });
    var clock = new T.Group(); clock.position.set(-1.34, 2.08, ZB + 0.02); room.add(clock);
    var rim = add(clock, new T.CylinderGeometry(0.15, 0.15, 0.035, 40), M.deskDark, 0, 0, 0); rim.rotation.x = Math.PI / 2;
    add(clock, new T.CircleGeometry(0.132, 40), std('#ffffff', { map: clockTex, roughness: 0.7 }), 0, 0, 0.0185, { cast: false });
    function hand(len, wdt, mat) { var g = new T.BoxGeometry(wdt, len, 0.003); g.translate(0, len / 2 - 0.015, 0); var m = add(clock, g, mat, 0, 0, 0.022, { cast: false }); return m; }
    var hHour = hand(0.075, 0.009, M.black), hMin = hand(0.108, 0.006, M.black), hSec = hand(0.115, 0.0025, std('#c0362c'));
    add(clock, new T.CylinderGeometry(0.008, 0.008, 0.01, 12), M.brass, 0, 0, 0.026).rotation.x = Math.PI / 2;

    // ------------------------------------------------------------ mesa

    var desk = new T.Group(); room.add(desk);
    add(desk, rbox(1.7, 0.035, 0.76, 0.012), M.desk, -0.1, DESK_Y - 0.0175, -2.07);
    add(desk, new T.BoxGeometry(1.58, 0.07, 0.025), M.deskDark, -0.1, DESK_Y - 0.07, -1.72);
    add(desk, new T.BoxGeometry(1.58, 0.07, 0.025), M.deskDark, -0.1, DESK_Y - 0.07, -2.42);
    add(desk, new T.BoxGeometry(0.025, 0.07, 0.7), M.deskDark, -0.89, DESK_Y - 0.07, -2.07);
    add(desk, new T.BoxGeometry(0.025, 0.07, 0.7), M.deskDark, 0.69, DESK_Y - 0.07, -2.07);
    add(desk, rbox(0.42, 0.06, 0.02, 0.006), M.desk, 0.36, DESK_Y - 0.07, -1.705);
    add(desk, new T.SphereGeometry(0.012, 12, 10), M.brass, 0.36, DESK_Y - 0.07, -1.69);
    [[-0.86, -1.75], [0.66, -1.75], [-0.86, -2.39], [0.66, -2.39]].forEach(function (p) {
      var sx = p[0] < 0 ? -1 : 1, sz = p[1] > -2 ? 1 : -1;
      rod(desk, V(p[0], DESK_Y - 0.1, p[1]), V(p[0] + sx * 0.03, 0, p[1] + sz * 0.03), 0.017, M.deskDark, 12, 0.024);
      blob(room, p[0] + sx * 0.03, 0.006, p[1] + sz * 0.03, 0.14, 0.14, 0.5);
    });
    blob(room, -0.1, 0.005, -2.07, 2.1, 1.1, 0.42);

    // ------------------------------------------------------------ PC antigo

    var CX = -0.08;
    var SW = 0.296, SH = 0.222, BULGE = 0.008; // tela visível 4:3 (m)

    // ---- gabinete horizontal
    var pc = new T.Group(); pc.position.set(CX, DESK_Y + 0.073, -2.2); room.add(pc);
    add(pc, rbox(0.44, 0.13, 0.4, 0.012), M.beigeCase, 0, 0, 0);
    [[-0.19, 0.16], [0.19, 0.16], [-0.19, -0.16], [0.19, -0.16]].forEach(function (p) { add(pc, new T.BoxGeometry(0.04, 0.008, 0.04), M.black, p[0], -0.069, p[1]); });
    blob(room, CX, DESK_Y + 0.002, -2.2, 0.62, 0.56, 0.55);
    var FZ = 0.2;
    // drives
    add(pc, new T.BoxGeometry(0.15, 0.04, 0.006), M.beigeDark, -0.115, 0.028, FZ + 0.001);
    add(pc, new T.BoxGeometry(0.12, 0.005, 0.004), M.black, -0.12, 0.031, FZ + 0.0045);
    add(pc, new T.BoxGeometry(0.012, 0.014, 0.008), M.beigeCase, -0.052, 0.021, FZ + 0.005);
    add(pc, new T.BoxGeometry(0.105, 0.03, 0.006), M.beigeDark, -0.14, -0.026, FZ + 0.001);
    add(pc, new T.BoxGeometry(0.085, 0.004, 0.004), M.black, -0.14, -0.021, FZ + 0.0045);
    add(pc, new T.BoxGeometry(0.014, 0.007, 0.006), M.beigeCase, -0.105, -0.033, FZ + 0.004);
    // display de 7 segmentos "66" + turbo + selo
    var segCanvas = document.createElement('canvas'); segCanvas.width = 128; segCanvas.height = 64;
    var segTex = new T.CanvasTexture(segCanvas); segTex.encoding = T.sRGBEncoding; textures.push(segTex);
    var segMat = new T.MeshBasicMaterial({ map: segTex, toneMapped: false });
    add(pc, new T.PlaneGeometry(0.038, 0.019), segMat, 0.015, 0.03, FZ + 0.0022, { cast: false });
    add(pc, new T.BoxGeometry(0.044, 0.025, 0.003), M.black, 0.015, 0.03, FZ + 0.0002, { cast: false });
    add(pc, new T.BoxGeometry(0.016, 0.01, 0.008), M.beigeDark, 0.015, 0.003, FZ + 0.004);
    var badgeTex = canvasTex(256, 80, function (x, w, h) {
      x.fillStyle = '#2a2a2e'; rr(x, 2, 2, w - 4, h - 4, 10); x.fill();
      x.fillStyle = '#e8c35a'; x.font = 'bold 34px ' + SANS; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('486 DX2', w / 2, h / 2 + 2);
    });
    add(pc, new T.PlaneGeometry(0.05, 0.016), std('#ffffff', { map: badgeTex, roughness: 0.4, metalness: 0.2 }), 0.015, -0.03, FZ + 0.0012, { cast: false });
    // LEDs
    function ledMat() { return new T.MeshStandardMaterial({ color: lin('#1d2a1f'), emissive: lin('#39ff6a'), emissiveIntensity: 0, roughness: 0.3 }); }
    var ledPower = add(pc, new T.CylinderGeometry(0.0038, 0.0038, 0.004, 14), ledMat(), 0.088, 0.044, FZ + 0.002, { cast: false });
    ledPower.rotation.x = Math.PI / 2;
    var ledHdd = add(pc, new T.CylinderGeometry(0.0038, 0.0038, 0.004, 14), new T.MeshStandardMaterial({ color: lin('#2a2016'), emissive: lin('#ffae3a'), emissiveIntensity: 0, roughness: 0.3 }), 0.108, 0.044, FZ + 0.002, { cast: false });
    ledHdd.rotation.x = Math.PI / 2;
    // botão de power (clicável)
    var powerGroup = new T.Group(); powerGroup.position.set(0.172, 0.02, FZ); pc.add(powerGroup);
    powerGroup.userData.pick = 'power';
    var powerSymTex = canvasTex(64, 64, function (x) {
      x.fillStyle = '#c4b594'; x.fillRect(0, 0, 64, 64);
      x.strokeStyle = '#5a5040'; x.lineWidth = 5; x.lineCap = 'round';
      x.beginPath(); x.arc(32, 34, 15, -Math.PI * 0.32, Math.PI * 1.32); x.stroke();
      x.beginPath(); x.moveTo(32, 12); x.lineTo(32, 32); x.stroke();
    });
    var powerBtn = add(powerGroup, rbox(0.034, 0.034, 0.012, 0.005), std('#c4b594', { roughness: 0.5 }), 0, 0, 0.004);
    add(powerBtn, new T.PlaneGeometry(0.026, 0.026), std('#ffffff', { map: powerSymTex, roughness: 0.5 }), 0, 0, 0.0062, { cast: false });
    add(powerGroup, new T.BoxGeometry(0.042, 0.042, 0.004), M.beigeDark, 0, 0, 0.0005, { cast: false });
    var powerProxy = add(powerGroup, new T.BoxGeometry(0.075, 0.075, 0.05), new T.MeshBasicMaterial({ visible: false }), 0, 0, 0.01, { cast: false, receive: false });
    powerProxy.userData.proxy = true;
    // ventoinha (só visual) atrás de uma grade redonda
    var fanGroup = new T.Group(); fanGroup.position.set(0.122, -0.03, FZ - 0.004); pc.add(fanGroup);
    add(fanGroup, new T.CircleGeometry(0.025, 28), M.black, 0, 0, 0, { cast: false });
    var fanBlades = new T.Group(); fanBlades.position.z = 0.002; fanGroup.add(fanBlades);
    for (var fb = 0; fb < 5; fb++) { var bl = add(fanBlades, new T.BoxGeometry(0.009, 0.021, 0.0015), std('#6b6e72', { roughness: 0.5 }), 0, 0, 0, { cast: false }); bl.geometry.translate(0, 0.012, 0); bl.rotation.z = fb / 5 * Math.PI * 2; bl.rotation.y = 0.5; }
    add(fanBlades, new T.CylinderGeometry(0.006, 0.006, 0.003, 14), M.darkGray, 0, 0, 0, { cast: false }).rotation.x = Math.PI / 2;
    [0.025, 0.018, 0.011].forEach(function (r) { add(fanGroup, new T.TorusGeometry(r, 0.0016, 6, 32), M.beigeCase, 0, 0, 0.0055, { cast: false }); });
    add(fanGroup, new T.BoxGeometry(0.05, 0.0018, 0.002), M.beigeCase, 0, 0, 0.0058, { cast: false });
    for (var vs = 0; vs < 5; vs++) add(pc, new T.BoxGeometry(0.032, 0.003, 0.003), M.black, 0.178, -0.05 + vs * 0.008, FZ + 0.0008, { cast: false });

    // ---- monitor CRT
    var mon = new T.Group(); mon.position.set(CX, 1.134, -2.035); mon.rotation.x = -0.045; room.add(mon);
    (function () {
      var bev = 0.008;
      var outer = rrShape(0.40 - 2 * bev, 0.36 - 2 * bev, 0.022, 0, -0.019);
      outer.holes.push(rrShape(SW + 2 * bev + 0.002, SH + 2 * bev + 0.002, 0.006, 0, 0, new T.Path()));
      var bezel = add(mon, new T.ExtrudeGeometry(outer, { depth: 0.03, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 6 }), M.beigeMon, 0, 0, -0.026);
      bezel.name = 'moldura';
      // corpo do tubo, afunilando para trás
      var bg = new T.BoxGeometry(0.385, 0.345, 0.34, 1, 1, 1), p = bg.attributes.position;
      for (var i = 0; i < p.count; i++) if (p.getZ(i) < 0) { p.setX(i, p.getX(i) * 0.62); p.setY(i, p.getY(i) * 0.66 - 0.012); }
      bg.computeVertexNormals();
      add(mon, bg, M.beigeMon, 0, -0.019, -0.026 - 0.17);
      add(mon, rbox(0.15, 0.13, 0.07, 0.012), M.beigeDark, 0, -0.045, -0.39);
      for (var s = 0; s < 6; s++) add(mon, new T.BoxGeometry(0.11, 0.004, 0.006), M.black, 0, 0.02 - s * 0.012, -0.426, { cast: false });
      // máscara preta atrás do vidro (fecha os cantos)
      add(mon, new T.PlaneGeometry(SW + 0.02, SH + 0.02), new T.MeshBasicMaterial({ color: 0x050505 }), 0, 0, -0.008, { cast: false });
      // base giratória
      add(mon, new T.CylinderGeometry(0.105, 0.12, 0.014, 36), M.beigeDark, 0, -0.214, -0.17);
    })();
    // tela: plano subdividido com leve abaulamento; os 4 cantos ficam em z=0
    var screenCanvas = document.createElement('canvas'); screenCanvas.width = 1024; screenCanvas.height = 768;
    var sctx = screenCanvas.getContext('2d');
    var screenTex = new T.CanvasTexture(screenCanvas);
    // Mipmaps evitam moiré das scanlines quando a tela aparece pequena. Em WebGL2 a textura NPOT (1024×768)
    // aceita mipmap; em WebGL1 não (o three redimensionaria), então lá ficam sem mipmap e sem scanlines.
    var canMip = !!renderer.capabilities.isWebGL2;
    screenTex.encoding = T.sRGBEncoding; screenTex.generateMipmaps = canMip; screenTex.minFilter = canMip ? T.LinearMipmapLinearFilter : T.LinearFilter; screenTex.anisotropy = maxAniso;
    textures.push(screenTex);
    var screenGeo = new T.PlaneGeometry(SW, SH, 32, 24);
    (function () {
      var p = screenGeo.attributes.position, hw = SW / 2, hh = SH / 2;
      for (var i = 0; i < p.count; i++) { var u = p.getX(i) / hw, v = p.getY(i) / hh; p.setZ(i, BULGE * (1 - 0.5 * (u * u + v * v))); }
      screenGeo.computeVertexNormals();
    })();
    var screenMat = new T.MeshBasicMaterial({ map: screenTex, toneMapped: false });
    var screen = add(mon, screenGeo, screenMat, 0, 0, 0, { cast: false, receive: false });
    screen.name = 'tela'; screen.userData.pick = 'screen';
    var CORNERS = [V(-SW / 2, SH / 2, 0), V(SW / 2, SH / 2, 0), V(SW / 2, -SH / 2, 0), V(-SW / 2, -SH / 2, 0)];
    // brilho do vidro (reflexo diagonal)
    var glareTex = canvasTex(512, 384, function (x, w, h) {
      var g = x.createLinearGradient(0, 0, w * 0.7, h); g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(0.22, 'rgba(255,255,255,.12)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,.05)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      var r = x.createRadialGradient(w * 0.24, h * 0.18, 4, w * 0.24, h * 0.18, w * 0.22); r.addColorStop(0, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = r; x.fillRect(0, 0, w, h);
    });
    var glare = add(mon, screenGeo.clone(), new T.MeshBasicMaterial({ map: glareTex, transparent: true, opacity: 0.16, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }), 0, 0, 0.0015, { cast: false, receive: false });
    glare.userData.noPick = true; glare.renderOrder = 2;
    // Halo do CRT: um "bloom" falso que vaza da borda do vidro para a moldura (aditivo, cor do tema).
    // Por dentro fica quase transparente para não lavar a imagem; quem dá a intensidade é o update().
    var HALO_W = SW + 0.13, HALO_H = SH + 0.13;
    var haloTex = canvasTex(512, Math.round(512 * HALO_H / HALO_W), function (x, w, h) {
      var sw = w * SW / HALO_W, sh = h * SH / HALO_H, sx = (w - sw) / 2, sy = (h - sh) / 2, off = 4000;
      x.save(); x.shadowColor = '#ffffff'; x.shadowBlur = 46; x.shadowOffsetX = off;
      x.fillStyle = '#ffffff'; rr(x, sx - off, sy, sw, sh, 10); x.fill(); x.restore();
      x.globalCompositeOperation = 'destination-out';
      x.filter = 'blur(6px)'; x.fillStyle = 'rgba(0,0,0,.9)'; rr(x, sx + 6, sy + 6, sw - 12, sh - 12, 8); x.fill();
      x.filter = 'none'; x.globalCompositeOperation = 'source-over';
    });
    var haloMat = new T.MeshBasicMaterial({ map: haloTex, color: 0xffffff, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false });
    var halo = add(mon, new T.PlaneGeometry(HALO_W, HALO_H), haloMat, 0, 0, 0.0145, { cast: false, receive: false });
    halo.userData.noPick = true; halo.renderOrder = 3; halo.visible = false;
    // logotipo em relevo
    var logoTex = canvasTex(512, 64, function (x, w, h) {
      x.clearRect(0, 0, w, h); x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = 'bold 44px ' + SANS;
      var t = 'ANDREY · 486';
      x.fillStyle = 'rgba(255,250,235,.85)'; x.fillText(t, w / 2 - 1.5, h / 2 - 1.5);
      x.fillStyle = 'rgba(70,58,40,.75)'; x.fillText(t, w / 2 + 1.5, h / 2 + 1.5);
      x.fillStyle = '#a99a7b'; x.fillText(t, w / 2, h / 2);
    });
    add(mon, new T.PlaneGeometry(0.15, 0.019), new T.MeshStandardMaterial({ map: logoTex, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1 }), 0, -0.158, 0.0125, { cast: false });
    var ledMon = add(mon, new T.CylinderGeometry(0.0035, 0.0035, 0.004, 12), ledMat(), -0.168, -0.168, 0.0125, { cast: false });
    ledMon.rotation.x = Math.PI / 2;
    add(mon, new T.CylinderGeometry(0.006, 0.006, 0.005, 16), M.beigeDark, -0.15, -0.168, 0.012, { cast: false }).rotation.x = Math.PI / 2;
    // post-it "aperta o botão aí"
    var noteMon = add(mon, (function () { var g = new T.PlaneGeometry(0.078, 0.078, 1, 6), p = g.attributes.position; for (var i = 0; i < p.count; i++) { var v = p.getY(i) / 0.078 + 0.5; if (v < 0.35) p.setZ(i, Math.pow((0.35 - v) / 0.35, 2) * 0.006); } g.computeVertexNormals(); return g; })(),
      std('#ffffff', { map: noteTex('#f7e36a', ['aperta o', 'botão aí'], { size: 50, y: 92, arrow: true }), roughness: 0.85, side: T.DoubleSide }), 0.152, -0.166, 0.0135, { cast: false });
    noteMon.rotation.z = -0.09;

    // ---- teclado (teclas em InstancedMesh)
    var kb = new T.Group(); kb.position.set(CX, DESK_Y, -1.83); kb.rotation.x = 0.055; room.add(kb);
    add(kb, rbox(0.45, 0.026, 0.165, 0.008), M.beigeMon, 0, 0.013, 0);
    blob(room, CX, DESK_Y + 0.002, -1.83, 0.56, 0.24, 0.5);
    var KU = 0.0195, keyDefs = [], alphaKeys = [];
    (function () {
      var x0 = -0.205, rows = [
        { z: -0.064, keys: [[1, 1], [1, 0, 1], [1, 1], [1, 1], [1, 1], [1, 1], [0.5, 0, 1], [1, 1], [1, 1], [1, 1], [1, 1], [0.5, 0, 1], [1, 1], [1, 1], [1, 1], [1, 1]] },
        { z: -0.038, keys: [[1, 1]].concat(Array(12).fill([1, 0]), [[2, 1]]) },
        { z: -0.0185, keys: [[1.5, 1]].concat(Array(12).fill([1, 0]), [[1.5, 1]]) },
        { z: 0.001, keys: [[1.75, 1]].concat(Array(11).fill([1, 0]), [[2.25, 1]]) },
        { z: 0.0205, keys: [[2.25, 1]].concat(Array(10).fill([1, 0]), [[2.75, 1]]) },
        { z: 0.04, keys: [[1.5, 1], [1.5, 1], [9, 0], [1.5, 1], [1.5, 1]] }
      ];
      rows.forEach(function (row) {
        var x = x0;
        row.keys.forEach(function (k) {
          var w = k[0] * KU;
          if (!k[2]) { keyDefs.push({ x: x + w / 2, z: row.z, w: w - 0.0022, dark: !!k[1] }); if (!k[1] && row.z > -0.05 && row.z < 0.03) alphaKeys.push(keyDefs.length - 1); }
          x += w;
        });
      });
      var nx = x0 + 15.5 * KU;
      for (var r = 0; r < 5; r++) for (var c = 0; c < 4; c++) keyDefs.push({ x: nx + c * KU + KU / 2, z: -0.038 + r * 0.0195, w: KU - 0.0022, dark: c === 3 || r === 0 });
    })();
    var keyMesh = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), M.beigeKey, keyDefs.length);
    keyMesh.castShadow = true; keyMesh.receiveShadow = true;
    var keyMatrix = new T.Matrix4(), keyQuat = new T.Quaternion(), keyScale = V(1, 1, 1), keyPos = V(0, 0, 0);
    function setKey(i, sink) {
      var k = keyDefs[i];
      keyPos.set(k.x, 0.031 - (sink || 0), k.z); keyScale.set(k.w, 0.011, 0.0172);
      keyMatrix.compose(keyPos, keyQuat, keyScale); keyMesh.setMatrixAt(i, keyMatrix);
    }
    keyDefs.forEach(function (k, i) { setKey(i, 0); keyMesh.setColorAt(i, k.dark ? lin('#2a2d32') : lin('#3a3e45')); });
    keyMesh.instanceMatrix.needsUpdate = true;
    if (keyMesh.instanceColor) keyMesh.instanceColor.needsUpdate = true;
    kb.add(keyMesh);
    add(kb, new T.BoxGeometry(0.008, 0.002, 0.004), std('#39ff6a', { emissive: '#39ff6a', emissiveIntensity: 0 }), 0.17, 0.0262, -0.066, { cast: false });

    // ---- mouse com fio + mousepad
    var mousepad = add(room, rbox(0.23, 0.004, 0.19, 0.012), std('#24344d', { roughness: 0.9 }), 0.33, DESK_Y + 0.002, -1.85);
    var mouse = new T.Group(); mouse.position.set(0.34, DESK_Y + 0.004, -1.84); mouse.rotation.y = -0.12; room.add(mouse);
    var mBody = add(mouse, new T.SphereGeometry(1, 24, 16), M.beigeMon, 0, 0, 0); mBody.scale.set(0.031, 0.019, 0.052);
    add(mouse, new T.BoxGeometry(0.0015, 0.004, 0.024), M.beigeDark, 0, 0.0165, -0.03, { cast: false }).rotation.x = -0.35;
    add(mouse, new T.BoxGeometry(0.05, 0.002, 0.0015), M.beigeDark, 0, 0.0178, -0.016, { cast: false });
    blob(room, 0.34, DESK_Y + 0.0045, -1.84, 0.1, 0.14, 0.45);
    tube(room, [V(0.333, DESK_Y + 0.008, -1.892), V(0.32, DESK_Y + 0.006, -1.95), V(0.24, DESK_Y + 0.005, -1.99), V(0.2, DESK_Y + 0.006, -2.1), V(0.16, DESK_Y + 0.03, -2.38), V(0.06, DESK_Y + 0.06, -2.43)], 0.0026, M.cable);
    tube(room, [V(CX - 0.02, DESK_Y + 0.02, -1.915), V(CX - 0.17, DESK_Y + 0.006, -1.935), V(CX - 0.26, DESK_Y + 0.006, -2.0), V(CX - 0.27, DESK_Y + 0.02, -2.38), V(CX - 0.18, DESK_Y + 0.06, -2.43)], 0.003, M.cable); // por fora da base do monitor
    tube(room, [V(CX + 0.06, DESK_Y + 0.06, -2.41), V(CX + 0.2, DESK_Y + 0.01, -2.46), V(0.4, 0.5, -2.47), V(0.45, 0.12, -2.46), V(0.55, 0.2, -2.468)], 0.004, M.cableDark);
    add(room, new T.BoxGeometry(0.07, 0.11, 0.012), std('#f0eadc'), 0.56, 0.22, ZB + 0.026, { cast: false });

    // Malha do vidro medido inteiro (mais largo que o 4:3), no espaço do grupo 'mon', para o reflexo.
    function glassGeo(P, S, ref) {
      var G = P.GLASS_RECT || { x0: P.SCREEN.cx - P.SCREEN.halfW, x1: P.SCREEN.cx + P.SCREEN.halfW, y0: P.SCREEN.cy - P.SCREEN.halfH, y1: P.SCREEN.cy + P.SCREEN.halfH };
      var w = (G.x1 - G.x0) * 0.985, h = (G.y1 - G.y0) * 0.985, gx = (G.x0 + G.x1) / 2, gy = (G.y0 + G.y1) / 2;
      var geo = new T.PlaneGeometry(S * w, S * h, 24, 18), pp = geo.attributes.position;
      for (var i = 0; i < pp.count; i++) {
        var mx = gx + pp.getX(i) / S, my = gy + pp.getY(i) / S;
        pp.setX(i, S * (mx - P.SCREEN.cx)); pp.setY(i, S * (my - P.SCREEN.cy));
        pp.setZ(i, S * (P.glassZ((mx - P.SCREEN.cx) / P.SCREEN.halfW, (my - P.SCREEN.cy) / P.SCREEN.halfH) - ref) + 0.0015);
      }
      geo.computeVertexNormals();
      return geo;
    }
    // ---- PC gerado no Higgsfield (pc-glb.js, assets/pc-grafite.glb): monitor grafite com o botão no queixo.
    // O PC desenhado acima é a reserva: aparece enquanto o modelo carrega e fica se o GLB falhar.
    // Quando o GLB chega, a casca desenhada some; tela, reflexo, halo, LED e botão vão para as
    // posições medidas no modelo (assets/pc-grafite.json), e teclado e mouse ficam grafite.
    // Avisa a página (o loader espera por isto) se ficou o PC gerado ou o desenhado.
    function pcSettled(kind) { try { global.dispatchEvent(new CustomEvent('andreyos:pc', { detail: kind })); } catch (e) { /* navegador antigo: o loader tem teto */ } }
    if (global.AndreyPC && T.GLTFLoader && opts.pcUrl !== false) {
      global.AndreyPC.load(T, opts.pcUrl || 'assets/pc-grafite.glb').then(function (pcg) {
        if (disposed) return;
        var P = global.AndreyPC, SC = P.SCREEN;
        var S = SW / ((P.SCALE_HALFW || SC.halfW) * 2); // escala do monitor no quarto (a mesma de antes)
        var W2 = 2 * SC.halfW * S, H2 = 2 * SC.halfH * S; // a imagem enche o vidro inteiro do modelo
        var g = pcg.group;
        g.scale.setScalar(S);
        // a frente do monitor (z = 0,5 no modelo) fica 12 cm atrás do teclado
        g.position.set(CX - S * SC.cx, DESK_Y, -1.95 - S * 0.5);
        g.remove(pcg.screen); g.remove(pcg.power);
        g.children.forEach(function (c) { if (c !== pcg.model) c.visible = false; }); // LEDs do pc-glb: usamos os da cena
        // A malha tem 116 mil triângulos: fica fora do raycast (hover a cada movimento do mouse).
        // A luz quente do quarto clareia o grafite: a cor do modelo desce um pouco para ele ler escuro.
        pcg.model.traverse(function (o) { if (o.isMesh) { o.raycast = function () {}; if (o.material && o.material.color) { o.material.color.multiplyScalar(0.62); o.material.envMapIntensity = 0.35; } } });
        room.add(g);
        g.updateMatrixWorld(true);
        function inRoom(x, y, z) { return V(g.position.x + S * x, g.position.y + S * y, g.position.z + S * z); }

        // Botão de ligar: só o alvo de clique (o botão de verdade é o do modelo). O anel laranja acende
        // quando liga (o ledPower vira um anel em volta do botão); o LED âmbar pisca com o "disco".
        [ledPower, ledHdd, powerGroup].forEach(function (o) { room.add(o); });
        powerGroup.position.copy(inRoom(P.POWER.x, P.POWER.y, P.POWER.z - 0.006));
        powerGroup.children.forEach(function (c) { if (!c.userData.proxy) c.visible = false; });
        ledPower.geometry.dispose();
        ledPower.geometry = new T.TorusGeometry(S * P.POWER.r * 0.93, 0.0016, 8, 48);
        ledPower.rotation.set(0, 0, 0);
        ledPower.material.emissive.copy(linc('#ff7a2f')); ledPower.material.color.copy(linc('#3a2418'));
        ledPower.material.toneMapped = false; ledPower.material.needsUpdate = true; ringRest = true;
        ledPower.position.copy(inRoom(P.POWER.x, P.POWER.y, P.POWER.z + 0.002));
        ledHdd.position.copy(inRoom(P.LED_CASE.x, P.LED_CASE.y, P.LED_CASE.z + 0.002));
        pc.visible = false;
        monBounds = new T.Box3().setFromObject(pcg.model);

        // Monitor: o grupo 'mon' passa a ficar no plano dos 4 cantos do vidro do modelo.
        var cz = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(function (p) { return P.glassZ(p[0], p[1]); });
        var ref = (cz[0] + cz[1] + cz[2] + cz[3]) / 4;
        var keep = [screen, glare, halo];
        mon.children.forEach(function (c) { if (keep.indexOf(c) < 0) c.visible = false; }); // post-it e LED do desenhado saem: visual limpo
        mon.rotation.set(0, 0, 0);
        mon.position.copy(inRoom(SC.cx, SC.cy, ref));
        var p = screenGeo.attributes.position, hw = W2 / 2, hh = H2 / 2;
        for (var i = 0; i < p.count; i++) {
          var nx = p.getX(i) / (SW / 2), ny = p.getY(i) / (SH / 2); // de -1 a 1 no retângulo antigo
          p.setXYZ(i, nx * hw, ny * hh, S * (P.glassZ(nx, ny) - ref));
        }
        p.needsUpdate = true; screenGeo.computeVertexNormals(); screenGeo.computeBoundingSphere();
        glare.geometry.dispose(); glare.geometry = screenGeo.clone();
        [[-1, 1], [1, 1], [1, -1], [-1, -1]].forEach(function (c, k) { CORNERS[k].set(c[0] * hw, c[1] * hh, S * (cz[k] - ref)); });
        halo.scale.set(W2 / SW, H2 / SH, 1);
        SW = W2; SH = H2; // daqui em diante (pose da câmera na tela) vale o tamanho do vidro novo
        halo.position.z = S * (P.glassZ(0, 0) - ref) + 0.004;
        // A luz que a tela joga na mesa sai do vidro novo, não do monitor desenhado.
        mon.updateMatrixWorld(true);
        screenLight.position.copy(V(0, 0, 0.05).applyMatrix4(mon.matrixWorld));
        screenLight.target.position.copy(V(0, -0.35, 1.0).applyMatrix4(mon.matrixWorld));
        screenLight.target.updateMatrixWorld();

        // Teclado, mouse e cabos desenhados ficam (já nascem grafite); o mousepad escurece.
        if (mousepad) mousepad.material.color.copy(linc('#17191c'));
        // O reflexo cobre o vidro inteiro (não só o 4:3), senão ele desenha um retângulo no vidro preto.
        glare.geometry.dispose(); glare.geometry = glassGeo(P, S, ref);

        decorateMonitor(pcg.model, g, S); // depois de o grupo da tela ir para o vidro novo (o post-it mora nele)
        curvedGlass = true; screenDirty = true;
        // A tela mudou de lugar: se a câmera estava nela (ou indo para ela), refaz a pose.
        var pose = stopPose(stop);
        if (flight) { flight.toPos = pose.pos; flight.toTarget = pose.target; }
        else { basePos.copy(pose.pos); baseTarget.copy(pose.target); }
        hoverDirty = true;
        renderer.shadowMap.needsUpdate = true;
        document.body && (document.body.dataset.pc = 'gerado');
        kick();
        pcSettled('gerado');
      }).catch(function (err) {
        if (global.console) console.warn('PC gerado não carregou; fica o desenhado.', err && (err.message || err.type || String(err)));
        pcSettled('desenhado');
      });
    } else pcSettled('desenhado');

    // ---- disquetes e caneta
    function floppy(x, z, ry, col, y) {
      var g = new T.Group(); g.position.set(x, DESK_Y + (y || 0) + 0.0017, z); g.rotation.y = ry; room.add(g);
      add(g, new T.BoxGeometry(0.09, 0.0033, 0.094), std(col, { roughness: 0.5 }), 0, 0, 0);
      add(g, new T.BoxGeometry(0.046, 0.0036, 0.032), M.metal, 0.006, 0, -0.031, { cast: false });
      add(g, new T.BoxGeometry(0.066, 0.0036, 0.042), M.paper, 0, 0, 0.021, { cast: false });
      return g;
    }
    floppy(0.5, -2.2, 0.35, '#2f4f8f'); floppy(0.51, -2.21, -0.15, '#1e1e20', 0.0034);
    blob(room, 0.5, DESK_Y + 0.001, -2.2, 0.16, 0.16, 0.35);
    rod(room, V(0.42, DESK_Y + 0.005, -2.0), V(0.56, DESK_Y + 0.005, -2.04), 0.0045, std('#c0362c', { roughness: 0.4 }), 10);

    // ---- caneca com café
    var mug = new T.Group(); mug.position.set(-0.5, DESK_Y, -1.86); mug.rotation.y = 0.5; room.add(mug);
    var mugProfile = [[0.001, 0], [0.034, 0], [0.038, 0.005], [0.04, 0.088], [0.0395, 0.093], [0.036, 0.093], [0.035, 0.086], [0.033, 0.012], [0.001, 0.01]].map(function (q) { return new T.Vector2(q[0], q[1]); });
    var mugMat = std('#2f6a67', { roughness: 0.28 });
    add(mug, new T.LatheGeometry(mugProfile, 32), mugMat, 0, 0, 0);
    var coffee = add(mug, new T.CircleGeometry(0.034, 28), std('#2e1a0f', { roughness: 0.15 }), 0, 0.076, 0, { cast: false });
    coffee.rotation.x = -Math.PI / 2;
    var handleM = add(mug, new T.TorusGeometry(0.024, 0.0068, 10, 20, Math.PI), mugMat, 0.038, 0.048, 0);
    handleM.rotation.z = -Math.PI / 2;
    add(mug, new T.CylinderGeometry(0.0405, 0.0405, 0.012, 32, 1, true), std('#e9dcc3', { roughness: 0.4 }), 0, 0.06, 0, { cast: false });
    blob(room, -0.5, DESK_Y + 0.001, -1.86, 0.14, 0.14, 0.55);

    // ---- luminária de mesa (a luz principal à noite, com sombra)
    var lamp = new T.Group(); room.add(lamp);
    var LAMP_BASE = V(-0.8, DESK_Y, -2.28), LAMP_ELBOW = V(-0.74, 1.2, -2.34), LAMP_PIVOT = V(-0.6, 1.33, -2.07), LAMP_AIM = V(-0.36, DESK_Y, -1.86);
    add(lamp, new T.CylinderGeometry(0.07, 0.078, 0.022, 36), M.lamp, LAMP_BASE.x, DESK_Y + 0.011, LAMP_BASE.z);
    var lampBlob = blob(room, LAMP_BASE.x, DESK_Y + 0.001, LAMP_BASE.z, 0.22, 0.22, 0.55);
    var j0 = V(LAMP_BASE.x, DESK_Y + 0.035, LAMP_BASE.z);
    add(lamp, new T.SphereGeometry(0.013, 14, 10), M.brass, j0.x, j0.y, j0.z);
    rod(lamp, j0, LAMP_ELBOW, 0.008, M.lamp, 10);
    rod(lamp, j0.clone().add(V(0.018, 0, 0)), LAMP_ELBOW.clone().add(V(0.018, 0, 0)), 0.002, M.metal, 6);
    add(lamp, new T.SphereGeometry(0.012, 14, 10), M.brass, LAMP_ELBOW.x, LAMP_ELBOW.y, LAMP_ELBOW.z);
    rod(lamp, LAMP_ELBOW, LAMP_PIVOT, 0.007, M.lamp, 10);
    var lampDir = V(0, 0, 0).subVectors(LAMP_AIM, LAMP_PIVOT).normalize();
    var shade = new T.Group(); shade.position.copy(LAMP_PIVOT); shade.quaternion.setFromUnitVectors(V(0, -1, 0), lampDir); lamp.add(shade);
    add(shade, new T.SphereGeometry(0.03, 16, 12), M.lamp, 0, 0, 0, { cast: false });
    var shadeOuter = add(shade, new T.CylinderGeometry(0.03, 0.085, 0.13, 32, 1, true), M.lamp, 0, -0.07, 0, { cast: false });
    var shadeInner = add(shade, new T.CylinderGeometry(0.029, 0.083, 0.128, 32, 1, true), new T.MeshStandardMaterial({ color: lin('#f6e7c8'), emissive: lin('#ffd59a'), emissiveIntensity: 0.55, side: T.BackSide, roughness: 0.6 }), 0, -0.07, 0, { cast: false });
    var bulbMat = new T.MeshStandardMaterial({ color: lin('#fff5e0'), emissive: lin('#ffd9a3'), emissiveIntensity: 2.4 });
    add(shade, new T.SphereGeometry(0.024, 16, 12), bulbMat, 0, -0.105, 0, { cast: false });
    var bulbWorld = V(0, -0.1, 0).applyQuaternion(shade.quaternion).add(LAMP_PIVOT);

    // ------------------------------------------------------------ estante e projetos

    var shelf = new T.Group(); shelf.position.set(-2.3, 0, -2.33); room.add(shelf);
    var SHW = 1.0, SHH = 1.9, SHD = 0.3, LEVELS = [0.06, 0.46, 0.86, 1.26, 1.66];
    add(shelf, new T.BoxGeometry(0.026, SHH, SHD), M.shelf, -SHW / 2 + 0.013, SHH / 2, 0);
    add(shelf, new T.BoxGeometry(0.026, SHH, SHD), M.shelf, SHW / 2 - 0.013, SHH / 2, 0);
    add(shelf, new T.BoxGeometry(SHW + 0.02, 0.03, SHD + 0.01), M.shelf, 0, SHH - 0.015, 0.005);
    add(shelf, new T.BoxGeometry(SHW - 0.03, SHH - 0.04, 0.012), M.shelfBack, 0, SHH / 2, -SHD / 2 + 0.006);
    add(shelf, new T.BoxGeometry(SHW - 0.05, 0.05, 0.02), M.shelf, 0, 0.025, SHD / 2 - 0.01);
    LEVELS.forEach(function (y) { add(shelf, new T.BoxGeometry(SHW - 0.05, 0.025, SHD - 0.012), M.shelf, 0, y, 0.004); });
    // fitinha de LED quente sob cada prateleira (justifica a luz da estante)
    var ledStrip = new T.MeshStandardMaterial({ color: lin('#fff3dc'), emissive: lin('#ffc77e'), emissiveIntensity: 1.3 });
    LEVELS.slice(1).concat([SHH - 0.03]).forEach(function (y) { add(shelf, new T.BoxGeometry(SHW - 0.09, 0.004, 0.012), ledStrip, 0, y - 0.0145, SHD / 2 - 0.03, { cast: false }); });
    blob(room, -2.3, 0.005, -2.3, 1.3, 0.55, 0.55);
    var LV = LEVELS.map(function (y) { return y + 0.0125; });
    var shelfR = rng(91);
    var bookCols = ['#7b2e2a', '#2f5d58', '#c4893a', '#3d4f7a', '#8a6a4a', '#5b3a5e', '#d8c9a8', '#45624a', '#a4513a', '#27384f'];
    function books(x0, y, n, maxH, dir) {
      var x = x0;
      for (var i = 0; i < n; i++) {
        var w = 0.022 + shelfR() * 0.022, h = maxH * (0.72 + shelfR() * 0.28), d = 0.15 + shelfR() * 0.07;
        var b = add(shelf, new T.BoxGeometry(w, h, d), std(bookCols[Math.floor(shelfR() * bookCols.length)], { roughness: 0.8 }), x + dir * w / 2, y + h / 2, 0.12 - d / 2);
        if (i === n - 1 && shelfR() < 0.6) { b.rotation.z = -dir * 0.18; b.position.x += dir * 0.012; }
        x += dir * (w + 0.002);
      }
      return x;
    }

    var pickGroups = {};
    function projGroup(id, x, y, z, ry) {
      var g = new T.Group(); g.position.set(x, y, z); g.rotation.y = ry || 0; shelf.add(g);
      g.userData.pick = 'proj:' + id; g.name = 'proj:' + id;
      return g;
    }

    // Nível 4 (alto): Vereda (luminária cogumelo) e o cartucho roxo
    var vereda = projGroup('vereda', -0.3, LV[4], 0.02, 0.2);
    add(vereda, new T.CylinderGeometry(0.05, 0.056, 0.014, 28), std('#5a3b27', { roughness: 0.5 }), 0, 0.007, 0);
    add(vereda, new T.CylinderGeometry(0.016, 0.024, 0.11, 18), std('#efe3cc', { roughness: 0.6 }), 0, 0.068, 0);
    var capMat = new T.MeshStandardMaterial({ color: lin('#f4e6cc'), emissive: lin('#ffb466'), emissiveIntensity: 0.85, roughness: 0.7 });
    var cap = add(vereda, new T.SphereGeometry(0.078, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), capMat, 0, 0.118, 0, { cast: false });
    cap.scale.y = 0.72;
    add(vereda, new T.CircleGeometry(0.077, 28), new T.MeshStandardMaterial({ color: lin('#fff1d6'), emissive: lin('#ffc27a'), emissiveIntensity: 1.6 }), 0, 0.118, 0, { cast: false }).rotation.x = Math.PI / 2;
    books(-0.02, LV[4], 4, 0.2, 1);
    var jogo = projGroup('jogo', 0.3, LV[4], 0.02, -0.35);
    var cartTex = canvasTex(256, 200, function (x, w, h) {
      x.fillStyle = '#f2ead8'; rr(x, 6, 6, w - 12, h - 12, 14); x.fill();
      x.fillStyle = '#20163a'; rr(x, 18, 18, w - 36, 110, 8); x.fill();
      var cols = ['#ffcf4a', '#ff6b6b', '#5fd1ff', '#7cff8a'], cells = [[2, 4, 0], [3, 4, 0], [4, 4, 0], [3, 3, 0], [6, 4, 1], [6, 3, 1], [7, 3, 1], [7, 2, 1], [9, 4, 2], [10, 4, 2], [9, 3, 2], [10, 3, 2], [12, 4, 3], [12, 3, 3], [12, 2, 3], [12, 1, 3]];
      cells.forEach(function (c) { x.fillStyle = cols[c[2]]; x.fillRect(22 + c[0] * 14, 18 + c[1] * 18 + 8, 13, 17); });
      x.fillStyle = '#4a2a78'; x.font = 'bold 40px ' + SANS; x.textAlign = 'center'; x.fillText('BLOCOS', w / 2, 172);
    });
    add(jogo, rbox(0.1, 0.12, 0.022, 0.006), std('#6a3e9e', { roughness: 0.45 }), 0, 0.062, 0);
    add(jogo, new T.PlaneGeometry(0.076, 0.06), std('#ffffff', { map: cartTex, roughness: 0.6 }), 0, 0.07, 0.0115, { cast: false });
    for (var cr = 0; cr < 4; cr++) add(jogo, new T.BoxGeometry(0.08, 0.0025, 0.024), std('#7a4cb0', { roughness: 0.45 }), 0, 0.106 - cr * 0.004, 0, { cast: false }); // frisos do cartucho

    // Nível 3: Prolog entre livros e o globo de neve (FlashClip)
    var bx = books(-0.47, LV[3], 3, 0.25, 1);
    var prolog = projGroup('prolog', bx + 0.021, LV[3], 0.05, 0);
    var spineTex = canvasTex(96, 512, function (x, w, h) {
      x.fillStyle = '#244a3a'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#d9b45a'; x.fillRect(0, 34, w, 6); x.fillRect(0, h - 40, w, 6); x.fillRect(0, 46, w, 2); x.fillRect(0, h - 50, w, 2);
      x.save(); x.translate(w / 2 + 2, h / 2); x.rotate(-Math.PI / 2); x.font = 'bold 54px ' + SANS; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('PROLOG', 0, 0); x.restore();
    });
    var pMats = [std('#244a3a'), std('#244a3a'), std('#efe6d2'), std('#efe6d2'), std('#ffffff', { map: spineTex, roughness: 0.6 }), std('#244a3a')];
    add(prolog, new T.BoxGeometry(0.042, 0.255, 0.2), pMats, 0, 0.1275, 0);
    books(bx + 0.046, LV[3], 3, 0.24, 1);
    for (var hb = 0; hb < 3; hb++) { var hbk = add(shelf, new T.BoxGeometry(0.17 - hb * 0.015, 0.03, 0.13), std(bookCols[(hb * 4 + 2) % bookCols.length], { roughness: 0.8 }), 0.03, LV[3] + 0.015 + hb * 0.031, 0.03); hbk.rotation.y = (hb - 1) * 0.1; }
    var flash = projGroup('flashclip', 0.28, LV[3], 0.02, 0);
    add(flash, new T.CylinderGeometry(0.058, 0.068, 0.04, 30), std('#4a2e1e', { roughness: 0.5 }), 0, 0.02, 0);
    add(flash, new T.CylinderGeometry(0.0605, 0.0605, 0.01, 30), std('#c0362c', { roughness: 0.5 }), 0, 0.031, 0, { cast: false });
    add(flash, new T.SphereGeometry(0.055, 24, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), std('#f7f7f2', { roughness: 0.9 }), 0, 0.103, 0, { cast: false });
    add(flash, new T.ConeGeometry(0.022, 0.06, 10), std('#2e6a3d', { roughness: 0.7 }), 0, 0.1, 0, { cast: false });
    add(flash, new T.OctahedronGeometry(0.007), std('#f2c94c', { emissive: '#f2c94c', emissiveIntensity: 0.6 }), 0, 0.134, 0, { cast: false });
    for (var sf = 0; sf < 12; sf++) { var a = sf * 2.4, rr2 = 0.015 + (sf % 4) * 0.009; add(flash, new T.IcosahedronGeometry(0.0028, 0), M.paper, Math.cos(a) * rr2, 0.09 + (sf % 5) * 0.012, Math.sin(a) * rr2, { cast: false }); }
    var globeGlass = add(flash, new T.SphereGeometry(0.066, 28, 20), new T.MeshStandardMaterial({ color: lin('#dfefff'), transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0, depthWrite: false }), 0, 0.104, 0, { cast: false, receive: false });
    globeGlass.renderOrder = 3;

    // Nível 2: mini kanban (G2) e a câmera (Metadados Zero)
    var g2 = projGroup('g2', -0.22, LV[2], 0.0, 0.12);
    var kanTex = canvasTex(512, 360, function (x, w, h) {
      x.fillStyle = '#fbf8f1'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#ff3e00'; x.fillRect(0, 0, w, 40);
      x.fillStyle = '#fff'; x.font = 'bold 26px ' + SANS; x.fillText('G2 · kanban', 16, 29);
      var heads = ['a fazer', 'fazendo', 'feito'], cc = ['#ffd166', '#8ecae6', '#95d5b2'];
      for (var c = 0; c < 3; c++) {
        var cx = 14 + c * 166; x.fillStyle = '#ece6da'; x.fillRect(cx, 52, 152, h - 64);
        x.fillStyle = '#4a4036'; x.font = '22px ' + SANS; x.fillText(heads[c], cx + 10, 80);
        for (var k = 0; k < 3 - (c === 1 ? 1 : 0); k++) { x.fillStyle = cc[c]; x.fillRect(cx + 10, 96 + k * 76, 132, 62); x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(cx + 20, 112 + k * 76, 90, 7); x.fillRect(cx + 20, 128 + k * 76, 60, 7); }
      }
    });
    add(g2, rbox(0.23, 0.165, 0.012, 0.004), std('#8a6a4a', { roughness: 0.6 }), 0, 0.09, 0).rotation.x = -0.18;
    var kanFace = add(g2, new T.PlaneGeometry(0.212, 0.148), std('#ffffff', { map: kanTex, roughness: 0.7 }), 0, 0.09, 0.0065, { cast: false });
    kanFace.rotation.x = -0.18;
    add(g2, new T.BoxGeometry(0.01, 0.13, 0.01), std('#6b4a32'), 0, 0.065, -0.05).rotation.x = 0.4;
    var camG = projGroup('metadados', 0.24, LV[2], 0.03, -0.4);
    add(camG, rbox(0.13, 0.075, 0.05, 0.008), std('#1f1f21', { roughness: 0.75 }), 0, 0.0375, 0);
    add(camG, rbox(0.13, 0.022, 0.052, 0.006), std('#cfcfca', { roughness: 0.3, metalness: 0.7 }), 0, 0.083, 0);
    var lens = add(camG, new T.CylinderGeometry(0.028, 0.03, 0.04, 28), std('#2a2a2c', { roughness: 0.4, metalness: 0.4 }), -0.012, 0.038, 0.044);
    lens.rotation.x = Math.PI / 2;
    add(camG, new T.CircleGeometry(0.021, 24), std('#16243d', { roughness: 0.05, metalness: 0.3, emissive: '#1b2f55', emissiveIntensity: 0.25 }), -0.012, 0.038, 0.0645, { cast: false });
    add(camG, new T.BoxGeometry(0.028, 0.016, 0.006), std('#f2f2ee', { roughness: 0.2, emissive: '#ffffff', emissiveIntensity: 0.05 }), 0.038, 0.06, 0.026, { cast: false });
    add(camG, new T.CylinderGeometry(0.007, 0.007, 0.008, 14), M.metal, 0.044, 0.098, 0.0);

    // Nível 1: caixa de papelão (festejo-app) e o caderno azul (Front-end)
    var fest = projGroup('festejo', -0.23, LV[1], 0.01, 0.06);
    var boxLabel = canvasTex(256, 160, function (x, w, h) {
      x.fillStyle = '#f6f1e6'; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#2b2622'; x.lineWidth = 3; x.strokeRect(8, 8, w - 16, h - 16);
      x.fillStyle = '#2b2622'; x.font = '52px ' + HAND; x.textAlign = 'center'; x.fillText('festejo', w / 2, 82);
      x.font = '24px ' + SANS; x.fillStyle = '#c0362c'; x.fillText('este lado p/ cima', w / 2, 128);
    });
    add(fest, rbox(0.25, 0.17, 0.21, 0.004), std('#b98b57', { roughness: 0.92 }), 0, 0.085, 0);
    add(fest, new T.BoxGeometry(0.252, 0.002, 0.05), std('#d8b27a', { roughness: 0.5 }), 0, 0.1705, 0, { cast: false });
    add(fest, new T.BoxGeometry(0.05, 0.12, 0.002), std('#d8b27a', { roughness: 0.5 }), 0, 0.12, 0.1055, { cast: false });
    add(fest, new T.PlaneGeometry(0.088, 0.055), std('#ffffff', { map: boxLabel, roughness: 0.85 }), -0.074, 0.07, 0.1062, { cast: false });
    add(shelf, new T.BoxGeometry(0.2, 0.012, 0.25), std('#7b2e2a', { roughness: 0.8 }), 0.22, LV[1] + 0.006, 0.0);
    add(shelf, new T.BoxGeometry(0.19, 0.008, 0.24), std('#e7dcc6', { roughness: 0.9 }), 0.215, LV[1] + 0.016, 0.0).rotation.y = 0.08;
    var fe = projGroup('frontend', 0.22, LV[1] + 0.02, 0.0, -0.1);
    var feTex = canvasTex(256, 320, function (x, w, h) {
      x.fillStyle = '#2b5fce'; x.fillRect(0, 0, w, h);
      for (var i = 0; i < 400; i++) { x.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.06).toFixed(3) + ')'; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      x.fillStyle = '#f6f1e6'; rr(x, 50, 70, 170, 90, 10); x.fill();
      x.fillStyle = '#2b2622'; x.font = '40px ' + HAND; x.textAlign = 'center'; x.fillText('front-end', 135, 128);
      x.fillStyle = '#1d3f8f'; x.fillRect(0, 0, 26, h);
    });
    add(fe, new T.BoxGeometry(0.18, 0.014, 0.235), [std('#2b5fce'), std('#2b5fce'), std('#ffffff', { map: feTex, roughness: 0.7 }), std('#2b5fce'), std('#efe6d2'), std('#efe6d2')], 0, 0.007, 0);
    for (var sp = 0; sp < 8; sp++) add(fe, new T.TorusGeometry(0.008, 0.0016, 6, 14), M.metal, -0.09, 0.008, -0.1 + sp * 0.028, { cast: false }).rotation.y = Math.PI / 2;

    // Nível 2, no meio: katana num suporte (Kage no Toki, o jogo samurai em 3D)
    var kage = projGroup('kage', 0.01, LV[2], 0.05, 0);
    [-0.075, 0.075].forEach(function (x) {
      add(kage, new T.BoxGeometry(0.014, 0.05, 0.05), std('#141414', { roughness: 0.4 }), x, 0.025, 0);
      add(kage, new T.BoxGeometry(0.016, 0.012, 0.016), std('#141414', { roughness: 0.4 }), x, 0.054, 0.012);
    });
    add(kage, new T.BoxGeometry(0.2, 0.004, 0.06), std('#141414', { roughness: 0.5 }), 0, 0.002, 0);
    var blade = new T.Group(); blade.position.set(0, 0.058, 0); blade.rotation.z = 0.04; kage.add(blade);
    add(blade, new T.BoxGeometry(0.15, 0.011, 0.0035), std('#d9dde2', { roughness: 0.18, metalness: 0.9 }), -0.012, 0, 0);
    add(blade, new T.CylinderGeometry(0.012, 0.012, 0.004, 20), std('#b08a3a', { roughness: 0.35, metalness: 0.8 }), 0.066, 0, 0).rotation.z = Math.PI / 2;
    add(blade, new T.BoxGeometry(0.058, 0.013, 0.008), std('#1d1d22', { roughness: 0.8 }), 0.098, 0, 0);
    for (var wr = 0; wr < 5; wr++) add(blade, new T.BoxGeometry(0.004, 0.014, 0.009), std('#6b1d22', { roughness: 0.8 }), 0.074 + wr * 0.011, 0, 0, { cast: false }).rotation.y = 0.5;
    kage.scale.setScalar(1.2);
    // a lâmina é fina demais para acertar com o mouse: caixa invisível de clique em volta
    add(kage, new T.BoxGeometry(0.24, 0.09, 0.08), new T.MeshBasicMaterial({ visible: false }), 0, 0.04, 0, { cast: false, receive: false }).userData.proxy = true;

    // Nível 1, no meio: medalha impressa em 3D, em pé num suporte (as peças da impressora)
    var pecas = projGroup('pecas', -0.0, LV[1], 0.06, -0.12);
    add(pecas, new T.BoxGeometry(0.06, 0.01, 0.035), std('#2a2f36', { roughness: 0.6 }), 0, 0.005, 0);
    add(pecas, new T.BoxGeometry(0.012, 0.012, 0.012), std('#2a2f36', { roughness: 0.6 }), 0, 0.016, -0.008);
    var medal = add(pecas, new T.CylinderGeometry(0.034, 0.034, 0.006, 40), std('#d6a740', { roughness: 0.35, metalness: 0.75 }), 0, 0.052, 0);
    medal.rotation.x = Math.PI / 2 - 0.18;
    add(pecas, new T.TorusGeometry(0.027, 0.0028, 8, 36), std('#e9c25e', { roughness: 0.3, metalness: 0.8 }), 0, 0.052, 0.004, { cast: false }).rotation.x = -0.18;
    add(pecas, new T.BoxGeometry(0.016, 0.05, 0.002), std('#2563eb', { roughness: 0.7 }), -0.009, 0.098, -0.008, { cast: false }).rotation.z = 0.2;
    add(pecas, new T.BoxGeometry(0.016, 0.05, 0.002), std('#ff6b35', { roughness: 0.7 }), 0.009, 0.098, -0.008, { cast: false }).rotation.z = -0.2;

    // Nível 0: cestos; topo: planta pendente
    [-0.24, 0.22].forEach(function (x, i) {
      add(shelf, rbox(0.4, 0.26, 0.24, 0.02), std(i ? '#a98757' : '#9b7a4d', { roughness: 0.95 }), x, LV[0] + 0.13, 0.01);
      add(shelf, new T.BoxGeometry(0.405, 0.03, 0.245), std('#6e5232', { roughness: 0.9 }), x, LV[0] + 0.2, 0.01, { cast: false });
    });
    (function () {
      var y0 = SHH;
      add(shelf, new T.CylinderGeometry(0.075, 0.058, 0.12, 20), M.terracotta, -0.22, y0 + 0.06, 0.0);
      var R = rng(55), stemMat = std('#3d5f2c', { roughness: 0.8 });
      for (var vine = 0; vine < 4; vine++) {
        var ang = vine * 1.6 + R(), len = 4 + Math.floor(R() * 5);
        // o ramo sai da borda do vaso e passa por todas as folhas (sem ele as folhas pareciam soltas no ar)
        var stem = [V(-0.22 + Math.cos(ang) * 0.045, y0 + 0.118, Math.abs(Math.sin(ang)) * 0.035)];
        for (var l = 0; l < len; l++) {
          var t = l / len, lx = -0.22 + Math.cos(ang) * (0.06 + t * 0.03), lz = 0.0 + Math.abs(Math.sin(ang)) * 0.05 + t * 0.12, ly = y0 + 0.13 - t * t * 0.55 - (l > 2 ? (l - 2) * 0.03 : 0);
          var lf = add(shelf, new T.SphereGeometry(0.022, 8, 6), l % 2 ? M.leaf : M.leafDark, lx, ly, Math.min(lz, 0.17));
          lf.scale.set(1, 0.35, 0.7); lf.rotation.set(R() * 1.2, R() * 3, R() * 0.8);
          stem.push(V(lx, ly + 0.004, Math.min(lz, 0.17) - 0.004));
        }
        tube(shelf, stem, 0.0022, stemMat).castShadow = false;
      }
      for (var k = 0; k < 3; k++) { var b = add(shelf, new T.BoxGeometry(0.2, 0.03, 0.15), std(bookCols[(k * 3 + 1) % bookCols.length]), 0.24, y0 + 0.015 + k * 0.031, 0.0); b.rotation.y = (k - 1) * 0.12; }
    })();

    // ------------------------------------------------------------ mural de cortiça

    var board = new T.Group(); board.position.set(2.965, 1.5, -1.42); board.rotation.y = -Math.PI / 2; room.add(board);
    board.userData.pick = 'board'; board.name = 'board';
    add(board, rbox(1.26, 0.9, 0.035, 0.01), M.deskDark, 0, 0, -0.005);
    add(board, new T.PlaneGeometry(1.19, 0.83), std('#ffffff', { map: corkTex, roughness: 0.95 }), 0, 0, 0.0135, { cast: false });
    var notes = [
      ['#f7e36a', ['ideia:', 'site que é', 'um quarto'], -0.42, 0.2, 0.06],
      ['#ff9fb2', ['estudar', 'Prolog'], -0.12, 0.24, -0.08],
      ['#9fd8ff', ['comprar', 'filamento'], 0.2, 0.2, 0.05],
      ['#b5e8a0', ['não esquecer', 'o café'], -0.38, -0.17, -0.05],
      ['#ffc27a', ['beber', 'água'], 0.02, -0.12, 0.07],
      ['#f7e36a', ['revisar', 'o kanban'], 0.42, -0.2, -0.04]
    ];
    var pins = [];
    notes.forEach(function (n, i) {
      var m = add(board, new T.PlaneGeometry(0.15, 0.15), std('#ffffff', { map: noteTex(n[0], n[1], { size: n[1].length > 2 ? 40 : 48 }), roughness: 0.85 }), n[2], n[3], 0.016 + i * 0.0006, { cast: false });
      m.rotation.z = n[4];
      var px = n[2] - Math.sin(n[4]) * 0.06, py = n[3] + Math.cos(n[4]) * 0.06;
      add(board, new T.SphereGeometry(0.009, 12, 10), std(i % 2 ? '#c0362c' : '#2f6ec0', { roughness: 0.3 }), px, py, 0.026, { cast: false });
      pins.push(V(px, py, 0.028));
    });
    // polaroid com um rabisco da capivara
    var polTex = canvasTex(256, 300, function (x, w, h) {
      x.fillStyle = '#fbfaf6'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#cfe3d6'; x.fillRect(18, 18, w - 36, 210);
      x.fillStyle = '#a7774a'; x.beginPath(); x.ellipse(128, 140, 70, 46, 0, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.ellipse(190, 112, 34, 28, -0.2, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#8a5f39'; x.fillRect(80, 170, 14, 36); x.fillRect(160, 170, 14, 36); x.beginPath(); x.ellipse(182, 88, 8, 6, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#2b2622'; x.beginPath(); x.arc(200, 106, 4, 0, Math.PI * 2); x.fill(); x.fillRect(214, 116, 6, 4);
      x.fillStyle = '#2b2622'; x.font = '34px ' + HAND; x.textAlign = 'center'; x.fillText('capi', w / 2, 270);
    });
    var pol = add(board, new T.PlaneGeometry(0.13, 0.152), std('#ffffff', { map: polTex, roughness: 0.6 }), 0.36, 0.03, 0.019, { cast: false });
    pol.rotation.z = -0.1;
    add(board, new T.SphereGeometry(0.009, 12, 10), std('#2f6ec0', { roughness: 0.3 }), 0.364, 0.095, 0.026, { cast: false });
    var redMat = std('#c0362c', { roughness: 0.6 });
    [[0, 1], [1, 2], [0, 3], [3, 4], [4, 2], [4, 5]].forEach(function (e) {
      var a = pins[e[0]], b = pins[e[1]], mid = a.clone().lerp(b, 0.5); mid.y -= 0.02; mid.z += 0.003;
      tube(board, [a, mid, b], 0.0018, redMat).castShadow = false;
    });
    // varal de luzinhas acima do mural
    var fairy = new T.Group(); fairy.position.copy(board.position); fairy.rotation.copy(board.rotation); room.add(fairy);
    var fairyPts = [];
    for (var fp = 0; fp <= 24; fp++) { var u = fp / 24, fxp = -0.78 + u * 1.56; fairyPts.push(V(fxp, 0.6 - Math.sin(u * Math.PI * 2) * Math.sin(u * Math.PI * 2) * 0.05 - Math.sin(u * Math.PI) * 0.02, 0.03)); }
    tube(fairy, fairyPts, 0.0016, M.cableDark).castShadow = false;
    var fairyMats = [0, 1, 2].map(function () { return new T.MeshStandardMaterial({ color: lin('#fff1d0'), emissive: lin('#ffc06a'), emissiveIntensity: 1.6, roughness: 0.4 }); });
    for (var fbulb = 1; fbulb < 24; fbulb += 2) { var pb = fairyPts[fbulb]; add(fairy, new T.SphereGeometry(0.012, 10, 8), fairyMats[fbulb % 3], pb.x, pb.y - 0.014, pb.z + 0.006, { cast: false }); }

    // ------------------------------------------------------------ móvel lateral + impressora 3D

    var cab = new T.Group(); cab.position.set(1.6, 0, -2.22); room.add(cab);
    add(cab, rbox(0.9, 0.58, 0.48, 0.012), std('#9a6b46', { roughness: 0.55 }), 0, 0.33, 0);
    [0.18, 0.42].forEach(function (y) { add(cab, new T.BoxGeometry(0.84, 0.005, 0.004), M.base, 0, y + 0.13, 0.241, { cast: false }); add(cab, new T.SphereGeometry(0.014, 12, 10), M.brass, 0, y, 0.25); });
    add(cab, new T.BoxGeometry(0.004, 0.24, 0.004), M.base, 0, 0.18, 0.241, { cast: false });
    [[-0.4, 0.2], [0.4, 0.2], [-0.4, -0.2], [0.4, -0.2]].forEach(function (p) { add(cab, new T.CylinderGeometry(0.018, 0.014, 0.04, 10), M.base, p[0], 0.02, p[1]); });
    blob(room, 1.6, 0.005, -2.2, 1.15, 0.7, 0.55);
    var CAB_Y = 0.62;
    var printer = new T.Group(); printer.position.set(1.42, CAB_Y, -2.24); room.add(printer);
    (function () {
      var fr = std('#26282c', { roughness: 0.5, metalness: 0.3 });
      add(printer, rbox(0.36, 0.035, 0.34, 0.006), fr, 0, 0.0175, 0);
      add(printer, rbox(0.36, 0.03, 0.34, 0.006), fr, 0, 0.395, 0);
      [[-0.17, -0.16], [0.17, -0.16], [-0.17, 0.16], [0.17, 0.16]].forEach(function (p) { add(printer, new T.BoxGeometry(0.02, 0.36, 0.02), fr, p[0], 0.2, p[1]); });
      var smoke = new T.MeshStandardMaterial({ color: lin('#20242a'), transparent: true, opacity: 0.45, roughness: 0.15, depthWrite: false });
      add(printer, new T.PlaneGeometry(0.32, 0.34), smoke, -0.178, 0.2, 0, { cast: false }).rotation.y = -Math.PI / 2;
      add(printer, new T.PlaneGeometry(0.32, 0.34), smoke, 0.178, 0.2, 0, { cast: false }).rotation.y = Math.PI / 2;
      add(printer, new T.PlaneGeometry(0.32, 0.34), smoke, 0, 0.2, -0.168, { cast: false });
      var door = add(printer, new T.PlaneGeometry(0.32, 0.34), new T.MeshStandardMaterial({ color: lin('#c9d6e0'), transparent: true, opacity: 0.12, roughness: 0.05, depthWrite: false }), 0, 0.2, 0.171, { cast: false, receive: false });
      door.renderOrder = 3;
      add(printer, new T.BoxGeometry(0.01, 0.12, 0.012), M.metal, 0.14, 0.2, 0.18);
      add(printer, new T.BoxGeometry(0.27, 0.008, 0.27), std('#a8834a', { roughness: 0.4, metalness: 0.4 }), 0, 0.075, 0);
      var vg = [];
      for (var i = 0; i <= 14; i++) { var t = i / 14; vg.push(new T.Vector2(0.026 + Math.sin(t * Math.PI) * 0.016 + Math.sin(t * 28) * 0.0012, t * 0.085)); }
      add(printer, new T.LatheGeometry(vg, 28), std('#ff7b30', { roughness: 0.45 }), 0.02, 0.079, 0.01);
      add(printer, new T.BoxGeometry(0.3, 0.014, 0.014), M.metal, 0, 0.3, 0.02);
      var head = new T.Group(); head.position.set(0.02, 0.3, 0.03); printer.add(head);
      add(head, rbox(0.05, 0.05, 0.04, 0.006), std('#e9e5dd', { roughness: 0.5 }), 0, -0.012, 0.01);
      add(head, new T.ConeGeometry(0.006, 0.014, 10), std('#c58a3a', { metalness: 0.8, roughness: 0.3 }), 0, -0.045, 0.01).rotation.x = Math.PI;
      printer.userData.head = head;
      add(printer, new T.BoxGeometry(0.28, 0.006, 0.01), new T.MeshStandardMaterial({ color: lin('#ffffff'), emissive: lin('#e8f0ff'), emissiveIntensity: 1.2 }), 0, 0.375, 0.15, { cast: false });
      var pScr = canvasTex(128, 64, function (x, w, h) { x.fillStyle = '#0b0d10'; x.fillRect(0, 0, w, h); x.fillStyle = '#ff9a3c'; x.font = 'bold 26px ' + SANS; x.fillText('42%', 10, 30); x.fillStyle = '#3a3f46'; x.fillRect(10, 42, 108, 8); x.fillStyle = '#ff9a3c'; x.fillRect(10, 42, 45, 8); });
      add(printer, new T.PlaneGeometry(0.055, 0.028), new T.MeshBasicMaterial({ map: pScr, toneMapped: false }), 0.12, 0.018, 0.1705, { cast: false });
    })();
    blob(room, 1.42, CAB_Y + 0.002, -2.24, 0.48, 0.46, 0.5);
    // carretel de filamento
    var spool = new T.Group(); spool.position.set(1.86, CAB_Y + 0.105, -2.25); spool.rotation.z = Math.PI / 2; room.add(spool);
    add(spool, new T.CylinderGeometry(0.1, 0.1, 0.008, 36), std('#1f2124'), 0, 0.036, 0);
    add(spool, new T.CylinderGeometry(0.1, 0.1, 0.008, 36), std('#1f2124'), 0, -0.036, 0);
    add(spool, new T.CylinderGeometry(0.084, 0.084, 0.064, 36), std('#2aa198', { roughness: 0.4 }), 0, 0, 0);
    add(spool, new T.CylinderGeometry(0.028, 0.028, 0.082, 20), std('#d9d4ca'), 0, 0, 0);
    add(room, new T.BoxGeometry(0.06, 0.012, 0.12), std('#1f2124'), 1.86, CAB_Y + 0.006, -2.25);

    // ------------------------------------------------------------ lixeira, cadeira

    (function () {
      var bin = new T.Group(); bin.position.set(0.93, 0, -2.18); room.add(bin);
      add(bin, new T.CylinderGeometry(0.12, 0.1, 0.28, 26, 1, true), std('#6f7f70', { roughness: 0.6, metalness: 0.3, side: T.DoubleSide }), 0, 0.14, 0);
      add(bin, new T.CircleGeometry(0.1, 24), std('#5a685b'), 0, 0.005, 0).rotation.x = -Math.PI / 2;
      var paper = std('#f2eee4', { roughness: 0.95, flatShading: true });
      [[0.02, 0.24, 0.01], [-0.03, 0.26, -0.02]].forEach(function (p) { add(bin, new T.IcosahedronGeometry(0.038, 1), paper, p[0], p[1], p[2]); });
      add(room, new T.IcosahedronGeometry(0.035, 1), paper, 0.78, 0.034, -1.98);
      blob(room, 0.93, 0.005, -2.18, 0.34, 0.34, 0.5);
    })();
    (function () {
      var ch = new T.Group(); ch.position.set(0.62, 0, -1.28); ch.rotation.y = -0.55; room.add(ch);
      var wd = std('#7e5436', { roughness: 0.55 });
      add(ch, rbox(0.42, 0.035, 0.4, 0.012), wd, 0, 0.46, 0);
      add(ch, rbox(0.38, 0.03, 0.33, 0.04), std('#b8573f', { roughness: 0.95 }), 0, 0.49, 0.01);
      [[-0.18, 0.17], [0.18, 0.17], [-0.18, -0.17], [0.18, -0.17]].forEach(function (p) { rod(ch, V(p[0], 0.45, p[1]), V(p[0] * 1.08, 0, p[1] * 1.08), 0.016, wd, 10, 0.018); });
      rod(ch, V(-0.18, 0.47, -0.18), V(-0.19, 0.95, -0.21), 0.016, wd, 10);
      rod(ch, V(0.18, 0.47, -0.18), V(0.19, 0.95, -0.21), 0.016, wd, 10);
      [0.66, 0.78, 0.9].forEach(function (y) { add(ch, rbox(0.4, 0.05, 0.02, 0.006), wd, 0, y, -0.195 - (y - 0.47) * 0.06); });
      blob(room, 0.62, 0.005, -1.28, 0.62, 0.62, 0.5, -0.55);
    })();

    // ------------------------------------------------------------ objetos 3D de verdade
    // A mesa, a luminária, a caneca, a papelaria e os objetos-projeto da estante vêm de assets/props/
    // (Poly Haven, CC0, e Higgsfield; medidas em assets/props/*.json, preparo em dev/normalizar-prop.py).
    // Cada um entra no lugar da peça desenhada quando chega; se o arquivo falhar, fica o desenhado.
    function hideKids(g, keep) { g.children.forEach(function (c) { if (!c.userData.proxy && !(keep && keep(c))) c.visible = false; }); }
    function swapIn(name, place) {
      if (!global.AndreyPC || !global.AndreyPC.loadGlb || opts.props === false) return;
      global.AndreyPC.loadGlb(T, 'assets/props/' + name + '.glb').then(function (gltf) {
        if (disposed) return;
        var m = gltf.scene; m.name = 'prop:' + name;
        m.traverse(function (o) {
          if (!o.isMesh) return;
          o.castShadow = true; o.receiveShadow = true;
          var mm = o.material;
          if (mm) { if (mm.map) mm.map.anisotropy = maxAniso; mm.envMapIntensity = 0.6; }
        });
        place(m);
        renderer.shadowMap.needsUpdate = true; hoverDirty = true; kick();
      }).catch(function (e) { if (global.console) console.warn('objeto 3D não carregou: ' + name, e && (e.message || e.type || String(e))); });
    }
    function reglow(g) { var id = g.userData.pick; if (id) registerGlow(id, g); }

    // Mesa: o tampo do modelo tem as mesmas medidas do desenhado (1,70 × 0,76, topo a 0,775 m).
    swapIn('mesa', function (m) { hideKids(desk); m.position.set(-0.1, 0, -2.07); desk.add(m); });
    // Luminária articulada: a lâmpada do modelo cai no mesmo ponto da desenhada e a cúpula gira para o
    // mesmo lado, então a luz, a sombra e a poeira no facho continuam valendo.
    swapIn('luminaria', function (m) {
      var Lm = V(-0.0032, 0.5016, 0.1296), Dm = V(0.1455, -0.487, 0.8612);
      var k = (bulbWorld.y - DESK_Y) / Lm.y;
      var ry = Math.atan2(lampDir.x, lampDir.z) - Math.atan2(Dm.x, Dm.z);
      m.scale.setScalar(k); m.rotation.y = ry;
      var off = Lm.clone().multiplyScalar(k).applyAxisAngle(Y_AXIS, ry);
      m.position.set(bulbWorld.x - off.x, DESK_Y, bulbWorld.z - off.z);
      hideKids(lamp); lamp.add(m);
      lampBlob.position.set(m.position.x, DESK_Y + 0.001, m.position.z); lampBlob.scale.setScalar(0.8); // a sombra de contato vai junto com a base
      m.traverse(function (o) { if (o.isMesh && /light/i.test(o.material && o.material.name)) { o.material.emissive = linc('#ffd9a3'); o.material.emissiveIntensity = 2.2; o.castShadow = false; } });
    });
    // Caneca: o corpo (Ø 8 cm) fica no mesmo eixo da desenhada, onde o vapor sobe.
    swapIn('caneca', function (m) { hideKids(mug); m.position.set(0.015, 0, 0); mug.add(m); });
    // Porta-lápis novo no canto direito do fundo da mesa.
    swapIn('papelaria', function (m) { m.position.set(0.6, DESK_Y, -2.3); m.rotation.y = -0.35; room.add(m); blob(room, 0.6, DESK_Y + 0.001, -2.3, 0.16, 0.16, 0.4); });

    // Estante: cada modelo entra dentro do grupo do projeto, então o clique e o brilho continuam funcionando.
    swapIn('cogumelo', function (m) {
      // a cúpula gerada saiu mais estreita: alarga 21% para casar com a da Vereda; a luz de baixo continua
      m.scale.set(1.21, 1, 1.21);
      hideKids(vereda, function (c) { return c.geometry && c.geometry.type === 'CircleGeometry'; });
      vereda.children.forEach(function (c) { if (c.geometry && c.geometry.type === 'CircleGeometry') { c.position.y = 0.1262; c.scale.setScalar(0.97); } });
      vereda.add(m); reglow(vereda);
    });
    // Globo de neve: o MESMO do site do FlashClip (vila, árvore, casinhas e base dourada; assets/props/
    // flashclip-globo.glb, copiado do projeto). Como lá, o vidro, a placa do logo e a neve são montados aqui.
    swapIn('flashclip-globo', function (m) {
      var S = 0.17 / 3.9; // o vidro tem Ø 3,9 no modelo; na estante o globo tem 17 cm
      m.traverse(function (o) { if (o.isLight) o.visible = false; }); // o arquivo traz luzes de apresentação do Blender
      var fg = new T.Group(); fg.scale.setScalar(S); fg.position.y = -0.02 * S; fg.add(m);
      var logoTex = new T.TextureLoader().load('assets/props/flashclip-logo.png', function () { kick(); });
      logoTex.encoding = T.sRGBEncoding; textures.push(logoTex);
      var plate = new T.Mesh(new T.PlaneGeometry(1.13, 0.39), new T.MeshBasicMaterial({ map: logoTex, transparent: true, depthWrite: false }));
      plate.position.set(0, 0.372, 1.492); fg.add(plate);
      // vidro com fresnel e reflexos de estúdio (o mesmo shader do FlashClip, em GLSL do r128)
      var glassFC = new T.Mesh(new T.SphereGeometry(1.95, 48, 32, 0, Math.PI * 2, 0, Math.acos((0.79 - 1.95) / 1.95)), new T.ShaderMaterial({
        transparent: true, depthWrite: false,
        vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position, 1.); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }',
        fragmentShader: 'varying vec3 vN; varying vec3 vW; void main(){ vec3 V = normalize(cameraPosition - vW); vec3 N = normalize(vN); float facing = max(dot(V, N), 0.); float rim = pow(1. - facing, 3.8); vec3 R = reflect(-V, N); float soft = pow(max(dot(R, normalize(vec3(-.7, .9, 1.3))), 0.), 40.); float strip = pow(max(dot(R, normalize(vec3(.85, .25, .9))), 0.), 100.); float top = pow(max(dot(R, normalize(vec3(-.35, 1.4, .35))), 0.), 70.); vec3 c = mix(vec3(.48, .77, .70), vec3(.99, .91, .72), soft + top); float a = .018 + rim * .47 + soft * .27 + strip * .52 + top * .31; gl_FragColor = vec4(c, a); }'
      }));
      glassFC.position.y = 1.95; glassFC.renderOrder = 8; glassFC.castShadow = false; glassFC.receiveShadow = false; fg.add(glassFC);
      // neve: flocos caindo devagar dentro do vidro (parados com movimento reduzido)
      var NF = 140, fp = new Float32Array(NF * 3), fr = rng(77);
      for (var q = 0; q < NF; q++) { var a = fr() * Math.PI * 2, rr = Math.sqrt(fr()) * 1.55; fp[q * 3] = Math.cos(a) * rr; fp[q * 3 + 1] = 0.95 + fr() * 2.6; fp[q * 3 + 2] = Math.sin(a) * rr; }
      var flakeGeo = new T.BufferGeometry(); flakeGeo.setAttribute('position', new T.BufferAttribute(fp, 3));
      var flakes = new T.Points(flakeGeo, new T.PointsMaterial({ color: 0xf5f7ff, size: 0.0024, transparent: true, opacity: 0.9, depthWrite: false, map: dotTex }));
      flakes.userData.noPick = true; flakes.renderOrder = 7; fg.add(flakes);
      globeSnow = { geo: flakeGeo, pos: fp, n: NF, seed: fr };
      hideKids(flash); flash.add(fg); reglow(flash);
    });
    swapIn('camera', function (m) { hideKids(camG); camG.add(m); reglow(camG); });
    swapIn('caixa', function (m) {
      hideKids(fest); fest.add(m);
      // a etiqueta do festejo vai colada na frente da caixa nova
      var lab = add(fest, new T.PlaneGeometry(0.088, 0.055), std('#ffffff', { map: boxLabel, roughness: 0.85 }), -0.06, 0.075, 0.1876 / 2 + 0.002, { cast: false });
      lab.rotation.z = -0.03; reglow(fest);
    });
    swapIn('katana', function (m) { m.scale.setScalar(1 / 1.2); hideKids(kage); kage.add(m); reglow(kage); }); // o grupo já tem escala 1,2
    swapIn('medalha', function (m) { hideKids(pecas); pecas.add(m); reglow(pecas); });

    // ------------------------------------------------------------ figurinhas e post-its
    // Figurinhas de vinil coladas no monitor (desenhadas aqui, com o corte branco de adesivo) e post-its
    // com recados. Os post-its são clicáveis: a página abre um bloquinho e quem visita escreve por cima.

    // Adesivo: a arte, uma borda branca do formato dela (o corte) e um brilho leve de vinil.
    function stickerTex(w, h, art, ready) {
      var pad = 12, a = document.createElement('canvas'); a.width = w; a.height = h;
      var tex = canvasTex(w + pad * 2, h + pad * 2, function () {});
      function paint() {
        var ax = a.getContext('2d'); ax.clearRect(0, 0, w, h); art(ax, w, h);
        var m = document.createElement('canvas'); m.width = w; m.height = h; var mx = m.getContext('2d');
        mx.drawImage(a, 0, 0); mx.globalCompositeOperation = 'source-in'; mx.fillStyle = '#fbfaf5'; mx.fillRect(0, 0, w, h);
        var c = tex.image, x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height);
        for (var k = 0; k < 28; k++) { var an = k / 28 * Math.PI * 2; x.drawImage(m, pad + Math.cos(an) * 9, pad + Math.sin(an) * 9); }
        x.drawImage(a, pad, pad);
        x.globalCompositeOperation = 'source-atop';
        var g = x.createLinearGradient(0, 0, c.width, c.height); g.addColorStop(0, 'rgba(255,255,255,.22)'); g.addColorStop(0.45, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.06)');
        x.fillStyle = g; x.fillRect(0, 0, c.width, c.height); x.globalCompositeOperation = 'source-over';
        tex.needsUpdate = true; kick();
      }
      paint(); if (ready) ready(paint);
      return tex;
    }
    var STICKERS = {
      guara: { w: 102, h: 160, art: function (x, w, h) { if (guaraImg.complete && guaraImg.naturalWidth) x.drawImage(guaraImg, 0, 0, w, h); } },
      sol: { w: 200, h: 200, art: function (x, w, h) {
        var g = x.createLinearGradient(0, 20, 0, 180); g.addColorStop(0, '#ffcf5a'); g.addColorStop(1, '#e8743b');
        x.fillStyle = '#1e2a3a'; x.beginPath(); x.arc(100, 100, 96, 0, Math.PI * 2); x.fill();
        x.fillStyle = g; x.beginPath(); x.arc(100, 112, 60, Math.PI, 0); x.fill();
        x.fillStyle = '#1e2a3a'; [126, 140, 154].forEach(function (y, i) { x.fillRect(30, y - 30, 140, 4 + i * 2); });
        x.fillStyle = '#2f5d3a'; x.beginPath(); x.moveTo(4, 140); x.bezierCurveTo(60, 120, 140, 126, 196, 136); x.lineTo(196, 196); x.lineTo(4, 196); x.fill();
        x.strokeStyle = '#173a22'; x.lineWidth = 5; x.beginPath(); x.moveTo(142, 150); x.quadraticCurveTo(138, 110, 146, 74); x.stroke(); // buriti
        x.fillStyle = '#173a22'; for (var f = 0; f < 9; f++) { var an = -Math.PI + f * Math.PI / 8; x.save(); x.translate(146, 74); x.rotate(an); x.beginPath(); x.ellipse(18, 0, 20, 4, 0, 0, Math.PI * 2); x.fill(); x.restore(); }
        x.globalCompositeOperation = 'destination-in'; x.beginPath(); x.arc(100, 100, 96, 0, Math.PI * 2); x.fill(); x.globalCompositeOperation = 'source-over';
      } },
      hello: { w: 230, h: 130, art: function (x, w, h) {
        x.fillStyle = '#16181b'; rr(x, 4, 4, w - 8, h - 34, 22); x.fill();
        x.beginPath(); x.moveTo(40, h - 32); x.lineTo(30, h - 4); x.lineTo(70, h - 32); x.fill();
        x.font = '600 30px ' + MONO_UI; x.textAlign = 'left'; x.textBaseline = 'middle';
        x.fillStyle = '#ebe6dd'; x.fillText('hello,', 24, 38); x.fillStyle = '#e8743b'; x.fillText('world', 24, 72); x.fillRect(118, 60, 14, 24);
      } },
      codigo: { w: 170, h: 170, art: function (x) {
        x.fillStyle = '#e8743b'; x.beginPath(); x.arc(85, 85, 82, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#1a0d05'; x.font = '700 64px ' + MONO_UI; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('</>', 85, 88);
      } },
      coracao: { w: 126, h: 112, art: function (x) {
        var P = ['.KK...KK.', 'KRRK.KRRK', 'KRWRKRRRK', 'KRRRRRRRK', '.KRRRRRK.', '..KRRRK..', '...KRK...', '....K....'];
        P.forEach(function (row, y) { for (var i = 0; i < row.length; i++) { var ch = row[i]; if (ch === '.') continue; x.fillStyle = ch === 'K' ? '#2a0d0d' : ch === 'W' ? '#ffd6d6' : '#e23b3b'; x.fillRect(i * 14, y * 14, 14, 14); } });
      } },
      selo: { w: 240, h: 96, art: function (x, w, h) {
        x.fillStyle = '#16181b'; rr(x, 2, 2, w - 4, h - 4, 18); x.fill();
        x.strokeStyle = '#2c3036'; x.lineWidth = 3; rr(x, 9, 9, w - 18, h - 18, 12); x.stroke();
        x.font = '600 34px ' + MONO_UI; x.textAlign = 'left'; x.textBaseline = 'middle';
        x.fillStyle = '#ebe6dd'; x.fillText('AndreyOS', 22, 49); x.fillStyle = '#e8743b'; x.fillText('24', 186, 49);
      } }
    };
    var MONO_UI = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
    var guaraImg = new Image(); guaraImg.src = 'assets/guara.png';
    // Raio contra o modelo do monitor (que fica fora do raycast normal da cena por ser pesado).
    function hitModel(model, origin, dir) {
      model.updateMatrixWorld(true);
      var rc = new T.Raycaster(origin, dir.normalize(), 0, 5), hits = [];
      model.traverse(function (o) { if (o.isMesh) T.Mesh.prototype.raycast.call(o, rc, hits); });
      hits.sort(function (a, b) { return a.distance - b.distance; });
      if (!hits.length) return null;
      var h = hits[0], n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : dir.clone().negate();
      if (n.dot(dir) > 0) n.negate();
      return { point: h.point, normal: n };
    }
    // Cola uma figurinha onde o raio bate no monitor (coordenadas do modelo, como no assets/pc-grafite.json).
    function decorateMonitor(model, g, S) {
      var CL = [
        { k: 'guara', at: [0.10, 0.135, 1.4], dir: [0, 0, -1], h: 0.068, tilt: -0.12 },
        { k: 'coracao', at: [0.205, 0.085, 1.4], dir: [0, 0, -1], h: 0.026, tilt: 0.18 },
        { k: 'hello', at: [-0.3, 1.5, 0.3], dir: [0, -1, 0], h: 0.042, tilt: -0.25 },
        { k: 'sol', at: [1.4, 0.40, -0.06], dir: [-1, 0, 0], h: 0.072, tilt: -0.1 },
        { k: 'selo', at: [0.2, 1.5, 0.2], dir: [0, -1, 0], h: 0.032, tilt: 0.15 },
        { k: 'codigo', at: [1.4, 0.58, 0.2], dir: [-1, 0, 0], h: 0.05, tilt: -0.3 }
      ];
      CL.forEach(function (c) {
        var o = g.localToWorld(V(c.at[0], c.at[1], c.at[2])), hit = hitModel(model, o, V(c.dir[0], c.dir[1], c.dir[2]));
        if (!hit) return;
        var d = STICKERS[c.k], aspect = (d.w + 24) / (d.h + 24), h = c.h * (d.h + 24) / d.h;
        var tex = stickerTex(d.w, d.h, d.art, c.k === 'guara' ? function (paint) { if (!guaraImg.complete) guaraImg.addEventListener('load', paint, { once: true }); } : null);
        var mat = new T.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.05, roughness: 0.42, metalness: 0, envMapIntensity: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        var st = new T.Mesh(new T.PlaneGeometry(h * aspect, h), mat);
        st.position.copy(hit.point).addScaledVector(hit.normal, 0.0008);
        st.lookAt(st.position.clone().add(hit.normal));
        st.rotateZ(c.tilt); st.receiveShadow = true; st.userData.noPick = true; room.add(st);
      });
      // o recado do monitor nasce na borda direita da moldura, com a seta para o botão laranja
      pcModel = model;
      var ph = hitModel(model, g.localToWorld(V(0.425, 0.42, 1.4)), V(0, 0, -1));
      if (ph) placeDefault('n0', ph.point.clone().add(V(0.012, 0, 0)), ph.normal);
    }

    // Post-its: recados de verdade. Dá para arrastar e grudar em qualquer superfície (parede, mesa,
    // monitor, estante), escrever por cima, criar novos e tirar. Quem guarda tudo é a página (app.js),
    // pelo onNotesChange; aqui ficam o desenho, o arrasto e o raio que acha onde grudar.
    var NOTE_SIZE = 0.076, NOTE_COLORS = ['#f7e36a', '#ffb8c9', '#a9dcff', '#bff0ae', '#ffcf8a'];
    var NOTE_DEFAULTS = [
      { id: 'n0', cor: '#f7e36a', texto: 'Oi! Aperta o botão laranja aqui embaixo.', seta: true, pos: [0.2, 1.25, ZB + 0.002], n: [0, 0, 1], tilt: 0.3 },
      { id: 'n1', cor: '#ffb8c9', texto: 'Dica: digita ajuda no Terminal.', pos: [-0.34, 1.37, ZB + 0.002], n: [0, 0, 1], tilt: 0.06 },
      { id: 'n2', cor: '#a9dcff', texto: 'O Blocos vicia. Eu avisei.', pos: [0.27, 1.31, ZB + 0.002], n: [0, 0, 1], tilt: -0.08 },
      { id: 'n3', cor: '#bff0ae', texto: 'Escreve aqui! Clica em mim.', pos: [0.56, DESK_Y + 0.001, -1.86], n: [0, 1, 0], tilt: 0.35 }
    ];
    var notes = {}, noteSeq = 1, pcModel = null, noteMoved = {};
    noteMon.visible = false; // o post-it desenhado do monitor antigo dá lugar ao recado livre n0
    function defOf(id) { for (var i = 0; i < NOTE_DEFAULTS.length; i++) if (NOTE_DEFAULTS[i].id === id) return NOTE_DEFAULTS[i]; return null; }
    function wrapNote(texto) {
      var c = document.createElement('canvas').getContext('2d'), size = 46, words = String(texto || '').trim().split(/\s+/).filter(Boolean), lines;
      do {
        c.font = size + 'px ' + HAND; lines = []; var cur = '';
        words.forEach(function (wd) { var t = cur ? cur + ' ' + wd : wd; if (c.measureText(t).width > 210 && cur) { lines.push(cur); cur = wd; } else cur = t; });
        if (cur) lines.push(cur);
        size -= 3;
      } while (lines.length > 4 && size > 24);
      return { lines: lines.length ? lines : [''], size: size + 3 };
    }
    function noteGeo() {
      var geo = new T.PlaneGeometry(NOTE_SIZE, NOTE_SIZE, 1, 6), pp = geo.attributes.position;
      for (var q = 0; q < pp.count; q++) { var v = pp.getY(q) / NOTE_SIZE + 0.5; if (v < 0.3) pp.setZ(q, Math.pow((0.3 - v) / 0.3, 2) * 0.005); } // a ponta de baixo descola um pouco
      geo.computeVertexNormals(); return geo;
    }
    function paintNote(nt) {
      var w = wrapNote(nt.st.texto), old = nt.mesh.material.map;
      nt.mesh.material.map = noteTex(nt.st.cor, w.lines, { size: w.size, y: nt.st.seta ? 100 : 128, arrow: !!nt.st.seta });
      nt.mesh.material.needsUpdate = true;
      if (old) { old.dispose(); var k = textures.indexOf(old); if (k >= 0) textures.splice(k, 1); }
      kick();
    }
    // Grudado: o verso encosta na superfície (normal n) e o papel gira um pouco no próprio plano.
    function orient(nt) {
      var st = nt.st, g = nt.group;
      if (!st.pos) { g.visible = false; kick(); return; } // post-it novo ainda sem lugar (segue o ponteiro)
      var p = V(st.pos[0], st.pos[1], st.pos[2]), n = V(st.n[0], st.n[1], st.n[2]).normalize();
      g.position.copy(p).addScaledVector(n, 0.0015);
      g.up.set(0, Math.abs(n.y) > 0.9 ? 0 : 1, Math.abs(n.y) > 0.9 ? -1 : 0); // na mesa, o "pra cima" do papel aponta para o fundo
      g.lookAt(g.position.clone().add(n)); g.rotateZ(st.tilt || 0);
      g.visible = !st.removido && !!st.pos;
      renderer.shadowMap.needsUpdate = true; kick();
    }
    function makeNote(st) {
      var g = new T.Group(); g.userData.pick = 'note:' + st.id; room.add(g);
      var mesh = add(g, noteGeo(), std('#ffffff', { roughness: 0.85, side: T.DoubleSide }), 0, 0, 0, { cast: false });
      mesh.userData.isNote = true;
      var nt = { st: st, group: g, mesh: mesh }; notes[st.id] = nt;
      paintNote(nt); orient(nt); return nt;
    }
    function snapshot() { return Object.keys(notes).map(function (id) { var s0 = notes[id].st; return { id: s0.id, cor: s0.cor, texto: s0.texto, seta: !!s0.seta, pos: s0.pos, n: s0.n, tilt: s0.tilt, removido: !!s0.removido, novo: !!s0.novo }; }); }
    function changed() { if (typeof opts.onNotesChange === 'function') opts.onNotesChange(snapshot()); }
    NOTE_DEFAULTS.forEach(function (d) { makeNote(JSON.parse(JSON.stringify(d))); });
    // o lugar de fábrica do n0 depende do monitor gerado; só vale se a pessoa ainda não mexeu nele
    function placeDefault(id, p, n) {
      var d = defOf(id); if (!d) return;
      d.pos = [p.x, p.y, p.z]; d.n = [n.x, n.y, n.z];
      if (notes[id] && !noteMoved[id]) { notes[id].st.pos = d.pos.slice(); notes[id].st.n = d.n.slice(); orient(notes[id]); }
    }
    // Onde dá para grudar: o que o raio do ponteiro acertar primeiro, menos vidro, post-its e efeitos.
    function isNoteObj(o) { while (o) { if (o.userData && o.userData.isNote) return true; if (o.userData && o.userData.pick && String(o.userData.pick).indexOf('note:') === 0) return true; o = o.parent; } return false; }
    function surfaceAt(clientX, clientY) {
      var r = canvas.getBoundingClientRect(); if (!r.width) return null;
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      poseAt(poseTime()); raycaster.setFromCamera(ndc, camera);
      var hits = raycaster.intersectObject(room, true).filter(function (h) {
        var o = h.object; if (o.isPoints || o.isSprite || o.isLine || o.userData.noPick || !shown(o) || isNoteObj(o)) return false;
        if (o === screen || o === glare || o === halo) return false; // o vidro da tela fica por baixo do desktop
        var m = o.material; if (m && m.transparent && m.opacity < 0.6) return false;
        return !!h.face;
      });
      if (pcModel) { var more = []; pcModel.traverse(function (o) { if (o.isMesh) T.Mesh.prototype.raycast.call(o, raycaster, more); }); hits = hits.concat(more); }
      hits.sort(function (a, b) { return a.distance - b.distance; });
      var h = hits[0]; if (!h) return null;
      var n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      if (n.dot(raycaster.ray.direction) > 0) n.negate();
      return { point: h.point.clone(), normal: n };
    }
    function stickTo(nt, s) { nt.st.pos = [s.point.x, s.point.y, s.point.z]; nt.st.n = [s.normal.x, s.normal.y, s.normal.z]; orient(nt); }
    // arrastar: segura no post-it e solta onde quiser; um toque sem arrastar abre o bloquinho
    var noteDrag = null, placing = null, suppressClick = false;
    function onNoteDown(e) {
      if (placing) {
        var s = surfaceAt(e.clientX, e.clientY);
        if (s) { stickTo(placing, s); placing.st.removido = false; orient(placing); var id = placing.st.id; placing = null; canvas.style.cursor = ''; noteMoved[id] = true; changed(); if (typeof opts.onNotePlaced === 'function') opts.onNotePlaced(id); }
        suppressClick = true; e.preventDefault(); return;
      }
      var name = pickAt(e.clientX, e.clientY);
      if (name && name.indexOf('note:') === 0) { noteDrag = { id: name.slice(5), x: e.clientX, y: e.clientY, moving: false, pid: e.pointerId }; try { canvas.setPointerCapture(e.pointerId); } catch (er) { /* nada */ } }
    }
    function onNoteMove(e) {
      if (placing) { var s0 = surfaceAt(e.clientX, e.clientY); if (s0) { stickTo(placing, s0); placing.group.visible = true; } return; }
      if (!noteDrag) return;
      if (!noteDrag.moving && Math.hypot(e.clientX - noteDrag.x, e.clientY - noteDrag.y) > 6) { noteDrag.moving = true; canvas.style.cursor = 'grabbing'; }
      if (noteDrag.moving) { var s = surfaceAt(e.clientX, e.clientY), nt = notes[noteDrag.id]; if (s && nt) stickTo(nt, s); }
    }
    function onNoteUp(e) {
      if (!noteDrag) return;
      try { canvas.releasePointerCapture(noteDrag.pid); } catch (er) { /* nada */ }
      if (noteDrag.moving) { suppressClick = true; noteMoved[noteDrag.id] = true; canvas.style.cursor = ''; changed(); }
      noteDrag = null;
    }
    canvas.addEventListener('pointerdown', onNoteDown);
    canvas.addEventListener('pointermove', onNoteMove);
    canvas.addEventListener('pointerup', onNoteUp);
    canvas.addEventListener('pointercancel', onNoteUp);
    // as letras à mão chegam pelo Google Fonts: redesenha os post-its quando a fonte carregar
    if (document.fonts && document.fonts.load) document.fonts.load('46px "Caveat"').then(function () { Object.keys(notes).forEach(function (id) { paintNote(notes[id]); }); }, function () {});

    // ------------------------------------------------------------ luzes

    var hemi = new T.HemisphereLight(0xffffff, 0x000000, 0.5); scene.add(hemi);
    var fill = new T.DirectionalLight(0xffffff, 0.3); scene.add(fill); scene.add(fill.target);
    // A luz da janela faz sombra: monitor, caneca e luminária assentam na mesa e na parede.
    fill.castShadow = true; fill.shadow.mapSize.set(2048, 2048);
    fill.shadow.camera.left = -1.6; fill.shadow.camera.right = 1.6; fill.shadow.camera.top = 1.4; fill.shadow.camera.bottom = -1.4;
    fill.shadow.camera.near = 0.5; fill.shadow.camera.far = 14; fill.shadow.bias = -0.0004; fill.shadow.normalBias = 0.02; fill.shadow.radius = 3;
    // "rebatimento" quente vindo do lado da porta: sem ele as faces da frente (teclado, gabinete) ficam azul-marinho
    var bounce = new T.DirectionalLight(0xffc792, 0.3); bounce.position.set(0.8, 2.4, 4.5); bounce.target.position.set(-0.1, 0.8, -2.0); scene.add(bounce); scene.add(bounce.target);
    var lampSpot = new T.SpotLight(0xffb469, 2.4, 3.6, 0.66, 0.6, 1.25);
    lampSpot.position.copy(bulbWorld); lampSpot.target.position.copy(LAMP_AIM).add(V(0.05, 0, -0.05));
    lampSpot.castShadow = true; lampSpot.shadow.mapSize.set(2048, 2048);
    lampSpot.shadow.camera.near = 0.05; lampSpot.shadow.camera.far = 3.2;
    lampSpot.shadow.bias = -0.0006; lampSpot.shadow.normalBias = 0.012;
    scene.add(lampSpot); scene.add(lampSpot.target);
    // Luz da tela: spot largo saindo do vidro para a frente (ilumina mesa e teclado, não a parede de trás).
    var monMatrix = new T.Matrix4().compose(mon.position, mon.quaternion, V(1, 1, 1));
    var screenLight = new T.SpotLight(0x86d8cf, 0, 2.4, 1.2, 0.95, 1.6);
    screenLight.position.copy(V(0, 0, 0.05).applyMatrix4(monMatrix));
    screenLight.target.position.copy(V(0, -0.35, 1.0).applyMatrix4(monMatrix));
    scene.add(screenLight); scene.add(screenLight.target);
    var shelfLight = new T.PointLight(0xffb070, 0.9, 2.2, 2);
    shelfLight.position.set(-2.3, 1.25, -1.75); scene.add(shelfLight);
    var fairyLight = new T.PointLight(0xffc27a, 0.8, 2.6, 2);
    fairyLight.position.set(2.75, 2.0, -1.42); scene.add(fairyLight);

    // Luz da janela no piso + feixe (falsos, aditivos: sem custo de sombra).
    var patchTex = canvasTex(256, 256, function (x, w, h) {
      x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
      var panes = [[16, 16, 108, 108], [132, 16, 108, 108], [16, 132, 108, 108], [132, 132, 108, 108]];
      for (var k = 0; k < 12; k++) { x.fillStyle = 'rgba(255,255,255,.085)'; panes.forEach(function (p) { x.fillRect(p[0] + k * 1.1, p[1] + k * 1.1, p[2] - k * 2.2, p[3] - k * 2.2); }); }
    });
    var patchMat = new T.MeshBasicMaterial({ map: patchTex, transparent: true, blending: T.AdditiveBlending, depthWrite: false, opacity: 0.5, color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -3 });
    var patchGeo = new T.BufferGeometry();
    patchGeo.setAttribute('position', new T.Float32BufferAttribute(new Array(12).fill(0), 3));
    patchGeo.setAttribute('uv', new T.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    patchGeo.setIndex([0, 3, 1, 1, 3, 2]);
    var patch = new T.Mesh(patchGeo, patchMat); patch.userData.noPick = true; patch.renderOrder = 2; fx.add(patch);
    // Feixe: as 4 faces laterais do tronco janela→piso, cada uma com UV própria e uma textura que some
    // nas bordas (u) e esmaece até o piso (v). Sem isso o feixe era uma cunha de borda dura sobre a parede.
    var beamTex = canvasTex(64, 128, function (x, w, h) {
      x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
      var img = x.getImageData(0, 0, w, h), d = img.data;
      for (var py = 0; py < h; py++) for (var px = 0; px < w; px++) {
        var u = (px + 0.5) / w, v = 1 - (py + 0.5) / h; // v = 0 na janela (flipY), 1 no piso
        var edge = Math.min(1, Math.min(u, 1 - u) / 0.32); edge = edge * edge * (3 - 2 * edge);
        var along = 0.14 + 0.86 * Math.pow(1 - v, 1.4);
        var b = Math.round(255 * edge * along), k = (py * w + px) * 4;
        d[k] = d[k + 1] = d[k + 2] = b; d[k + 3] = 255;
      }
      x.putImageData(img, 0, 0);
    });
    beamTex.encoding = T.LinearEncoding;
    var beamGeo = new T.BufferGeometry(), beamUV = [], beamIdx = [];
    for (var bf = 0; bf < 4; bf++) { beamUV.push(0, 0, 1, 0, 1, 1, 0, 1); beamIdx.push(bf * 4, bf * 4 + 1, bf * 4 + 2, bf * 4, bf * 4 + 2, bf * 4 + 3); }
    beamGeo.setAttribute('position', new T.Float32BufferAttribute(new Array(48).fill(0), 3));
    beamGeo.setAttribute('uv', new T.Float32BufferAttribute(beamUV, 2));
    beamGeo.setIndex(beamIdx);
    var beamMat = new T.MeshBasicMaterial({ map: beamTex, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, opacity: 0.06 });
    var beam = new T.Mesh(beamGeo, beamMat); beam.userData.noPick = true; beam.renderOrder = 4; fx.add(beam);
    function layoutWindowLight(dir) {
      var d = V(dir[0], dir[1], dir[2]).normalize();
      var wc = [V(WX0 + 0.04, WY1 - 0.04, ZB), V(WX1 - 0.04, WY1 - 0.04, ZB), V(WX1 - 0.04, WY0 + 0.04, ZB), V(WX0 + 0.04, WY0 + 0.04, ZB)];
      var fc = wc.map(function (p) { var t = (p.y - 0.007) / -d.y; return p.clone().addScaledVector(d, t); });
      var pp = patchGeo.attributes.position, bp = beamGeo.attributes.position;
      fc.forEach(function (p, i) { pp.setXYZ(i, p.x, p.y, p.z); });
      for (var f = 0; f < 4; f++) { // face f: janela f → janela f+1 → piso f+1 → piso f
        var g = (f + 1) % 4, q = [wc[f], wc[g], fc[g], fc[f]];
        for (var k = 0; k < 4; k++) bp.setXYZ(f * 4 + k, q[k].x, q[k].y, q[k].z);
      }
      pp.needsUpdate = true; bp.needsUpdate = true;
      patchGeo.computeBoundingSphere(); beamGeo.computeBoundingSphere();
      // mesma direção da janela, mas mirando a mesa: o recorte da sombra (±1,6 m) cobre mesa, monitor e parede
      fill.target.position.set(-0.1, 0.95, -2.05); fill.position.copy(fill.target.position).addScaledVector(d, -8);
      fill.target.updateMatrixWorld(); renderer.shadowMap.needsUpdate = true;
    }

    // ------------------------------------------------------------ poeira e vapor

    var dotTex = canvasTex(64, 64, function (x) { var g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); });
    var DUST = 230, beamLen = bulbWorld.distanceTo(LAMP_AIM) * 0.95, beamTan = Math.tan(0.5);
    var dustGeo = new T.BufferGeometry();
    var dPos = new Float32Array(DUST * 3), dCol = new Float32Array(DUST * 3), dSeed = [];
    var dr = rng(123);
    for (var di = 0; di < DUST; di++) dSeed.push({ u: dr(), a: dr() * Math.PI * 2, r: Math.sqrt(dr()), s: 0.3 + dr() * 0.7, p: dr() * 100 });
    dustGeo.setAttribute('position', new T.BufferAttribute(dPos, 3));
    dustGeo.setAttribute('color', new T.BufferAttribute(dCol, 3));
    var dustMat = new T.PointsMaterial({ size: 0.0065, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true, color: lin('#ffd9a6') });
    var dust = new T.Points(dustGeo, dustMat); dust.frustumCulled = false; dust.userData.noPick = true; fx.add(dust);
    var beamAxis = lampDir.clone(), beamU = V(0, 0, 0), beamW = V(0, 0, 0);
    beamU.crossVectors(beamAxis, Y_AXIS).normalize(); beamW.crossVectors(beamAxis, beamU).normalize();
    function updateDust(t) {
      for (var i = 0; i < DUST; i++) {
        var s = dSeed[i];
        var u = (s.u + t * 0.006 * s.s) % 1, along = 0.06 + u * beamLen;
        var ang = s.a + t * 0.05 * s.s, rad = s.r * along * beamTan;
        var wob = Math.sin(t * 0.7 * s.s + s.p) * 0.006;
        var ox = Math.cos(ang) * rad + wob, oy = Math.sin(ang) * rad + Math.cos(t * 0.5 + s.p) * 0.005;
        dPos[i * 3] = bulbWorld.x + beamAxis.x * along + beamU.x * ox + beamW.x * oy;
        dPos[i * 3 + 1] = bulbWorld.y + beamAxis.y * along + beamU.y * ox + beamW.y * oy;
        dPos[i * 3 + 2] = bulbWorld.z + beamAxis.z * along + beamU.z * ox + beamW.z * oy;
        var edge = 1 - s.r * s.r, ends = Math.min(1, u * 6) * Math.min(1, (1 - u) * 5);
        var tw = 0.55 + 0.45 * Math.sin(t * (1.3 + s.s) + s.p);
        var b = edge * ends * tw * dustLevel;
        dCol[i * 3] = b; dCol[i * 3 + 1] = b; dCol[i * 3 + 2] = b;
      }
      dustGeo.attributes.position.needsUpdate = true; dustGeo.attributes.color.needsUpdate = true;
    }
    var dustLevel = 1;

    var steamTex = canvasTex(64, 128, function (x) {
      x.save(); x.scale(1, 2); var g = x.createRadialGradient(32, 32, 0, 32, 32, 30); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); x.restore();
    });
    var steam = [];
    for (var st = 0; st < 3; st++) {
      var spr = new T.Sprite(new T.SpriteMaterial({ map: steamTex, transparent: true, opacity: 0, depthWrite: false, color: lin('#fff6ea') }));
      spr.userData.noPick = true; spr.userData.phase = st / 3; fx.add(spr); steam.push(spr);
    }
    var MUG_TOP = V(-0.5, DESK_Y + 0.095, -1.86);
    function updateSteam(t) {
      steam.forEach(function (s, i) {
        var q = reduced ? 0.35 + i * 0.12 : ((t / 3.4 + s.userData.phase) % 1);
        s.position.set(MUG_TOP.x + Math.sin(q * 5 + i * 2) * 0.012 * q, MUG_TOP.y + q * 0.15, MUG_TOP.z + Math.cos(q * 4 + i) * 0.006);
        var sc = 0.03 + q * 0.06; s.scale.set(sc, sc * 1.8, 1);
        s.material.opacity = Math.sin(Math.PI * q) * (reduced ? 0.1 : 0.16);
      });
    }

    // ------------------------------------------------------------ céu e hora do dia

    function drawSky(phase) {
      var x = skyCanvas.getContext('2d'), W = 1024, Hh = 1024, R = rng(5);
      var g = x.createLinearGradient(0, 0, 0, Hh);
      if (phase === 'noite') { g.addColorStop(0, '#060b20'); g.addColorStop(0.5, '#101d46'); g.addColorStop(0.72, '#1f3566'); g.addColorStop(1, '#2a3e69'); }
      else if (phase === 'entardecer') { g.addColorStop(0, '#2a3566'); g.addColorStop(0.32, '#7a4c7a'); g.addColorStop(0.56, '#e0765b'); g.addColorStop(0.7, '#f6ad62'); g.addColorStop(1, '#ffd796'); }
      else { g.addColorStop(0, '#4c8bd9'); g.addColorStop(0.45, '#83b6ec'); g.addColorStop(0.72, '#c8e1f5'); g.addColorStop(1, '#eaf3f8'); }
      x.fillStyle = g; x.fillRect(0, 0, W, Hh);
      if (phase === 'noite') {
        for (var i = 0; i < 260; i++) { var sx = R() * W, sy = R() * 720, a = 0.3 + R() * 0.7, r = R() < 0.92 ? 1 + R() : 2.2; x.fillStyle = 'rgba(255,250,235,' + a.toFixed(2) + ')'; x.beginPath(); x.arc(sx, sy, r, 0, Math.PI * 2); x.fill(); }
        var mx = 640, my = 360;
        var mg = x.createRadialGradient(mx, my, 20, mx, my, 170); mg.addColorStop(0, 'rgba(220,230,255,.35)'); mg.addColorStop(1, 'rgba(220,230,255,0)'); x.fillStyle = mg; x.fillRect(mx - 200, my - 200, 400, 400);
        var mc = document.createElement('canvas'); mc.width = mc.height = 120; var m = mc.getContext('2d');
        m.fillStyle = '#f4efd9'; m.beginPath(); m.arc(60, 60, 46, 0, Math.PI * 2); m.fill();
        m.fillStyle = 'rgba(200,190,160,.35)'; [[48, 52, 8], [70, 74, 6], [62, 40, 5]].forEach(function (c) { m.beginPath(); m.arc(c[0], c[1], c[2], 0, Math.PI * 2); m.fill(); });
        m.globalCompositeOperation = 'destination-out'; m.beginPath(); m.arc(84, 46, 42, 0, Math.PI * 2); m.fill();
        x.drawImage(mc, mx - 60, my - 60);
      } else if (phase === 'entardecer') {
        var sg = x.createRadialGradient(440, 690, 30, 440, 690, 330); sg.addColorStop(0, 'rgba(255,220,140,.9)'); sg.addColorStop(1, 'rgba(255,170,90,0)'); x.fillStyle = sg; x.fillRect(0, 300, W, 724);
        x.fillStyle = '#ffd884'; x.beginPath(); x.arc(440, 690, 62, 0, Math.PI * 2); x.fill();
        for (var c = 0; c < 4; c++) { x.fillStyle = 'rgba(150,70,100,.35)'; x.beginPath(); x.ellipse(300 + c * 140, 420 + c * 30, 130, 10, 0, 0, Math.PI * 2); x.fill(); }
      } else {
        var dg = x.createRadialGradient(380, 300, 20, 380, 300, 260); dg.addColorStop(0, 'rgba(255,252,235,1)'); dg.addColorStop(0.18, 'rgba(255,248,220,.7)'); dg.addColorStop(1, 'rgba(255,248,220,0)'); x.fillStyle = dg; x.fillRect(100, 40, 560, 520);
        [[560, 420, 1], [330, 520, 0.8], [700, 560, 0.7]].forEach(function (c) { x.fillStyle = 'rgba(255,255,255,.88)'; for (var k = 0; k < 6; k++) { x.beginPath(); x.ellipse(c[0] + (k - 2.5) * 34 * c[2], c[1] - Math.sin(k / 5 * Math.PI) * 26 * c[2], 46 * c[2], 30 * c[2], 0, 0, Math.PI * 2); x.fill(); } });
      }
      // colinas e árvores do cerrado em silhueta
      var far = phase === 'noite' ? '#16223f' : phase === 'entardecer' ? '#7a4a5e' : '#8fb08a';
      var near = phase === 'noite' ? '#090e1d' : phase === 'entardecer' ? '#3a2232' : '#5d7d4c';
      var tree = phase === 'noite' ? '#05080f' : phase === 'entardecer' ? '#28161f' : '#3f5c33';
      x.fillStyle = far; x.beginPath(); x.moveTo(0, 690); for (var hx = 0; hx <= W; hx += 32) x.lineTo(hx, 680 - Math.sin(hx * 0.006) * 34 - Math.sin(hx * 0.017) * 12); x.lineTo(W, Hh); x.lineTo(0, Hh); x.fill();
      if (phase === 'noite') { for (var hw = 0; hw < 9; hw++) { x.fillStyle = 'rgba(255,200,120,' + (0.55 + R() * 0.4).toFixed(2) + ')'; x.fillRect(300 + R() * 420, 668 + R() * 30, 4, 4); } }
      x.fillStyle = near; x.beginPath(); x.moveTo(0, 760); for (var nx = 0; nx <= W; nx += 24) x.lineTo(nx, 748 - Math.sin(nx * 0.009 + 1) * 26); x.lineTo(W, Hh); x.lineTo(0, Hh); x.fill();
      x.fillStyle = tree; x.strokeStyle = tree;
      [[330, 744, 1], [470, 736, 0.75], [640, 750, 1.15], [745, 742, 0.7]].forEach(function (t) {
        var s = t[2]; x.lineWidth = 6 * s; x.lineCap = 'round';
        x.beginPath(); x.moveTo(t[0], t[1]); x.quadraticCurveTo(t[0] - 10 * s, t[1] - 40 * s, t[0] + 6 * s, t[1] - 70 * s); x.stroke();
        x.lineWidth = 4 * s; x.beginPath(); x.moveTo(t[0] + 2 * s, t[1] - 45 * s); x.quadraticCurveTo(t[0] + 26 * s, t[1] - 54 * s, t[0] + 34 * s, t[1] - 72 * s); x.stroke();
        [[0, -84, 34], [30, -80, 26], [-22, -76, 24], [12, -100, 22]].forEach(function (c) { x.beginPath(); x.ellipse(t[0] + c[0] * s, t[1] + c[1] * s, c[2] * s, c[2] * 0.7 * s, 0, 0, Math.PI * 2); x.fill(); });
      });
      skyTex.needsUpdate = true;
    }

    var phase = null, decoLevel = 1;
    function currentHour() { return hourOverride != null ? hourOverride : new Date().getHours(); }
    // Ambiente para os reflexos (PMREM de uma salinha simples): paredes mornas, a janela com a luz da
    // hora e a luminária quente. Dá brilho de verdade ao plástico do monitor, ao verniz e à caneca.
    var envRT = null;
    function buildEnv(P) {
      try {
        var pm = new T.PMREMGenerator(renderer), es = new T.Scene();
        var shell = new T.Mesh(new T.BoxGeometry(9, 5, 9), new T.MeshBasicMaterial({ color: lin('#4a3c30'), side: T.BackSide })); shell.position.y = 1.5; es.add(shell);
        var floorE = new T.Mesh(new T.PlaneGeometry(9, 9), new T.MeshBasicMaterial({ color: lin('#3b2a1e') })); floorE.rotation.x = -Math.PI / 2; floorE.position.y = -0.95; es.add(floorE);
        var day = lin(P.fill).multiplyScalar(2 + 10 * P.fillI);
        var winE = new T.Mesh(new T.PlaneGeometry(1.3, 1.4), new T.MeshBasicMaterial({ color: day })); winE.position.set(1.6, 1.0, -4.45); es.add(winE);
        var lampE = new T.Mesh(new T.SphereGeometry(0.35, 16, 8), new T.MeshBasicMaterial({ color: new T.Color(5, 3.2, 1.6).multiplyScalar(0.4 + P.lamp / 4) })); lampE.position.set(-1.4, 1.6, -1.2); es.add(lampE);
        var rt = pm.fromScene(es, 0.03);
        pm.dispose(); es.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        if (envRT) envRT.dispose();
        envRT = rt; scene.environment = rt.texture;
        renderer.shadowMap.needsUpdate = true;
      } catch (e) { if (global.console) console.warn('ambiente', e && e.message); }
    }
    function applyPhase(name) {
      if (name === phase) return;
      phase = name;
      var P = PHASES[name];
      hemi.color.copy(lin(P.hemiSky)); hemi.groundColor.copy(lin(P.hemiGround)); hemi.intensity = P.hemi;
      fill.color.copy(lin(P.fill)); fill.intensity = P.fillI;
      bounce.color.copy(lin(P.bounce)); bounce.intensity = P.bounceI;
      lampSpot.intensity = P.lamp;
      patchMat.color.copy(lin(P.patch)); patchMat.opacity = P.patchI;
      beamMat.color.copy(lin(P.patch)); beamMat.opacity = P.beam;
      shelfLight.intensity = P.shelf; fairyLight.intensity = P.fairy;
      decoLevel = P.deco; ledStrip.emissiveIntensity = 1.3 * P.deco;
      renderer.toneMappingExposure = P.exposure;
      renderer.setClearColor(new T.Color(P.bg), 1);
      buildEnv(P);
      dustLevel = name === 'dia' ? 0.55 : name === 'entardecer' ? 0.8 : 1;
      layoutWindowLight(P.dir);
      drawSky(name);
      kick();
    }

    // ------------------------------------------------------------ tela do CRT

    var power = 'off', powerT0 = 0, theme = 'sistema';
    var biosLines = [], fontReady = false, screenDirty = true, lastBlink = -1, lastMinute = -1;
    var screenLevel = 0, flashWin = 0, flashErr = 0;

    function crtFinish(x, strength) {
      x.fillStyle = 'rgba(0,0,0,' + (0.16 * strength).toFixed(3) + ')';
      if (canMip) for (var y = 0; y < 768; y += 3) x.fillRect(0, y, 1024, 1);
      var v = x.createRadialGradient(512, 384, 260, 512, 384, 700);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,' + (0.55 * strength).toFixed(3) + ')');
      x.fillStyle = v; x.fillRect(0, 0, 1024, 768);
    }
    function drawOff() {
      if (curvedGlass) { sctx.fillStyle = '#000'; sctx.fillRect(0, 0, 1024, 768); return; }
      var x = sctx, g = x.createRadialGradient(470, 330, 40, 512, 384, 640);
      g.addColorStop(0, '#1a1f1d'); g.addColorStop(0.6, '#0c0f0e'); g.addColorStop(1, '#040505');
      x.fillStyle = g; x.fillRect(0, 0, 1024, 768);
    }
    // Desligar como um CRT de verdade: a imagem achata numa linha clara, a linha encolhe num ponto e some.
    var SHUT_DUR = 0.5, shutCanvas = null, shutAnim = false;
    function snapshotScreen() {
      if (!shutCanvas) { shutCanvas = document.createElement('canvas'); shutCanvas.width = 1024; shutCanvas.height = 768; }
      var x = shutCanvas.getContext('2d'); x.clearRect(0, 0, 1024, 768); x.drawImage(screenCanvas, 0, 0);
    }
    function drawShutdown(p) {
      var x = sctx, W = 1024, Hh = 768;
      drawOff();
      if (p < 0.5) {
        var q = p / 0.5, e = q * q, hh = Math.max(4, Hh * (1 - e));
        x.save(); x.globalAlpha = 1 - e * 0.35;
        x.drawImage(shutCanvas, 0, Hh / 2 - hh / 2, W, hh);
        x.globalCompositeOperation = 'lighter'; x.fillStyle = 'rgba(210,235,228,' + (e * 0.85).toFixed(3) + ')'; x.fillRect(0, Hh / 2 - hh / 2, W, hh);
        x.restore();
      } else {
        var q2 = (p - 0.5) / 0.5, lw = Math.max(8, W * Math.pow(1 - q2, 2.2)), a = 1 - Math.max(0, (q2 - 0.6) / 0.4);
        var g = x.createRadialGradient(W / 2, Hh / 2, 0, W / 2, Hh / 2, 90 + lw * 0.4);
        g.addColorStop(0, 'rgba(220,255,245,' + (0.5 * a).toFixed(3) + ')'); g.addColorStop(1, 'rgba(220,255,245,0)');
        x.fillStyle = g; x.fillRect(0, 0, W, Hh);
        x.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')'; x.fillRect(W / 2 - lw / 2, Hh / 2 - 3, lw, 6);
      }
      crtFinish(x, 1);
    }
    function drawWarmup(p) {
      var x = sctx, W = 1024, Hh = 768;
      x.fillStyle = '#000'; x.fillRect(0, 0, W, Hh);
      if (p < 0.2) {
        var q = easeOut(p / 0.2), lw = Math.max(6, W * q);
        var g = x.createLinearGradient(0, Hh / 2 - 30, 0, Hh / 2 + 30); g.addColorStop(0, 'rgba(200,255,240,0)'); g.addColorStop(0.5, 'rgba(220,255,245,.55)'); g.addColorStop(1, 'rgba(200,255,240,0)');
        x.fillStyle = g; x.fillRect(W / 2 - lw / 2, Hh / 2 - 30, lw, 60);
        x.fillStyle = '#ffffff'; x.fillRect(W / 2 - lw / 2, Hh / 2 - 2, lw, 4);
      } else if (p < 0.62) {
        var q2 = easeOut((p - 0.2) / 0.42), hh = Math.max(4, Hh * q2), b = 1 - q2 * 0.78;
        var g2 = x.createLinearGradient(0, Hh / 2 - hh / 2, 0, Hh / 2 + hh / 2);
        g2.addColorStop(0, 'rgba(210,230,222,0)'); g2.addColorStop(0.5, 'rgba(225,240,234,' + b.toFixed(3) + ')'); g2.addColorStop(1, 'rgba(210,230,222,0)');
        x.fillStyle = g2; x.fillRect(0, Hh / 2 - hh / 2, W, hh);
        x.fillStyle = 'rgba(255,255,255,' + (1 - q2).toFixed(3) + ')'; x.fillRect(0, Hh / 2 - 2, W, 4);
      } else {
        var q3 = (p - 0.62) / 0.38;
        x.fillStyle = 'rgba(70,82,78,' + (0.32 * (1 - q3) + 0.05).toFixed(3) + ')'; x.fillRect(0, 0, W, Hh);
      }
      crtFinish(x, 1);
    }
    function drawBiosLogo(x) {
      x.save(); x.translate(800, 54);
      x.strokeStyle = '#e2ac4a'; x.lineWidth = 3; rr(x, 0, 0, 176, 92, 10); x.stroke();
      x.fillStyle = '#e2ac4a'; x.font = '40px ' + VT; x.textAlign = 'center'; x.fillText('ANDREY', 88, 42); x.font = '30px ' + VT; x.fillText('· 486 ·', 88, 74);
      x.restore();
    }
    function drawBios(t) {
      var x = sctx;
      x.fillStyle = '#000'; x.fillRect(0, 0, 1024, 768);
      if (fontReady) {
        x.font = '36px ' + VT; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
        var lh = 38, top = 84, maxL = Math.floor((768 - top - 46) / lh);
        var lines = biosLines.length > maxL ? biosLines.slice(biosLines.length - maxL) : biosLines;
        // o selo do canto só aparece se as 3 primeiras linhas visíveis não chegarem nele
        var clear = true;
        for (var li = 0; li < Math.min(3, lines.length); li++) if (56 + x.measureText(String(lines[li])).width > 786) clear = false;
        if (clear) { drawBiosLogo(x); x.font = '36px ' + VT; x.textAlign = 'left'; x.textBaseline = 'alphabetic'; }
        x.shadowColor = 'rgba(210,210,210,.55)'; x.shadowBlur = 6; x.fillStyle = '#cfcfcf';
        lines.forEach(function (ln, i) { x.fillText(String(ln), 56, top + i * lh); });
        x.shadowBlur = 0;
        var last = lines.length ? String(lines[lines.length - 1]) : '';
        var cy = top + Math.max(0, lines.length - 1) * lh, cxp = 56 + x.measureText(last).width + 6;
        if (!lines.length) { cy = top; cxp = 56; }
        if (reduced || Math.floor(t / 0.53) % 2 === 0) { x.fillStyle = '#cfcfcf'; x.fillRect(cxp, cy - 4, 18, 6); }
      }
      crtFinish(x, 1);
    }
    function icon(x, kind, X, Y, th) {
      var ink = th.mono ? th.ink : '#1f1f1f', fillC = th.mono ? th.bar : null;
      x.save(); x.translate(X, Y); x.lineWidth = 3; x.strokeStyle = ink; x.textAlign = 'left';
      if (kind === 0) { x.fillStyle = fillC || '#fbfaf3'; x.fillRect(10, 0, 40, 52); x.strokeRect(10, 0, 40, 52); x.fillStyle = ink; for (var l = 0; l < 4; l++) x.fillRect(17, 12 + l * 9, 26, 2); }
      else if (kind === 1) { x.fillStyle = fillC || '#e8c35a'; x.fillRect(2, 10, 56, 40); x.strokeRect(2, 10, 56, 40); x.fillRect(2, 4, 22, 8); x.strokeRect(2, 4, 22, 8); }
      else if (kind === 2) { x.fillStyle = fillC || '#7a4cb0'; x.fillRect(8, 4, 44, 46); x.strokeRect(8, 4, 44, 46); x.fillStyle = th.mono ? ink : '#f2ead8'; x.fillRect(15, 12, 30, 20); }
      else if (kind === 3) { x.fillStyle = fillC || '#141414'; x.fillRect(2, 6, 56, 42); x.strokeRect(2, 6, 56, 42); x.fillStyle = th.mono ? ink : '#3cff7c'; x.font = '26px ' + VT; x.fillText('>_', 10, 34); }
      else if (kind === 4) { x.fillStyle = fillC || '#efe4cc'; x.beginPath(); x.ellipse(30, 28, 27, 22, 0, 0, Math.PI * 2); x.fill(); x.stroke(); if (!th.mono) { ['#c0362c', '#2f6ec0', '#3a9a4a', '#e8b04a'].forEach(function (c, i) { x.fillStyle = c; x.beginPath(); x.arc(16 + i * 9, 22 + (i % 2) * 8, 5, 0, Math.PI * 2); x.fill(); }); } }
      else { x.fillStyle = fillC || '#c9cfd2'; x.fillRect(12, 10, 36, 40); x.strokeRect(12, 10, 36, 40); x.fillRect(6, 4, 48, 6); x.strokeRect(6, 4, 48, 6); }
      x.restore();
    }
    // Cópia em textura do papel de parede grafite (desktop.css/.aos-wall): noite no Cerrado, brilho
    // laranja baixo no horizonte, colinas em linha fina, barra lisa e marca pequena em mono.
    function drawOnGrafite() {
      var x = sctx, th = THEMES.grafite, W = 1024, Hh = 768, AH = 720;
      x.textBaseline = 'alphabetic'; x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      var g = x.createLinearGradient(0, 0, 0, AH);
      g.addColorStop(0, '#0a0d12'); g.addColorStop(0.45, '#0e1218'); g.addColorStop(0.8, '#18171b'); g.addColorStop(1, '#131418');
      x.fillStyle = g; x.fillRect(0, 0, W, AH);
      var r = x.createRadialGradient(640, 500, 10, 640, 500, 420);
      r.addColorStop(0, 'rgba(232,116,59,.30)'); r.addColorStop(0.5, 'rgba(232,116,59,.10)'); r.addColorStop(1, 'rgba(232,116,59,0)');
      x.fillStyle = r; x.fillRect(0, 0, W, AH);
      var R = rng(7); for (var s = 0; s < 26; s++) { x.fillStyle = 'rgba(235,230,221,' + (0.15 + R() * 0.35).toFixed(2) + ')'; x.fillRect(R() * W, R() * 320, 2, 2); }
      x.lineWidth = 2; x.strokeStyle = 'rgba(150,154,161,.35)';
      x.beginPath(); x.moveTo(0, 520); x.bezierCurveTo(180, 470, 330, 482, 470, 512); x.bezierCurveTo(610, 542, 760, 552, 1024, 470); x.stroke();
      x.strokeStyle = 'rgba(232,116,59,.45)';
      x.beginPath(); x.moveTo(0, 604); x.bezierCurveTo(200, 566, 390, 590, 560, 610); x.bezierCurveTo(740, 630, 870, 604, 1024, 566); x.stroke();
      var IC = 72, names = ['sobre_mim.txt', 'Projetos', 'Arcade', 'Terminal', 'Temas'];
      names.forEach(function (n, i) { icon(x, i, IC - 30, 16 + i * 112, th); });
      icon(x, 5, 946 - 30, 610, th);
      var MONO = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
      x.font = '15px ' + MONO; x.textAlign = 'center';
      names.concat(['Lixeira']).forEach(function (n, i) { var cx = i < 5 ? IC : 946, ly = (i < 5 ? 16 + i * 112 : 610) + 78; x.fillStyle = th.icon; x.fillText(n, cx, ly); });
      x.font = '16px ' + MONO; x.textAlign = 'left';
      var w1 = x.measureText('AndreyOS ').width;
      x.fillStyle = 'rgba(150,154,161,.75)'; x.fillText('AndreyOS ', 560, 690); x.fillStyle = '#e8743b'; x.fillText('24', 560 + w1, 690);
      x.fillStyle = th.bar; x.fillRect(0, AH, W, Hh - AH);
      x.fillStyle = th.barHi; x.fillRect(0, AH, W, 1);
      x.fillStyle = th.barInk; x.font = '15px ' + MONO; x.textAlign = 'left'; x.fillText('Iniciar', 44, AH + 30);
      var d = new Date(), hhmm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      x.textAlign = 'right'; x.fillText(hhmm, W - 20, AH + 30);
      crtFinish(x, 0.5);
      if (curvedGlass) glassFrame(x);
    }
    // Cópia do tema sistema (Mac clássico): cinza pontilhado, barra de menus branca em cima, ícones à
    // esquerda com rótulo em caixa branca, Lixeira e guará embaixo (medidas do desktop.css do tema).
    function drawOnSistema() {
      var x = sctx, th = THEMES.sistema, W = 1024, Hh = 768, PIX = "'Jersey 10', 'VT323', monospace";
      x.textBaseline = 'alphabetic'; x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      x.fillStyle = '#c8c8c8'; x.fillRect(0, 0, W, Hh);
      x.fillStyle = 'rgba(0,0,0,.06)'; for (var yy = 28; yy < Hh; yy += 2) for (var xx = (yy / 2) % 2 ? 0 : 1; xx < W; xx += 2) x.fillRect(xx, yy, 1, 1);
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, 26); x.fillStyle = '#000'; x.fillRect(0, 26, W, 2);
      if (guaraImg.complete && guaraImg.naturalWidth) x.drawImage(guaraImg, 18, 2, 15, 23);
      x.font = '20px ' + PIX; x.textAlign = 'left'; x.fillStyle = '#000';
      [['AndreyOS', 44], ['Arquivo', 134], ['Tela', 212], ['Especial', 264], ['Ajuda', 344]].forEach(function (m) { x.fillText(m[0], m[1], 19); });
      var d = new Date(), hhmm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      x.textAlign = 'right'; x.fillText(hhmm, 1014, 19);
      var names = ['sobre_mim.txt', 'Projetos', 'Arcade', 'Terminal', 'Temas'];
      names.forEach(function (n, i) { icon(x, i, 40, 44 + i * 112, th); });
      icon(x, 5, 914, 638, th);
      x.font = '18px ' + PIX; x.textAlign = 'center';
      function label(t, cx, y) { var w = x.measureText(t).width + 10; x.fillStyle = '#fff'; x.fillRect(cx - w / 2, y, w, 22); x.fillStyle = '#000'; x.fillText(t, cx, y + 17); }
      names.forEach(function (n, i) { label(n, 72, 44 + i * 112 + 69); });
      label('Lixeira', 946, 707);
      if (guaraImg.complete && guaraImg.naturalWidth) x.drawImage(guaraImg, 16, 624, 70, 110);
      label('guara.exe', 51, 737);
      crtFinish(x, 0.35);
      if (curvedGlass) glassFrame(x);
    }
    function drawOn() {
      if (theme === 'sistema') return drawOnSistema();
      if (theme === 'grafite') return drawOnGrafite();
      // Versão em textura do papel de parede do AndreyOS (mesma composição do SVG de desktop.js:
      // área 1024×720, sol listrado em (660,380) r 188, duas colinas, "AndreyOS 24"; barra de 48 px).
      var x = sctx, th = THEMES[theme], W = 1024, Hh = 768, AH = 720;
      x.textBaseline = 'alphabetic'; x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      var g = x.createLinearGradient(0, 0, 0, AH); g.addColorStop(0, th.a); g.addColorStop(1, th.b);
      x.fillStyle = g; x.fillRect(0, 0, W, AH);
      if (th.grid) { x.fillStyle = th.grid; for (var gx = 0; gx < W; gx += 48) x.fillRect(gx, 0, 2, AH); for (var gy = 0; gy < AH; gy += 48) x.fillRect(0, gy, W, 2); }
      if (th.stars) { var R = rng(3); for (var s = 0; s < 70; s++) { x.fillStyle = 'rgba(255,255,255,' + (0.25 + R() * 0.5).toFixed(2) + ')'; x.fillRect(R() * W, R() * 380, 2.5, 2.5); } }
      x.save(); x.globalAlpha = th.sunA;
      var sg = x.createLinearGradient(0, 192, 0, 568); sg.addColorStop(0, th.sun); sg.addColorStop(1, th.sun2);
      x.fillStyle = sg; x.beginPath(); x.arc(660, 380, 188, 0, Math.PI * 2); x.fill();
      x.globalCompositeOperation = 'destination-out'; x.globalAlpha = 1;
      [[392, 7], [418, 10], [446, 13], [476, 16]].forEach(function (b) { x.fillRect(472, b[0], 376, b[1]); });
      x.restore();
      // o recorte das listras abriu buracos até o fundo: repinta o degradê por baixo
      x.save(); x.globalCompositeOperation = 'destination-over'; x.fillStyle = g; x.fillRect(0, 0, W, AH); x.restore();
      x.fillStyle = th.h1; x.beginPath(); x.moveTo(0, 512); x.bezierCurveTo(150, 466, 300, 474, 430, 508); x.bezierCurveTo(560, 542, 720, 556, 1024, 462); x.lineTo(W, AH); x.lineTo(0, AH); x.fill();
      x.fillStyle = th.h2; x.beginPath(); x.moveTo(0, 598); x.bezierCurveTo(190, 556, 380, 586, 560, 606); x.bezierCurveTo(740, 626, 860, 598, 1024, 556); x.lineTo(W, AH); x.lineTo(0, AH); x.fill();
      var IC = 72, names = ['sobre_mim.txt', 'Projetos', 'Arcade', 'Terminal', 'Temas'];
      names.forEach(function (n, i) { icon(x, i, IC - 30, 16 + i * 112, th); });
      icon(x, 5, 946 - 30, 610, th);
      if (fontReady) {
        x.font = '58px ' + VT; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
        var w1 = x.measureText('AndreyOS ').width, w2 = x.measureText('24').width, tx = 640 - (w1 + w2) / 2;
        x.fillStyle = th.ink; x.fillText('AndreyOS ', tx, 690); x.fillStyle = th.mono ? th.ink : th.sun; x.fillText('24', tx + w1, 690);
        x.font = '22px ' + VT; x.textAlign = 'center';
        names.concat(['Lixeira']).forEach(function (n, i) {
          var cx = i < 5 ? IC : 946, ly = (i < 5 ? 16 + i * 112 : 610) + 78;
          if (!th.mono) { x.fillStyle = 'rgba(0,0,0,.45)'; x.fillText(n, cx + 1, ly + 2); }
          x.fillStyle = th.icon; x.fillText(n, cx, ly);
        });
      }
      // barra de tarefas (bisel: claro em cima, escuro embaixo), botão Iniciar e relógio
      x.fillStyle = th.bar; x.fillRect(0, AH, W, Hh - AH);
      x.fillStyle = th.barHi; x.fillRect(0, AH, W, 2);
      x.fillStyle = th.barHi; x.fillRect(5, AH + 4, 120, 2); x.fillRect(5, AH + 4, 2, 40);
      x.fillStyle = th.barLo; x.fillRect(5, AH + 42, 120, 2); x.fillRect(123, AH + 4, 2, 40);
      x.fillStyle = th.barLo; x.fillRect(W - 112, AH + 6, 106, 2); x.fillRect(W - 112, AH + 6, 2, 36);
      x.fillStyle = th.barHi; x.fillRect(W - 112, AH + 40, 106, 2); x.fillRect(W - 8, AH + 6, 2, 36);
      if (fontReady) {
        x.fillStyle = th.barInk; x.font = '26px ' + VT; x.textAlign = 'left'; x.fillText('Iniciar', 40, AH + 33);
        var d = new Date(), hhmm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
        x.textAlign = 'right'; x.fillText(hhmm, W - 18, AH + 33);
      }
      crtFinish(x, 0.8);
      if (curvedGlass) glassFrame(x);
    }
    // Vidro curvo do PC gerado: o desktop HTML é reto e colado só nos 4 cantos, então a "barriga" de
    // cada borda (perspectiva sobre o vidro abaulado) e os cantos arredondados ficam de fora dele.
    // Essa faixa vira vidro escuro, como a borda preta de um CRT. Folgas medidas na parada "tela".
    var curvedGlass = false;
    function glassFrame(x) {
      // cantos iguais aos do desktop colado (app.css: 58/44 em cima, 30/26 embaixo)
      var W = 1024, Hh = 768, by = 13, bx = 13, tx = 80, ty = 62, ux = 42, uy = 36; // a curva quadrática fica fora do arco do CSS: um pouco maior para não sobrar fresta
      x.save(); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.fillStyle = '#000';
      x.beginPath(); x.rect(0, 0, W, Hh);
      x.moveTo(tx, 0); x.quadraticCurveTo(W / 2, 2 * by, W - tx, 0); x.quadraticCurveTo(W, 0, W, ty);
      x.quadraticCurveTo(W - 2 * bx, Hh / 2, W, Hh - uy); x.quadraticCurveTo(W, Hh, W - ux, Hh);
      x.quadraticCurveTo(W / 2, Hh - 2 * by, ux, Hh); x.quadraticCurveTo(0, Hh, 0, Hh - uy);
      x.quadraticCurveTo(2 * bx, Hh / 2, 0, ty); x.quadraticCurveTo(0, 0, tx, 0);
      x.fill('evenodd'); x.restore();
    }
    function redrawScreen(t) {
      if (power === 'off') { if (shutAnim && !reduced && t - powerT0 < SHUT_DUR) drawShutdown(clamp((t - powerT0) / SHUT_DUR, 0, 1)); else { shutAnim = false; drawOff(); } }
      else if (power === 'warmup') drawWarmup(reduced ? 1 : clamp((t - powerT0) / 0.6, 0, 1)); // movimento reduzido: direto ao quadro final
      else if (power === 'bios') drawBios(t);
      else { try { drawOn(); } catch (e) { if (global.console) console.warn('tela 3D', e && e.message); } }
      screenTex.needsUpdate = true;
      screenDirty = false;
    }
    var segOn = null;
    function drawSeg(on) {
      if (segOn === on) return; segOn = on;
      var x = segCanvas.getContext('2d'); x.fillStyle = '#120404'; x.fillRect(0, 0, 128, 64);
      if (on) { x.fillStyle = '#ff3b2f'; x.shadowColor = '#ff3b2f'; x.shadowBlur = 8; x.font = 'bold 54px ' + "'Courier New', monospace"; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('66', 64, 34); x.shadowBlur = 0; }
      segTex.needsUpdate = true;
    }
    drawSeg(false);

    function markFontReady() { if (fontReady) return; fontReady = true; screenDirty = true; kick(); }
    function onFontsDone() { screenDirty = true; kick(); if (!fontReady) markFontReady(); }
    var fontTimer = setTimeout(markFontReady, 2500);
    if (document.fonts && document.fonts.load) {
      document.fonts.load('31px "VT323"').then(function (faces) {
        if (faces && faces.length) markFontReady(); else if (document.fonts.ready) document.fonts.ready.then(markFontReady);
      }, markFontReady);
      if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', onFontsDone);
    } else markFontReady();

    // ------------------------------------------------------------ brilho de hover

    var GLOW = lin('#ffcf8f');
    function registerGlow(name, group) {
      var mats = [];
      group.traverse(function (o) {
        if (!o.isMesh || o.userData.proxy) return;
        var list = Array.isArray(o.material) ? o.material : [o.material];
        var cloned = list.map(function (m) {
          if (!m.isMeshStandardMaterial) return m;
          var c = m.clone(); c.userData = { base: c.emissive.clone(), baseI: c.emissiveIntensity }; mats.push(c); return c;
        });
        o.material = Array.isArray(o.material) ? cloned : cloned[0];
      });
      pickGroups[name] = { group: group, mats: mats, h: 0 };
    }
    PROJECTS.forEach(function (p) { var g = shelf.getObjectByName('proj:' + p.id); if (g) registerGlow('proj:' + p.id, g); });
    registerGlow('power', powerGroup);
    registerGlow('board', board);
    var tmpC = new T.Color();
    function applyGlow(entry) {
      entry.mats.forEach(function (m) {
        var b = m.userData.base, bi = m.userData.baseI || 1;
        tmpC.copy(GLOW).multiplyScalar(0.3 * entry.h / bi);
        m.emissive.copy(b).add(tmpC);
      });
    }

    // ------------------------------------------------------------ câmera e paradas

    var basePos = V(0, 0, 0), baseTarget = V(0, 0, 0), tiltFactor = 1, flight = null, stop = 'pc';
    var ptr = { x: 0, y: 0 }, tilt = { x: 0, y: 0 }, touchMode = false;
    try { touchMode = !!(global.matchMedia && global.matchMedia('(hover: none) and (pointer: coarse)').matches); } catch (e) { touchMode = false; }

    // Faixa livre da tela (px de cima e de baixo ocupados pelo HUD), passada pela página.
    var insets = { top: 0, bottom: 0 };
    function freeBand() { var h = Math.max(1, lastH || canvas.getBoundingClientRect().height || 1); return { k: Math.max(0.35, 1 - (insets.top + insets.bottom) / h), shift: (insets.top - insets.bottom) / 2 / h }; }
    // Desloca câmera e alvo para cima/baixo para o objeto ficar no meio da faixa livre.
    function centerInBand(pos, target, dist, shiftFrac, tanH) {
      var up = V(0, 1, 0), dy = shiftFrac * 2 * dist * tanH;
      pos.addScaledVector(up, dy); target.addScaledVector(up, dy);
    }
    function screenPose() {
      mon.updateWorldMatrix(true, true);
      var c = V(0, 0, 0).applyMatrix4(screen.matrixWorld);
      var n = V(0, 0, 1).transformDirection(screen.matrixWorld);
      var tanH = Math.tan(T.MathUtils.degToRad(camera.fov / 2)), band = freeBand();
      var dH = (SH / (0.94 * band.k)) / (2 * tanH), dW = (SW / 0.95) / (2 * tanH * camera.aspect); // a tela quase inteira na faixa livre
      var d = Math.max(dH, dW), pos = c.clone().addScaledVector(n, d), target = c.clone();
      centerInBand(pos, target, d, band.shift, tanH);
      return { pos: pos, target: target, tilt: 0 };
    }
    // 'pc': o monitor inteiro de frente, ocupando quase a tela toda (a abertura, como um palco).
    var monBounds = null; // caixa do monitor no mundo; o PC gerado troca pela dele
    var ringRest = false; // o ledPower virou o anel laranja do botão do monitor gerado
    function pcPose() {
      mon.updateWorldMatrix(true, true);
      var box = monBounds || new T.Box3().setFromObject(mon).union(new T.Box3().setFromObject(pc)); // reserva: monitor e gabinete (o botão fica no gabinete)
      var size = box.getSize(V(0, 0, 0)), c = box.getCenter(V(0, 0, 0));
      var n = V(0, 0, 1).transformDirection(screen.matrixWorld); n.y = 0; n.normalize();
      var tanH = Math.tan(T.MathUtils.degToRad(camera.fov / 2));
      var band = freeBand();
      var d = Math.max((size.y / (0.9 * band.k)) / (2 * tanH), (size.x / 0.9) / (2 * tanH * camera.aspect)) + size.z / 2;
      var target = c.clone(); target.y += size.y * 0.02;
      var pos = target.clone().addScaledVector(n, d); pos.y += d * 0.06; // um tico de cima, como quem senta na frente
      centerInBand(pos, target, d - size.z / 2, band.shift, tanH);
      return { pos: pos, target: target, tilt: 0.3 };
    }
    function stopPose(name) {
      if (name === 'screen') return screenPose();
      if (name === 'pc') return pcPose();
      var d = STOPS[name], pos = V(d.pos[0], d.pos[1], d.pos[2]), target = V(d.target[0], d.target[1], d.target[2]);
      var need = 1.45, a = camera.aspect;
      // tela estreita (retrato): recua a câmera um pouco para caber a mesa, sem sair do quarto
      if (a < need) { var k = Math.min(1.9, need / a); pos.sub(target).multiplyScalar(1 + (k - 1) * 0.55).add(target); }
      return { pos: pos, target: target, tilt: d.tilt };
    }
    function nowS() { return (global.performance && performance.now ? performance.now() : Date.now()) / 1000; }
    // Relógio da pose da câmera. O render usa o carimbo do quadro (rAF). Quem pergunta os cantos no
    // mesmo quadro (o rAF do integrador, antes ou depois do nosso) precisa da MESMA pose, senão o
    // desktop HTML escorrega alguns px sobre a moldura durante o voo (o render leva ms de CPU).
    // document.timeline.currentTime vale o carimbo do quadro atual em todos os callbacks dele.
    var lastFrameT = 0, lastTl = null;
    function timelineNow() {
      try { var tl = document.timeline && document.timeline.currentTime; return typeof tl === 'number' && isFinite(tl) ? tl : null; } catch (e) { return null; }
    }
    function poseTime() {
      var tl = timelineNow();
      if (tl == null) return nowS();
      if (tl === lastTl) return lastFrameT; // mesmo quadro que já desenhamos (ou entre quadros): a pose que está na tela
      return tl / 1000;                     // quadro novo que ainda vamos desenhar: a pose que vai para a tela
    }
    var tmpOff = V(0, 0, 0), tmpAxis = V(0, 0, 0);
    function poseAt(t) {
      if (flight) {
        var q = clamp((t - flight.t0) / flight.dur, 0, 1), e = easeInOut(q);
        basePos.lerpVectors(flight.fromPos, flight.toPos, e);
        basePos.y += Math.sin(Math.PI * q) * flight.arc;
        baseTarget.lerpVectors(flight.fromTarget, flight.toTarget, e);
        tiltFactor = flight.fromTilt + (flight.toTilt - flight.fromTilt) * e;
        if (q >= 1) { flight = null; dirty = true; } // garante um render na pose final mesmo pausada
      }
      tmpOff.subVectors(basePos, baseTarget);
      var yaw = tilt.x * 0.06 * tiltFactor, pitch = tilt.y * 0.035 * tiltFactor;
      if (yaw) tmpOff.applyAxisAngle(Y_AXIS, yaw);
      if (pitch) { tmpAxis.crossVectors(Y_AXIS, tmpOff); if (tmpAxis.lengthSq() > 1e-8) tmpOff.applyAxisAngle(tmpAxis.normalize(), pitch); }
      camera.position.copy(baseTarget).add(tmpOff);
      camera.lookAt(baseTarget);
      camera.updateMatrixWorld();
    }
    function goTo(name, o) {
      if (disposed || STOP_NAMES.indexOf(name) < 0) return false;
      var instant = reduced || (o && o.instant) || !started;
      // já indo para lá: não recomeça o voo (clicar duas vezes no mesmo botão não deixa a viagem mais lenta)
      if (name === stop && flight && !instant) return true;
      var p = stopPose(name);
      // já parada lá: nada a animar (evita 1,4 s de "voo" parado com moving = true)
      if (name === stop && !flight) instant = true;
      stop = name;
      if (instant) {
        flight = null; basePos.copy(p.pos); baseTarget.copy(p.target); tiltFactor = p.tilt;
      } else {
        poseAt(poseTime());
        var dist = basePos.distanceTo(p.pos);
        flight = { fromPos: basePos.clone(), fromTarget: baseTarget.clone(), toPos: p.pos, toTarget: p.target, fromTilt: tiltFactor, toTilt: p.tilt, t0: nowS(), dur: 1.4, arc: Math.min(0.16, dist * 0.03) };
      }
      hoverDirty = true; // a vista mudou: o objeto sob o ponteiro pode ser outro
      kick();
      return true;
    }

    // ------------------------------------------------------------ cantos da tela

    var cv = V(0, 0, 0), cc = V(0, 0, 0), sn = V(0, 0, 0), sc = V(0, 0, 0);
    function getScreenCorners() {
      if (disposed) return null;
      poseAt(poseTime());
      screen.updateWorldMatrix(true, false);
      var r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      sc.set(0, 0, 0).applyMatrix4(screen.matrixWorld);
      sn.set(0, 0, 1).transformDirection(screen.matrixWorld);
      if (sn.dot(cc.subVectors(camera.position, sc)) <= 0) return null; // de costas
      var out = [], L = true, Rr = true, Tt = true, B = true;
      for (var i = 0; i < 4; i++) {
        cv.copy(CORNERS[i]).applyMatrix4(screen.matrixWorld);
        cc.copy(cv).applyMatrix4(camera.matrixWorldInverse);
        if (cc.z > -camera.near) return null; // atrás da câmera
        cv.project(camera);
        if (cv.x > -1) L = false; if (cv.x < 1) Rr = false; if (cv.y < 1) Tt = false; if (cv.y > -1) B = false;
        out.push({ x: r.left + (cv.x + 1) * 0.5 * r.width, y: r.top + (1 - cv.y) * 0.5 * r.height });
      }
      if (L || Rr || Tt || B) return null; // toda fora da vista
      return out;
    }
    function isScreenFacing() {
      var c = getScreenCorners();
      if (!c) return false;
      var r = canvas.getBoundingClientRect();
      var hpx = (Math.hypot(c[0].x - c[3].x, c[0].y - c[3].y) + Math.hypot(c[1].x - c[2].x, c[1].y - c[2].y)) / 2;
      if (hpx < r.height * 0.15) return false;
      sc.set(0, 0, 0).applyMatrix4(screen.matrixWorld);
      sn.set(0, 0, 1).transformDirection(screen.matrixWorld);
      if (sn.dot(cc.subVectors(camera.position, sc).normalize()) < 0.5) return false;
      var mx = (c[0].x + c[1].x + c[2].x + c[3].x) / 4, my = (c[0].y + c[1].y + c[2].y + c[3].y) / 4;
      return mx > r.left && mx < r.right && my > r.top && my < r.bottom;
    }

    // ------------------------------------------------------------ clique e hover

    var raycaster = new T.Raycaster();
    raycaster.params.Points.threshold = 0.0005;
    if (raycaster.params.Line) raycaster.params.Line.threshold = 0.0005;
    var ndc = new T.Vector2();
    function shown(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }
    function pickAt(clientX, clientY) {
      var r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      var nx = ((clientX - r.left) / r.width) * 2 - 1, ny = -((clientY - r.top) / r.height) * 2 + 1;
      if (nx < -1 || nx > 1 || ny < -1 || ny > 1) return null;
      poseAt(poseTime());
      ndc.set(nx, ny); raycaster.setFromCamera(ndc, camera);
      var hits = raycaster.intersectObject(room, true);
      for (var i = 0; i < hits.length; i++) {
        var o = hits[i].object;
        if (o.isPoints || o.isSprite || o.userData.noPick || !shown(o)) continue;
        while (o && o !== room) { if (o.userData.pick) return o.userData.pick; o = o.parent; }
        return null; // a primeira coisa atingida não é clicável: ela tapa o resto
      }
      return null;
    }
    var hovered = null, lastClient = null, hoverDirty = false, pointerOnCanvas = false;
    function setHovered(name) {
      if (name === hovered) return;
      hovered = name;
      if (!noteDrag && !placing) canvas.style.cursor = name ? (String(name).indexOf('note:') === 0 ? 'grab' : 'pointer') : '';
      if (onHover) onHover(name);
      kick();
    }
    function onPointerMove(e) {
      if (e.pointerType === 'touch') { touchMode = true; return; }
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') touchMode = false;
      var r = canvas.getBoundingClientRect();
      if (r.width && r.height) {
        ptr.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
        ptr.y = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
      }
      pointerOnCanvas = e.target === canvas;
      lastClient = { x: e.clientX, y: e.clientY };
      hoverDirty = true;
      schedule(); // se o laço estiver dormindo (pausa), o hover ainda responde
    }
    function onPointerLeave() { pointerOnCanvas = false; hoverDirty = true; schedule(); }
    var pressT = -1;
    function onClick(e) {
      if (suppressClick) { suppressClick = false; return; }
      var name = pickAt(e.clientX, e.clientY);
      if (!name) return;
      if (name === 'power') { pressT = nowS(); kick(); }
      onPick(name);
    }
    global.addEventListener('pointermove', onPointerMove, { passive: true });
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('click', onClick);

    // ------------------------------------------------------------ redimensionar

    var lastW = 0, lastH = 0, lastDpr = 0;
    function resize() {
      if (disposed) return;
      var r = canvas.getBoundingClientRect();
      var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      var dpr = Math.min(global.devicePixelRatio || 1, 1.75);
      // o zoom do navegador muda o devicePixelRatio sem mudar o tamanho CSS: também refaz o buffer
      if (w === lastW && h === lastH && dpr === lastDpr) return;
      lastW = w; lastH = h; lastDpr = dpr;
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      var r2 = canvas.getBoundingClientRect();
      if (Math.abs(r2.width - w) > 1 || Math.abs(r2.height - h) > 1) { canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; }
      camera.aspect = w / h; camera.updateProjectionMatrix();
      var p = stopPose(stop);
      if (flight) { flight.toPos = p.pos; flight.toTarget = p.target; }
      else { basePos.copy(p.pos); baseTarget.copy(p.target); }
      kick();
    }
    var ro = null;
    if (global.ResizeObserver) { ro = new ResizeObserver(function () { resize(); }); ro.observe(canvas); }
    global.addEventListener('resize', resize);

    // ------------------------------------------------------------ laço

    var raf = 0, disposed = false, paused = false, started = false, dirty = true;
    var globeSnow = null; // neve do globo do FlashClip (entra com o modelo)
    var animT = 0, lastT = 0, keyAnim = null, hddT = 0, hddKick = -1, fanSpeed = 0, lastClockMin = -1;

    function update(t, dt) {
      var deco = !paused && !reduced; // animações decorativas
      if (deco) animT += dt;
      var busy = !!flight;

      // inclinação pelo ponteiro (amortecida)
      var tiltOn = !reduced && !paused && !touchMode;
      var tx = tiltOn ? ptr.x : 0, ty = tiltOn ? ptr.y : 0;
      // com movimento reduzido a câmera volta ao lugar de uma vez, sem deslizar
      var nx = reduced ? 0 : damp(tilt.x, tx, 3.2, dt), ny = reduced ? 0 : damp(tilt.y, ty, 3.2, dt);
      if (Math.abs(nx - tilt.x) > 1e-5 || Math.abs(ny - tilt.y) > 1e-5) busy = true;
      tilt.x = nx; tilt.y = ny;
      poseAt(t);

      // energia: LEDs, display, ventoinha, luz da tela
      var on = power !== 'off';
      // com o PC gerado o ledPower é o anel laranja do botão: aceso ligado, brasa desligado, mais forte no hover
      var ledI = ringRest ? (on ? 1 : 0.22) + (hovered === 'power' ? 0.55 : 0) : (on ? 2.2 : 0);
      if (ledPower.material.emissiveIntensity !== ledI) { ledPower.material.emissiveIntensity = ledI; ledMon.material.emissiveIntensity = ledI; busy = true; }
      var hddI = 0;
      if (flashErr > 0.02) hddI = 2;
      else if (power === 'warmup' || power === 'bios') { hddT += dt; hddI = (Math.sin(hddT * 37) + Math.sin(hddT * 23.7)) > 0.6 ? 2 : 0.1; if (reduced) hddI = 1.4; else busy = true; }
      else if (power === 'on' && t - hddKick < 0.11) { hddI = 1.8; busy = true; } // cada tecla "acessa o disco"
      ledHdd.material.emissive.copy(flashErr > 0.02 ? linc('#ff3b2f') : linc('#ffae3a'));
      ledHdd.material.emissiveIntensity = hddI;
      drawSeg(on);
      fanSpeed = damp(fanSpeed, on ? 1 : 0, 1.6, dt);
      if (deco && fanSpeed > 0.01) { fanBlades.rotation.z -= fanSpeed * dt * 28; busy = true; }

      var th = THEMES[theme], target = 0, warmP = reduced ? 1 : clamp((t - powerT0) / 0.6, 0, 1);
      if (power === 'warmup') { target = warmP < 0.2 ? warmP * 2.5 : warmP < 0.62 ? 1.25 - (warmP - 0.2) * 1.6 : 0.4; if (warmP < 1) { screenDirty = true; busy = true; } }
      else if (power === 'bios') target = 0.42;
      else if (power === 'on') target = th.power;
      screenLevel = reduced ? target : damp(screenLevel, target, 8, dt);
      if (Math.abs(screenLevel - target) > 0.002) busy = true;
      flashWin = Math.max(0, flashWin - dt / 0.6); flashErr = Math.max(0, flashErr - dt / 0.8);
      if (flashWin > 0 || flashErr > 0) busy = true;
      screenLight.color.copy(power === 'bios' || power === 'warmup' ? linc('#d8e4e0') : linc(th.light));
      if (flashErr > 0) screenLight.color.lerp(linc('#ff4a3a'), Math.min(1, flashErr * 1.4));
      screenLight.intensity = screenLevel * 0.9 * (1 + flashWin * 1.6 + flashErr * 0.8);
      haloMat.color.copy(screenLight.color);
      haloMat.opacity = Math.min(1, screenLevel * 0.6 * (0.4 + 0.6 * decoLevel) * (1 + flashWin * 1.3 + flashErr * 0.6));
      halo.visible = haloMat.opacity > 0.004;
      screenMat.color.setScalar(1 + flashWin * 0.25);
      if (flashErr > 0) screenMat.color.setRGB(1 + flashErr * 0.5, 1 - flashErr * 0.35, 1 - flashErr * 0.35);
      if (!on) screenMat.color.setScalar(1);

      // tela: redesenha só quando precisa
      if (power === 'off' && shutAnim) { screenDirty = true; busy = true; }
      if (power === 'bios') { var blink = reduced ? 0 : Math.floor(t / 0.53) % 2; if (blink !== lastBlink) { lastBlink = blink; screenDirty = true; } }
      if (power === 'on') { var mnt = new Date().getMinutes(); if (mnt !== lastMinute) { lastMinute = mnt; screenDirty = true; } }
      if (screenDirty) { redrawScreen(t); busy = true; }

      // tecla afundando (pulse 'key') e botão de power apertado
      if (keyAnim) {
        var kq = (t - keyAnim.t0) / 0.18;
        setKey(keyAnim.i, kq < 1 ? 0.0045 * Math.sin(Math.PI * clamp(kq, 0, 1)) : 0);
        keyMesh.instanceMatrix.needsUpdate = true; renderer.shadowMap.needsUpdate = true;
        if (kq >= 1) keyAnim = null; busy = true;
      }
      var pq = pressT < 0 ? 1 : (t - pressT) / 0.22;
      var pz = 0.004 - (pq < 1 ? 0.0045 * Math.sin(Math.PI * clamp(pq, 0, 1)) : 0);
      if (powerBtn.position.z !== pz) { powerBtn.position.z = pz; renderer.shadowMap.needsUpdate = true; busy = true; }

      // brilho de hover. Durante o voo da câmera o que está sob o ponteiro muda sem o ponteiro mexer:
      // apaga o hover no voo e refaz a escolha quando a câmera pousa.
      if (flight) { if (hovered) setHovered(null); hoverDirty = true; }
      else if (hoverDirty) {
        hoverDirty = false;
        setHovered(pointerOnCanvas && lastClient ? pickAt(lastClient.x, lastClient.y) : null);
      }
      Object.keys(pickGroups).forEach(function (k) {
        var e = pickGroups[k], tgt = hovered === k ? 1 : 0;
        if (e.h === tgt) return;
        e.h = reduced ? tgt : damp(e.h, tgt, 12, dt);
        if (Math.abs(e.h - tgt) < 0.01) e.h = tgt;
        applyGlow(e); busy = true;
      });

      // decorativos: poeira, vapor, luzinhas, impressora, relógio
      if (deco || dirty) {
        updateDust(animT); updateSteam(animT);
        if (globeSnow && deco) { // cada floco desce devagar, balança um pouco e volta ao topo do vidro
          var gp = globeSnow.pos; for (var gi = 0; gi < globeSnow.n; gi++) { var gy = gp[gi * 3 + 1] - dt * (0.18 + (gi % 7) * 0.03); gp[gi * 3] += Math.sin(animT * 0.9 + gi) * dt * 0.05; if (gy < 0.92) gy = 3.5; gp[gi * 3 + 1] = gy; }
          globeSnow.geo.attributes.position.needsUpdate = true;
        }
        fairyMats.forEach(function (m, i) { m.emissiveIntensity = (0.4 + 0.6 * decoLevel) * (reduced ? 1.5 : 1.35 + 0.35 * Math.sin(animT * 1.1 + i * 2.1)); });
        var head = printer.userData.head; head.position.x = 0.02 + (reduced ? 0 : Math.sin(animT * 1.6) * 0.07);
        if (deco) busy = true;
      }
      var now = new Date(), sec = now.getSeconds() + (reduced ? 0 : now.getMilliseconds() / 1000);
      // sem animação contínua (movimento reduzido/pausa) a cena só redesenha quando algo muda: o relógio
      // de parede precisa pedir um quadro quando vira o minuto
      var clockMin = now.getHours() * 60 + now.getMinutes();
      if (clockMin !== lastClockMin) { lastClockMin = clockMin; busy = true; }
      if (hSec.visible === reduced) { hSec.visible = !reduced; busy = true; }
      hSec.rotation.z = -sec / 60 * Math.PI * 2;
      hMin.rotation.z = -(now.getMinutes() + sec / 60) / 60 * Math.PI * 2;
      hHour.rotation.z = -((now.getHours() % 12) + now.getMinutes() / 60) / 12 * Math.PI * 2;
      return busy;
    }

    function frame(ts) {
      raf = 0;
      if (disposed) return;
      var t = typeof ts === 'number' && isFinite(ts) && ts > 0 ? ts / 1000 : nowS();
      var dt = Math.min(0.05, Math.max(0, t - (lastT || t)));
      lastFrameT = t; lastTl = timelineNow();
      lastT = t;
      var busy = update(t, dt);
      // Desenha só quando algo mudou. Com animação decorativa ligada isso é todo quadro; com movimento
      // reduzido ou pausa a GPU fica parada até a próxima mudança.
      if (busy || dirty) {
        renderer.render(scene, camera);
        dirty = false;
        if (onFrame) onFrame(api);
      }
      // pausada e ociosa, a cena nem pede rAF: kick() (API, ponteiro, relógio) acorda o laço
      if (!paused || busy || dirty) schedule();
    }
    function schedule() {
      if (!raf && !disposed && !document.hidden) raf = global.requestAnimationFrame(frame);
    }
    function kick() { dirty = true; schedule(); }
    function onVisibility() {
      if (document.hidden) { if (raf) { global.cancelAnimationFrame(raf); raf = 0; } }
      else { lastT = 0; dirty = true; schedule(); }
    }
    document.addEventListener('visibilitychange', onVisibility);
    // a cada minuto: fase do céu pela hora real e um quadro para o relógio (mesmo com o laço dormindo)
    var hourTimer = setInterval(function () { applyPhase(phaseForHour(currentHour())); schedule(); }, 60000);

    // ------------------------------------------------------------ API pública

    var api = {
      setPower: function (s) {
        if (disposed || ['off', 'warmup', 'bios', 'on'].indexOf(s) < 0 || s === power) return;
        // desligando com imagem na tela: guarda o último quadro para a animação de "apagar" do CRT
        shutAnim = s === 'off' && !reduced && screenLevel > 0.05;
        if (shutAnim) snapshotScreen();
        power = s; powerT0 = nowS(); screenDirty = true; lastBlink = -1; lastMinute = -1;
        if (s === 'off') screenLevel = reduced ? 0 : screenLevel;
        kick();
      },
      setBiosLines: function (lines) {
        biosLines = Array.isArray(lines) ? lines.map(function (l) { return l == null ? '' : String(l); }) : [];
        if (power === 'bios') { screenDirty = true; kick(); }
      },
      goTo: goTo,
      getScreenCorners: getScreenCorners,
      isScreenFacing: isScreenFacing,
      setPaused: function (b) { paused = !!b; kick(); lastT = 0; },
      setReducedMotion: function (b) {
        reduced = !!b; kick(); screenDirty = true;
        if (reduced && flight) { basePos.copy(flight.toPos); baseTarget.copy(flight.toTarget); tiltFactor = flight.toTilt; flight = null; }
      },
      setTheme: function (name) {
        if (!Object.prototype.hasOwnProperty.call(THEMES, name) || name === theme) return; // 'constructor' não é tema
        theme = name; screenDirty = true; kick();
      },
      pulse: function (kind) {
        if (disposed) return;
        var t = nowS();
        if (kind === 'key') {
          if (kb.visible) { // com o PC gerado o teclado desenhado some: o retorno fica no LED do disco
            if (keyAnim) setKey(keyAnim.i, 0);
            keyAnim = { i: alphaKeys[Math.floor(Math.random() * alphaKeys.length)], t0: t };
          }
          hddKick = t;
        } else if (kind === 'win') flashWin = 1;
        else if (kind === 'error') flashErr = 1;
        else return;
        kick();
      },
      resize: function () { lastW = lastH = 0; resize(); },
      // recados dos post-its: texto atual, troca e o texto que veio de fábrica
      getNote: function (id) { return notes[id] ? notes[id].st.texto : null; },
      getNoteColor: function (id) { return notes[id] ? notes[id].st.cor : null; },
      isDefaultNote: function (id) { return !!defOf(id); },
      setNote: function (id, texto) { var nt = notes[id]; if (!nt) return; nt.st.texto = String(texto || '').slice(0, 90); paintNote(nt); changed(); },
      // volta o recado de fábrica: texto, lugar e de volta à parede se tinha sido tirado
      restoreNote: function (id) { var d = defOf(id), nt = notes[id]; if (!d || !nt) return; nt.st = JSON.parse(JSON.stringify(d)); delete noteMoved[id]; paintNote(nt); orient(nt); changed(); },
      removeNote: function (id) { var nt = notes[id]; if (!nt) return; if (defOf(id)) { nt.st.removido = true; orient(nt); } else { room.remove(nt.group); nt.mesh.geometry.dispose(); delete notes[id]; } changed(); },
      // post-it novo: segue o ponteiro pelas superfícies até um clique grudar (onNotePlaced avisa a página)
      newNote: function () {
        if (placing) return placing.st.id;
        var id = 'u' + Date.now().toString(36) + (noteSeq++), cor = NOTE_COLORS[(Object.keys(notes).length) % NOTE_COLORS.length];
        placing = makeNote({ id: id, cor: cor, texto: '', pos: null, n: [0, 0, 1], tilt: (Math.random() - 0.5) * 0.3, novo: true });
        placing.group.visible = false; canvas.style.cursor = 'copy';
        if (lastClient) { var s = surfaceAt(lastClient.x, lastClient.y); if (s) { stickTo(placing, s); placing.group.visible = true; } }
        return id;
      },
      cancelNewNote: function () { if (!placing) return; room.remove(placing.group); delete notes[placing.st.id]; placing = null; canvas.style.cursor = ''; kick(); },
      isPlacingNote: function () { return !!placing; },
      // recados guardados pela página: muda os de fábrica e recria os que a pessoa colou
      loadNotes: function (list) {
        (list || []).forEach(function (st) {
          if (!st || !st.id) return;
          if (notes[st.id]) { notes[st.id].st = Object.assign(notes[st.id].st, st); noteMoved[st.id] = true; paintNote(notes[st.id]); orient(notes[st.id]); }
          else if (st.pos) makeNote(Object.assign({ tilt: 0, n: [0, 0, 1] }, st));
        });
      },
      notesState: snapshot,
      // onde o post-it aparece na tela (px da janela), para testes e para a página apontar para ele
      noteScreen: function (id) { var nt = notes[id]; if (!nt || !nt.group.visible) return null; var p = nt.group.getWorldPosition(V(0, 0, 0)).project(camera), r = canvas.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; },
      // px ocupados pelo HUD em cima e embaixo; as paradas 'pc' e 'screen' se enquadram no que sobra
      setViewInsets: function (top, bottom) {
        top = Math.max(0, +top || 0); bottom = Math.max(0, +bottom || 0);
        if (Math.abs(top - insets.top) < 1 && Math.abs(bottom - insets.bottom) < 1) return;
        insets.top = top; insets.bottom = bottom;
        if (stop !== 'pc' && stop !== 'screen') return;
        var p = stopPose(stop);
        if (flight) { flight.toPos = p.pos; flight.toTarget = p.target; } else { basePos.copy(p.pos); baseTarget.copy(p.target); }
        kick();
      },
      dispose: function () {
        if (disposed) return;
        disposed = true;
        if (raf) global.cancelAnimationFrame(raf); raf = 0;
        clearInterval(hourTimer); clearTimeout(fontTimer);
        global.removeEventListener('pointermove', onPointerMove);
        global.removeEventListener('resize', resize);
        canvas.removeEventListener('pointerleave', onPointerLeave);
        canvas.removeEventListener('click', onClick);
        document.removeEventListener('visibilitychange', onVisibility);
        if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', onFontsDone);
        if (ro) ro.disconnect();
        canvas.style.cursor = '';
        scene.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.dispose(); });
        });
        textures.forEach(function (t) { t.dispose(); });
        renderer.dispose();
      },
      // extras
      getState: function () { return { power: power, stop: stop, theme: theme, phase: phase, paused: paused, reducedMotion: reduced, moving: !!flight, hovered: hovered }; },
      _info: function () { var i = renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs ? i.programs.length : null }; },
      _pickPoint: function (name) {
        var o = null;
        if (name === 'power') o = powerBtn; else if (name === 'screen') o = screen; else if (name === 'board') o = board; else if (name === 'window') o = glass;
        else if (pickGroups[name]) o = pickGroups[name].group;
        if (!o) return null;
        poseAt(poseTime());
        // procura um ponto VISÍVEL do objeto (o centro pode estar tapado por um vizinho)
        var box = new T.Box3().setFromObject(o), r = canvas.getBoundingClientRect(), x0 = 1, x1 = -1, y0 = 1, y1 = -1;
        for (var i = 0; i < 8; i++) { var q = V(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
        var c = box.getCenter(V(0, 0, 0)).project(camera), cands = [[c.x, c.y]];
        for (var gy = 1; gy < 8; gy++) for (var gx = 1; gx < 8; gx++) cands.push([x0 + (x1 - x0) * gx / 8, y0 + (y1 - y0) * gy / 8]);
        for (var k = 0; k < cands.length; k++) {
          var px = r.left + (cands[k][0] + 1) * 0.5 * r.width, py = r.top + (1 - cands[k][1]) * 0.5 * r.height;
          if (pickAt(px, py) === name) return { x: px, y: py };
        }
        return null;
      }
    };

    // estado inicial: porta, PC desligado, céu da hora atual
    applyPhase(phaseForHour(currentHour()));
    resize();
    goTo('pc', { instant: true });
    poseAt(poseTime());
    redrawScreen(nowS());
    updateDust(0); updateSteam(0);
    started = true;
    schedule();
    return api;
  }

  global.AndreyScene = {
    init: init,
    PROJECTS: PROJECTS.map(function (p) { return { id: p.id, nome: p.nome, objeto: p.objeto }; }),
    STOPS: STOP_NAMES.slice()
  };
})(window);
