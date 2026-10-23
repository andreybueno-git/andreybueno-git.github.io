/*
 * audio.js — a trilha e os efeitos do AndreyOS, sintetizados na hora com Web Audio.
 * Nada de arquivo de áudio, amostra ou serviço externo: cada som nasce de osciladores e ruído.
 *
 * Contrato:
 *   AndreyAudio.create({ storageKey: 'andreyos.som' }) -> api
 *   api.unlock()         chamar dentro de um gesto do visitante: cria ou retoma o AudioContext.
 *                        Antes disso nada toca; as outras chamadas só guardam a intenção.
 *   api.setOn(bool)      liga/desliga TODO o som (música + efeitos) com fade de 300 ms e guarda a escolha
 *   api.isOn()           sem nada guardado (ou sem storage), o padrão é ligado
 *   api.toggle()         inverte e devolve o novo estado
 *   api.music(play)      começa ou para a trilha (para com fade curto; começar de novo não duplica vozes).
 *                        Pedida antes do unlock, ela começa sozinha quando o som for liberado.
 *   api.sfx(nome)        'power' | 'beep' | 'key' | 'boot' | 'off' | 'click' | 'error' | 'win'
 *   api.setPaused(bool)  aba oculta: suspende o contexto e o agendador; ao voltar segue de onde parou,
 *                        sem pular nem amontoar notas (a aba oculta também pausa sozinha)
 *   api.dispose()
 *
 * Sem AudioContext no navegador tudo vira no-op (isOn/setOn/toggle continuam guardando a escolha).
 * opts.contextOptions vai direto para o construtor do AudioContext (o teste em dev/ usa sinkId 'none').
 *
 * A trilha: lo-fi de madrugada em Dó maior, 76 BPM, 16 compassos (≈ 50,5 s) que se repetem:
 *   Fmaj9 · Em7 · Dm9 · Cmaj9 | Fmaj9 · Em7 · Dm9 · G9sus4→G13 |
 *   Am9 · Em7 · Fmaj7 · E7(b9) | Am9 · Dm9 · Fm6 · Cmaj9→C9   (o C9 puxa de volta para o Fá)
 * Piano elétrico FM com tremolo, baixo redondo, um lead de onda de pulso filtrada (chip de PC antigo),
 * bumbo macio, aro e chimbal de ruído com swing, e um chiado de vinil bem baixo. O piano e o lead
 * passam por um "wow" de fita (atraso modulado) que também abre o estéreo.
 * A primeira volta tem 2 compassos de introdução; depois, três arranjos se revezam a cada volta.
 * O agendador nunca "volta ao começo": ele só conta semicolcheias, então a emenda é contínua.
 * Volume de fundo de site (medido em dev/audio-harness.html): trilha ≈ −24,5 dBFS RMS e pico ≈ −7 dBFS;
 * um limitador acima de −6 dBFS segura a soma rara de efeito com pico da música.
 *
 * Para o harness de dev/: AndreyAudio._engine(ctx) monta o mesmo grafo num OfflineAudioContext.
 */
(function (global) {
  'use strict';

  const AC = global.AudioContext || global.webkitAudioContext;
  const noop = function () {};

  /* ------------------------------------------------------------------ */
  /* Tempo, grade e níveis                                               */
  /* ------------------------------------------------------------------ */

  const BPM = 76;
  const BEAT = 60 / BPM;
  const STEP = BEAT / 4;                  // uma semicolcheia
  const BAR = BEAT * 4;
  const LOOP_BARS = 16;
  const LOOP_STEPS = LOOP_BARS * 16;
  const LOOP_SECONDS = LOOP_BARS * BAR;   // ≈ 50,53 s
  const SWING = 0.08;                     // a 2ª colcheia de cada tempo chega 8% de tempo atrasada
  const SLOT = [0, 0.25 + SWING / 2, 0.5 + SWING, 0.75 + SWING / 2];
  const WOW_DELAY = 0.0155;               // atraso médio do wow de fita (piano e lead saem antes para compensar)
  const LOOKAHEAD = 0.3;                  // quanto o agendador ao vivo enxerga à frente (s)
  const TICK_MS = 50;
  const TONE_HZ = 8500;                   // o teto do som da trilha: quente, sem brilho digital
  const OUT_TRIM = 0.62;                  // volume geral (medido no harness: fundo de site, picos abaixo do limitador)
  const LIMITER_MAKEUP_UNDO = 0.745;      // 1 / ganho de compensação do limitador (+2,56 dB, medido no harness)
  // Equilíbrio da mistura (pico de cada instrumento), acertado com as medidas por instrumento do harness.
  const EP_LEVEL = 0.1, LEAD_LEVEL = 0.1, BASS_LEVEL = 0.09, KICK_LEVEL = 0.38, RIM_LEVEL = 2.5, HAT_LEVEL = 0.12;
  const FADE_ONOFF = 0.3;
  const FADE_MUSIC_IN = 1.2;
  const FADE_MUSIC_OUT = 0.25;

  // Nível de cada efeito (multiplica a voz inteira) e quanto dele vai para o eco curto.
  const SFX_LEVEL = { power: 1.2, beep: 2.3, key: 0.42, boot: 1.45, off: 1, click: 1.4, error: 1.9, win: 1.7 };
  const SFX_ECHO = { boot: 0.55, win: 0.45, beep: 0.2, error: 0.15 };
  // Polifonia: no máximo N vozes do mesmo efeito e 8 no total; a mais velha sai com fade curto.
  const SFX_CAP = { key: 4, click: 3, beep: 3 };
  const SFX_CAP_DEFAULT = 2;
  const SFX_CAP_TOTAL = 8;
  // Chamadas repetidas do mesmo efeito mais perto que isso (s) viram uma só (ex.: 30 teclas no mesmo instante).
  const SFX_MIN_GAP = { key: 0.025, click: 0.03 };
  const SFX_MIN_GAP_DEFAULT = 0.06;

  // Tempo da semicolcheia s (contada desde o começo da trilha). Calculado, nunca acumulado: sem deriva.
  function stepOffset(s) { return Math.floor(s / 4) * BEAT + SLOT[s % 4] * BEAT; }
  function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  // Pseudoaleatório determinístico: a mesma trilha toda vez (e o harness mede exatamente o que toca).
  function hash(n) {
    let x = (n | 0) ^ 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ */
  /* A música (dados)                                                    */
  /* ------------------------------------------------------------------ */

  // Cada compasso: vozes do piano (MIDI) e a fundamental do baixo; c2 troca o acorde no meio do compasso.
  // As vozes descem em bloco (Fmaj9 → Em7 → Dm9 → Cmaj9), o jeito lo-fi de encadear sétimas.
  const BARS = [
    { c: [57, 60, 64, 67], b: 41 },                         // 1  Fmaj9
    { c: [55, 59, 62, 64], b: 40 },                         // 2  Em7
    { c: [53, 57, 60, 64], b: 38 },                         // 3  Dm9
    { c: [52, 55, 59, 62], b: 36 },                         // 4  Cmaj9
    { c: [57, 60, 64, 67], b: 41 },                         // 5  Fmaj9
    { c: [55, 59, 62, 64], b: 40 },                         // 6  Em7
    { c: [53, 57, 60, 64], b: 38 },                         // 7  Dm9
    { c: [53, 57, 60, 62], b: 43, c2: [53, 57, 59, 64] },   // 8  G9sus4 → G13
    { c: [55, 59, 60, 64], b: 45 },                         // 9  Am9
    { c: [55, 59, 62, 64], b: 40 },                         // 10 Em7
    { c: [53, 57, 60, 64], b: 41 },                         // 11 Fmaj7
    { c: [53, 56, 59, 62], b: 40 },                         // 12 E7(b9)
    { c: [55, 59, 60, 64], b: 45 },                         // 13 Am9
    { c: [53, 57, 60, 64], b: 38 },                         // 14 Dm9
    { c: [53, 56, 60, 62], b: 41 },                         // 15 Fm6 (emprestado do menor: a saudade)
    { c: [52, 55, 59, 62], b: 36, c2: [52, 55, 58, 62] }    // 16 Cmaj9 → C9
  ];

  // Batidas do piano: [semicolcheia, duração em semicolcheias, força]
  const COMP = {
    a: [[0, 10, 1], [10, 6, 0.55]],
    b: [[0, 6, 0.95], [6, 4, 0.5], [12, 4, 0.6]],
    split: [[0, 8, 1], [8, 8, 0.85]]
  };
  const ARP = [0, 1, 2, 3, 1, 2, 3, 2];
  // Baixo: [semicolcheia, duração, 'r' fundamental | 'g' fantasma | 'q' quinta | 'a' aproximação, força]
  const BASS = [[0, 6, 'r', 1], [7, 1, 'g', 0.45], [10, 4, 'q', 0.75], [14, 2, 'a', 0.55]];
  const BASS_LONG = [[0, 14, 'r', 0.9]];

  // Frases do lead (4 compassos cada): por compasso, [semicolcheia, nota MIDI, duração].
  const MEL = {
    A: [
      [[2, 72, 2], [4, 76, 4], [10, 79, 2], [12, 76, 4]],
      [[0, 74, 6], [8, 71, 2], [10, 74, 2], [12, 76, 4]],
      [[0, 72, 4], [4, 69, 2], [6, 72, 2], [8, 74, 4], [12, 77, 2], [14, 76, 2]],
      [[0, 74, 8], [10, 71, 2], [12, 67, 4]]
    ],
    A2: [
      [[2, 72, 2], [4, 76, 4], [10, 79, 2], [12, 76, 4]],
      [[0, 79, 4], [4, 76, 2], [6, 74, 2], [8, 71, 6]],
      [[0, 72, 4], [4, 69, 2], [6, 72, 2], [8, 74, 4], [12, 77, 2], [14, 76, 2]],
      [[0, 72, 6], [6, 74, 2], [8, 77, 2], [10, 76, 6]]
    ],
    C: [
      [[2, 69, 2], [4, 72, 2], [6, 76, 4], [10, 74, 2], [12, 72, 4]],
      [[0, 71, 6], [8, 67, 2], [10, 71, 2], [12, 74, 4]],
      [[0, 76, 4], [4, 72, 2], [6, 69, 2], [8, 67, 4], [12, 69, 2], [14, 72, 2]],
      [[0, 71, 4], [4, 68, 4], [8, 74, 2], [10, 71, 2], [12, 68, 4]]
    ],
    B: [
      [[0, 76, 2], [2, 79, 2], [4, 81, 6], [12, 79, 2], [14, 76, 2]],
      [[0, 77, 4], [4, 76, 2], [6, 74, 2], [8, 72, 4], [12, 69, 4]],
      [[0, 68, 4], [4, 72, 2], [6, 74, 2], [8, 72, 4], [12, 67, 4]],
      [[0, 76, 6], [8, 74, 2], [12, 70, 2]]
    ],
    B2: [
      [[0, 76, 2], [2, 79, 2], [4, 81, 6], [12, 79, 2], [14, 76, 2]],
      [[0, 77, 4], [4, 76, 2], [6, 74, 2], [8, 72, 4], [12, 69, 4]],
      [[0, 72, 2], [2, 68, 2], [4, 65, 4], [8, 67, 4], [12, 68, 4]],
      [[0, 67, 8], [12, 64, 2]]
    ]
  };
  // Que frase entra em que compasso, por arranjo. 0 = primeira volta (com introdução); 1–3 se revezam.
  const PLAN = [
    { 4: 'A', 12: 'B' },
    { 8: 'C', 12: 'B' },
    { 4: 'A2', 12: 'B2' },          // e a quebra nos compassos 9–12 (piano dedilhado, bateria rala)
    { 4: 'A', 8: 'C', 12: 'B' }     // e o "rádio velho": o som fecha um pouco nos compassos 9–10
  ];
  function arrangement(pass) { return pass === 0 ? 0 : 1 + (pass - 1) % 3; }

  /* ------------------------------------------------------------------ */
  /* Vozes: grupinhos de nós que nascem, tocam e se desmontam sozinhos   */
  /* ------------------------------------------------------------------ */

  function gainNode(ctx, v) { const n = ctx.createGain(); n.gain.value = v; return n; }
  function bq(ctx, type, f, q) {
    const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f;
    if (q != null) n.Q.value = q;
    return n;
  }
  function panner(ctx, p) {
    if (!ctx.createStereoPanner) return gainNode(ctx, 1); // Safari antigo: fica no centro
    const n = ctx.createStereoPanner(); n.pan.value = p; return n;
  }

  function voice(E, dest, bucket, name, level, echo) {
    const ctx = E.ctx;
    const v = { E: E, ctx: ctx, out: gainNode(ctx, level || 1), level: level || 1, nodes: [], srcs: 0, dead: false, dying: false, bucket: bucket, name: name || '', t0: ctx.currentTime };
    v.out.connect(dest);
    if (echo) { const s = gainNode(ctx, echo); v.out.connect(s); s.connect(E.sfxEcho); v.nodes.push(s); }
    bucket.add(v);
    return v;
  }
  function node(v, n) { v.nodes.push(n); return n; }
  function src(v, s, t0, t1, offset) {
    v.nodes.push(s); v.srcs++;
    s.onended = function () { if (--v.srcs <= 0) free(v); };
    if (offset === undefined) s.start(t0); else s.start(t0, offset);
    s.stop(t1);
    return s;
  }
  function osc(v, type, f, t0, t1) {
    const o = v.ctx.createOscillator();
    if (type === 'pulse') o.setPeriodicWave(v.E.pulse); else o.type = type;
    o.frequency.value = f;
    return src(v, o, t0, t1);
  }
  function noise(v, t0, t1, salt) {
    const b = v.ctx.createBufferSource(), buf = v.E.noise;
    b.buffer = buf;
    const room = Math.max(0, buf.duration - (t1 - t0) - 0.01);
    return src(v, b, t0, t1, hash(salt) * room);
  }
  function free(v) {
    if (v.dead) return;
    v.dead = true; v.bucket.delete(v);
    for (let i = 0; i < v.nodes.length; i++) {
      const n = v.nodes[i];
      if ('onended' in n) n.onended = null;
      try { n.disconnect(); } catch (e) { /* já solto */ }
    }
    try { v.out.disconnect(); } catch (e) { /* já solto */ }
    v.nodes.length = 0;
  }
  // Tira uma voz de cena com fade de 20 ms (sem clique). A limpeza garante a desmontagem mesmo se
  // alguma fonte agendada para o futuro nunca disparar onended.
  function kill(v, t) {
    if (v.dead || v.dying) return;
    v.dying = true;
    const g = v.out.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(v.level, t); g.linearRampToValueAtTime(0, t + 0.02);
    for (let i = 0; i < v.nodes.length; i++) {
      const n = v.nodes[i];
      if (typeof n.stop === 'function') { try { n.stop(t + 0.03); } catch (e) { /* já parou */ } }
    }
    if (global.setTimeout) global.setTimeout(function () { free(v); }, 150);
  }

  // Envelopes. Todo nó de envelope nasce com ganho 0: com o ganho padrão (1), a fonte que começa no meio
  // de uma amostra vaza uma amostra cheia antes do primeiro evento de automação — e isso é um clique.
  function pluck(p, t, peak, atk, tau) { p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + atk); p.setTargetAtTime(0, t + atk, tau); }
  // Rajada de ruído filtrado que cai com constante tau. Devolve o filtro (para varreduras).
  function burst(v, t, type, f, q, peak, tau, salt) {
    const ctx = v.ctx, n = noise(v, t, t + 0.002 + tau * 9, salt), fl = node(v, bq(ctx, type, f, q)), e = node(v, gainNode(ctx, 0));
    pluck(e.gain, t, peak, 0.001, tau);
    n.connect(fl); fl.connect(e); e.connect(v.out);
    return fl;
  }
  // Tom com queda de afinação (bumbo, baques, cliques).
  function thump(v, t, f0, f1, glide, peak, tau, type) {
    const o = osc(v, type || 'sine', f0, t, t + 0.004 + tau * 9);
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + glide);
    const e = node(v, gainNode(v.ctx, 0));
    pluck(e.gain, t, peak, 0.003, tau);
    o.connect(e); e.connect(v.out);
    return o;
  }
  // Nota que segura: ataque, sustenta e solta.
  function held(v, type, f, t, dur, peak, atk, rel, dest) {
    const o = osc(v, type, f, t, t + dur + rel * 9), e = node(v, gainNode(v.ctx, 0));
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(peak, t + atk);
    e.gain.setValueAtTime(peak, t + dur); e.gain.setTargetAtTime(0, t + dur, rel);
    o.connect(e); e.connect(dest || v.out);
    return o;
  }

  /* ------------------------------------------------------------------ */
  /* Instrumentos                                                        */
  /* ------------------------------------------------------------------ */

  // Piano elétrico: FM 1:1 com índice que cai rápido (o "latido" do ataque) + triângulo levemente desafinado.
  function epTone(v, t, midi, dur, vel, level) {
    const ctx = v.ctx, f = hz(midi), tEnd = t + Math.max(0.05, dur), tStop = tEnd + 0.9;
    const car = osc(v, 'sine', f, t, tStop), mod = osc(v, 'sine', f, t, tStop), idx = node(v, gainNode(ctx, 0));
    idx.gain.setValueAtTime(f * (1 + 1.1 * vel), t);     // tocar mais forte = ataque mais brilhante
    idx.gain.setTargetAtTime(f * 0.38, t, 0.18);
    mod.connect(idx); idx.connect(car.frequency);
    const tri = osc(v, 'triangle', f, t, tStop), triG = node(v, gainNode(ctx, 0.3));
    tri.detune.value = 6;
    tri.connect(triG);
    const env = node(v, gainNode(ctx, 0)), peak = level * vel;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.006);
    env.gain.setTargetAtTime(peak * 0.4, t + 0.006, 0.55);
    env.gain.setTargetAtTime(0, tEnd, 0.13);
    car.connect(env); triG.connect(env); env.connect(v.out);
  }
  // Lead de chip: pulso de 25% com filtro que fecha depressa e vibrato que chega atrasado nas notas longas.
  function leadTone(v, t, midi, dur, vel, level, vibrato) {
    const ctx = v.ctx, tEnd = t + Math.max(0.04, dur), tStop = tEnd + 0.35;
    const o = osc(v, 'pulse', hz(midi), t, tStop), lp = node(v, bq(ctx, 'lowpass', 2600, 0.8));
    lp.frequency.setValueAtTime(2600, t); lp.frequency.setTargetAtTime(1350, t + 0.01, 0.14);
    if (vibrato !== false && dur > 0.25) {
      const lfo = osc(v, 'sine', 5.3, t, tStop), depth = node(v, gainNode(ctx, 0));
      depth.gain.setValueAtTime(0, t); depth.gain.setValueAtTime(0, t + 0.2); depth.gain.linearRampToValueAtTime(9, t + 0.5);
      lfo.connect(depth); depth.connect(o.detune);
    }
    const env = node(v, gainNode(ctx, 0)), peak = level * vel;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.008);
    env.gain.setTargetAtTime(peak * 0.7, t + 0.008, 0.2);
    env.gain.setTargetAtTime(0, tEnd, 0.035);
    o.connect(lp); lp.connect(env); env.connect(v.out);
  }
  // Baixo redondo: senoide + um pouco de triângulo + a oitava baixinha (para aparecer em alto-falante pequeno).
  function bassTone(v, t, midi, dur, vel) {
    const ctx = v.ctx, f = hz(midi), tEnd = t + Math.max(0.05, dur), tStop = tEnd + 0.35;
    const env = node(v, gainNode(ctx, 0)), peak = BASS_LEVEL * vel;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.012);
    env.gain.setTargetAtTime(peak * 0.72, t + 0.012, 0.3);
    env.gain.setTargetAtTime(0, tEnd, 0.04);
    osc(v, 'sine', f, t, tStop).connect(env);
    const tri = osc(v, 'triangle', f, t, tStop), tg = node(v, gainNode(ctx, 0.28)); tri.connect(tg); tg.connect(env);
    const oct = osc(v, 'sine', f * 2, t, tStop), og = node(v, gainNode(ctx, 0.45)); oct.connect(og); og.connect(env);
    env.connect(v.out);
  }
  // Bumbo macio: senoide que despenca de 120 a 46 Hz, um "toc" curto em 150 Hz (para aparecer em
  // alto-falante de notebook) e um toquinho de ruído abafado.
  function kickTone(v, s, t, vel) {
    thump(v, t, 120, 46, 0.13, KICK_LEVEL * vel, 0.11);
    thump(v, t, 170, 140, 0.03, KICK_LEVEL * 0.3 * vel, 0.03);
    burst(v, t, 'lowpass', 1400, 0.7, KICK_LEVEL * 0.09 * vel, 0.004, s * 3 + 1);
  }
  // Aro: o "toc" de madeira (duas ressonâncias curtas) + ruído agudo + um rabinho de caixa bem baixo.
  function rimTone(v, s, t, vel) {
    const k = RIM_LEVEL * vel;
    thump(v, t, 1750, 1650, 0.01, 0.07 * k, 0.009);
    thump(v, t, 520, 480, 0.02, 0.05 * k, 0.018);
    burst(v, t, 'bandpass', 3000, 0.9, 0.09 * k, 0.012, s * 5 + 2);
    burst(v, t, 'lowpass', 3800, 0.5, 0.025 * k, 0.05, s * 7 + 3);
  }
  // Chimbal: ruído passa-alta. Aberto, ele demora mais a sumir.
  function hatTone(v, s, t, vel, open) {
    burst(v, t, 'highpass', 5500, 0.7, HAT_LEVEL * vel, open ? 0.085 : 0.018, s * 11 + 4);
  }

  /* ------------------------------------------------------------------ */
  /* O sequenciador: o que toca em cada semicolcheia                     */
  /* ------------------------------------------------------------------ */

  function mv(E, dest) { return voice(E, dest, E.musicVoices); }

  function playStep(E, s, t) {
    const ls = s % LOOP_STEPS, arr = arrangement(Math.floor(s / LOOP_STEPS));
    const bar = ls >> 4, pos = ls & 15, B = BARS[bar];
    drums(E, s, t, bar, pos, arr);
    if (!(arr === 0 && bar < 2)) bass(E, s, t, bar, pos, arr, B);
    piano(E, s, t, bar, pos, arr, B);
    lead(E, s, t, bar, pos, arr);
    if (arr === 3 && pos === 0 && bar === 8) E.tone.frequency.setTargetAtTime(2600, t, 0.9);
    if (arr === 3 && pos === 0 && bar === 10) E.tone.frequency.setTargetAtTime(TONE_HZ, t, 1.4);
  }

  function drums(E, s, t, bar, pos, arr) {
    const r = function (k) { return hash(s * 53 + k); };
    const jit = function (k) { return (r(k) - 0.5) * 0.006; };   // ±3 ms: mão humana, não metrônomo
    if (arr === 0 && bar < 2) {       // introdução: só piano; no fim do 2º compasso o chimbal anuncia a entrada
      if (bar === 1 && pos >= 12 && pos % 2 === 0) hatTone(mv(E, E.hatIn), s, t, 0.3 + 0.1 * (pos - 12), false);
      return;
    }
    const brk = arr === 2 && bar >= 8 && bar < 12;
    const fill = bar === 7 || bar === 15;
    if (pos === 0 || (!brk && (pos === 10 || (fill && pos === 7) || (arr === 3 && bar % 2 === 1 && pos === 3)))) {
      kickTone(mv(E, E.kickIn), s, t, pos === 0 ? 1 : 0.8 + 0.1 * r(1));
    }
    if (!brk && (pos === 4 || pos === 12)) rimTone(mv(E, E.rimIn), s, t + jit(2), 0.9 + 0.1 * r(3));
    if (!brk && fill && pos === 15) rimTone(mv(E, E.rimIn), s, t + jit(4), 0.35);
    if (pos % 2 === 0) {
      const vel = (pos % 4 === 0 ? 0.75 : 0.5) * (0.85 + 0.3 * r(6)) * (brk ? 0.55 : 1);
      hatTone(mv(E, E.hatIn), s, t + jit(5), vel, fill && pos === 14 && !brk);
    } else if (!brk && (arr === 1 || arr === 3) && (pos === 7 || pos === 15)) {
      hatTone(mv(E, E.hatIn), s, t + jit(7), 0.22, false);
    }
  }

  function bass(E, s, t, bar, pos, arr, B) {
    const pat = arr === 2 && bar >= 8 && bar < 12 ? BASS_LONG : BASS;
    for (let i = 0; i < pat.length; i++) {
      const p = pat[i];
      if (p[0] !== pos) continue;
      const root = B.b;
      let m = root;
      if (p[2] === 'q') m = root + 7 > 47 ? root - 5 : root + 7;
      else if (p[2] === 'a') {      // meio tom antes da próxima fundamental, vindo do lado de onde o baixo está
        const nb = BARS[(bar + 1) % LOOP_BARS].b;
        if (nb === root) continue;
        m = nb + (nb > root ? -1 : 1);
      }
      bassTone(mv(E, E.bassIn), t, m, p[1] * STEP - 0.03, p[3] * (0.92 + 0.12 * hash(s * 17 + 5)));
    }
  }

  function epChord(E, s, t, notes, lenSteps, vel) {
    const dur = lenSteps * STEP - 0.02;
    for (let i = 0; i < notes.length; i++) {
      const j = hash(s * 31 + i * 7 + 3), dt = i * 0.012 + j * 0.006;   // dedilhado leve, de baixo para cima
      epTone(mv(E, E.epIn), t + dt - WOW_DELAY, notes[i], dur - dt, vel * (0.82 + 0.06 * i) * (0.93 + 0.1 * j), EP_LEVEL);
    }
  }

  function piano(E, s, t, bar, pos, arr, B) {
    if (arr === 2 && bar >= 8 && bar < 12) {     // a quebra: o piano dedilha o acorde em colcheias
      if (pos === 0) epChord(E, s, t, B.c, 15, 0.32);
      if (pos % 2 === 0) {
        const n = B.c[ARP[pos >> 1]] + (pos === 6 ? 12 : 0);
        epTone(mv(E, E.epIn), t - WOW_DELAY, n, 5 * STEP, 0.5 + 0.12 * hash(s * 7 + 1), EP_LEVEL);
      }
      return;
    }
    const pat = B.c2 ? COMP.split : (arr !== 0 && bar % 2 === 1 ? COMP.b : COMP.a);
    for (let i = 0; i < pat.length; i++) {
      const p = pat[i];
      if (p[0] === pos) epChord(E, s, t, p[0] >= 8 && B.c2 ? B.c2 : B.c, p[1], p[2] * (arr === 0 && bar < 2 ? 0.85 : 1));
    }
  }

  function lead(E, s, t, bar, pos, arr) {
    const start = bar - (bar % 4), name = PLAN[arr][start];
    if (!name) return;
    const notes = MEL[name][bar - start];
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (n[0] === pos) leadTone(mv(E, E.leadIn), t - WOW_DELAY, n[1], n[2] * STEP * 0.92, 0.85 + 0.15 * hash(s * 11 + 2), LEAD_LEVEL);
    }
  }

  // Vinil: chiado contínuo + estalinhos esparsos, em laço (o buffer começa e termina em silêncio).
  function vinyl(E, t) {
    const ctx = E.ctx, v = mv(E, E.vinylIn), far = t + 36000;
    const hiss = ctx.createBufferSource(); hiss.buffer = E.noise; hiss.loop = true;
    const hf = node(v, bq(ctx, 'bandpass', 3800, 0.4)), hg = node(v, gainNode(ctx, 0.011));
    hiss.connect(hf); hf.connect(hg); hg.connect(v.out);
    src(v, hiss, t, far, 0);
    const cr = ctx.createBufferSource(); cr.buffer = E.crackle; cr.loop = true;
    const cf = node(v, bq(ctx, 'highpass', 800, 0.6)), cl = node(v, bq(ctx, 'lowpass', 6500, 0.6)), cg = node(v, gainNode(ctx, 0.08));
    cr.connect(cf); cf.connect(cl); cl.connect(cg); cg.connect(v.out);
    src(v, cr, t, far, 0);
  }

  /* ------------------------------------------------------------------ */
  /* Efeitos                                                             */
  /* ------------------------------------------------------------------ */

  function chip(v, t, midi, dur, level, vibrato) { leadTone(v, t, midi, dur, 1, level, !!vibrato); }

  const SFX = {
    // Botão: estalo + baque + o "tec" de volta; depois o CRT esquentando (zumbido de 60 Hz que cresce e
    // some, estática da tela carregando e o agudo do flyback bem baixinho).
    power: function (E, v, t) {
      const ctx = v.ctx;
      burst(v, t, 'bandpass', 2300, 1.1, 0.4, 0.004, 11);
      thump(v, t, 100, 42, 0.11, 0.5, 0.07);
      burst(v, t + 0.05, 'bandpass', 3400, 1.4, 0.18, 0.003, 12);
      const lp = node(v, bq(ctx, 'lowpass', 520, 0.9)), he = node(v, gainNode(ctx, 0)), h2 = node(v, gainNode(ctx, 0.4));
      lp.frequency.setValueAtTime(520, t + 0.06); lp.frequency.setTargetAtTime(170, t + 0.2, 0.5);
      he.gain.setValueAtTime(0, t + 0.06); he.gain.linearRampToValueAtTime(0.3, t + 0.16); he.gain.setTargetAtTime(0, t + 0.3, 0.38);
      osc(v, 'sawtooth', 60, t + 0.06, t + 3.4).connect(lp);
      osc(v, 'sine', 120, t + 0.06, t + 3.4).connect(h2); h2.connect(lp);
      lp.connect(he); he.connect(v.out);
      burst(v, t + 0.12, 'highpass', 3500, 0.7, 0.05, 0.14, 13);
      const wh = osc(v, 'sine', 9000, t + 0.1, t + 3.2), we = node(v, gainNode(ctx, 0));
      wh.frequency.setValueAtTime(9000, t + 0.1); wh.frequency.exponentialRampToValueAtTime(15600, t + 0.5);
      we.gain.setValueAtTime(0, t + 0.1); we.gain.linearRampToValueAtTime(0.01, t + 0.4); we.gain.setTargetAtTime(0, t + 0.6, 0.3);
      wh.connect(we); we.connect(v.out);
    },
    // O bipe do POST: onda quadrada de 1 kHz, como o alto-falante interno do PC.
    beep: function (E, v, t) {
      const lp = node(v, bq(v.ctx, 'lowpass', 3800, 0.7)); lp.connect(v.out);
      held(v, 'square', 1000, t, 0.16, 0.08, 0.003, 0.008, lp);
    },
    // Tecla mecânica: o "clac" do topo, o "toc" do fundo e a volta. Cada chamada muda um pouco.
    key: function (E, v, t, k) {
      const a = hash(k * 3 + 1), b = hash(k * 5 + 2), c = hash(k * 7 + 3), lvl = 0.8 + 0.4 * a;
      burst(v, t, 'bandpass', 2600 + 1800 * b, 1.3, 0.16 * lvl, 0.006, k * 13 + 1);
      thump(v, t, 230 * (0.9 + 0.2 * c), 150, 0.03, 0.12 * lvl, 0.012);
      burst(v, t + 0.008 + 0.008 * c, 'highpass', 1800, 0.7, 0.07 * lvl, 0.004, k * 17 + 2);
    },
    // O desktop aparece: Cmaj9 dedilhado no piano elétrico e duas notinhas de chip lá em cima.
    boot: function (E, v, t) {
      const notes = [48, 55, 59, 62, 64];
      for (let i = 0; i < notes.length; i++) epTone(v, t + i * 0.05, notes[i], 1.15 - i * 0.05, 0.9, 0.05);
      chip(v, t + 0.3, 79, 0.1, 0.045);
      chip(v, t + 0.42, 84, 0.3, 0.04, true);
    },
    // Desligar o CRT: o "pop", o chiado que despenca de 5 kHz a 250 Hz e o resto do zumbido morrendo.
    off: function (E, v, t) {
      const ctx = v.ctx;
      thump(v, t, 85, 36, 0.07, 0.45, 0.05);
      burst(v, t, 'bandpass', 1800, 1, 0.25, 0.004, 21);
      const fl = burst(v, t + 0.01, 'bandpass', 5000, 0.9, 0.12, 0.2, 22);
      fl.frequency.setValueAtTime(5000, t + 0.01); fl.frequency.exponentialRampToValueAtTime(250, t + 0.75);
      const wh = osc(v, 'sine', 12000, t, t + 0.7), we = node(v, gainNode(ctx, 0));
      wh.frequency.setValueAtTime(12000, t); wh.frequency.exponentialRampToValueAtTime(2500, t + 0.3);
      pluck(we.gain, t, 0.018, 0.003, 0.07); wh.connect(we); we.connect(v.out);
      const hl = node(v, bq(ctx, 'lowpass', 300, 0.7)), he = node(v, gainNode(ctx, 0));
      pluck(he.gain, t, 0.12, 0.005, 0.09);
      osc(v, 'sawtooth', 60, t, t + 0.9).connect(hl); hl.connect(he); he.connect(v.out);
    },
    // Clique de interface: um tique de triângulo que cai de afinação e um fiapo de ruído.
    click: function (E, v, t, k) {
      thump(v, t, 2200, 1300, 0.012, 0.11, 0.008, 'triangle');
      burst(v, t, 'bandpass', 4200, 1.2, 0.07, 0.0025, k * 19 + 3);
    },
    // Erro: dois bipes graves descendo (Mi → Dó), cada um com duas quadradas quase iguais ("não-não").
    error: function (E, v, t) {
      const lp = node(v, bq(v.ctx, 'lowpass', 2000, 0.8)); lp.connect(v.out);
      const parts = [[0, 0.11, 330], [0.14, 0.22, 262]];
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        held(v, 'square', p[2], t + p[0], p[1], 0.05, 0.004, 0.012, lp);
        held(v, 'square', p[2] * 1.006, t + p[0], p[1], 0.035, 0.004, 0.012, lp);
      }
    },
    // Recorde no jogo: arpejo de chip subindo em Dó, um acorde que fica com vibrato e um brilhinho.
    win: function (E, v, t) {
      const ctx = v.ctx, run = [[0, 72], [0.075, 76], [0.15, 79]];
      for (let i = 0; i < run.length; i++) chip(v, t + run[i][0], run[i][1], 0.07, 0.07);
      chip(v, t + 0.24, 84, 0.55, 0.07, true);
      chip(v, t + 0.24, 79, 0.55, 0.035);
      held(v, 'triangle', hz(48), t, 0.2, 0.12, 0.004, 0.03);
      held(v, 'triangle', hz(55), t + 0.24, 0.5, 0.12, 0.004, 0.06);
      const sp = [[0.34, 100], [0.42, 103]];
      for (let i = 0; i < sp.length; i++) {
        const e = node(v, gainNode(ctx, 0));
        pluck(e.gain, t + sp[i][0], 0.02, 0.002, 0.06);
        osc(v, 'sine', hz(sp[i][1]), t + sp[i][0], t + sp[i][0] + 0.6).connect(e); e.connect(v.out);
      }
    }
  };

  /* ------------------------------------------------------------------ */
  /* O motor: o grafo inteiro num contexto (ao vivo ou offline)          */
  /* ------------------------------------------------------------------ */

  function pulseWave(ctx, duty) {
    const N = 40, re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) {
      re[n] = Math.sin(2 * Math.PI * n * duty) / (n * Math.PI);
      im[n] = 2 * Math.pow(Math.sin(Math.PI * n * duty), 2) / (n * Math.PI);
    }
    return ctx.createPeriodicWave(re, im);
  }
  function noiseBuffer(ctx, seconds, seed) {
    const n = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0), r = rng(seed);
    for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
    return b;
  }
  // Estalinhos de vinil: impulsos curtos e esparsos, longe das pontas (o laço emenda em silêncio).
  function crackleBuffer(ctx, seconds, seed) {
    const sr = ctx.sampleRate, n = Math.floor(sr * seconds), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0), r = rng(seed);
    const count = Math.floor(seconds * 7);
    for (let k = 0; k < count; k++) {
      const at = Math.floor((0.02 + 0.94 * r()) * n), big = r() < 0.12;
      const amp = (big ? 1 : 0.2 + 0.35 * r()) * (r() < 0.5 ? -1 : 1), len = 2 + Math.floor(r() * (big ? 14 : 6));
      for (let i = 0; i < len * 5 && at + i < n; i++) d[at + i] += amp * Math.exp(-i / len) * (i === 0 ? 1 : r() * 1.2 - 0.3);
    }
    return b;
  }

  function buildEngine(ctx) {
    const E = { ctx: ctx, musicVoices: new Set(), sfxVoices: new Set(), M: { running: false, step: 0, t0: 0 } };
    const g = function (v) { return gainNode(ctx, v); };

    // Saída: mistura → volume → limitador (só age acima de −6 dBFS: soma rara de efeito com pico da
    // música) → desfaz o ganho de compensação que o DynamicsCompressor sempre aplica → liga/desliga.
    // Um compressor que trabalha o tempo todo "incha" notas sustentadas (o bipe crescia 4 dB): aqui não.
    E.out = g(0);
    const mix = g(1), pre = g(OUT_TRIM), comp = ctx.createDynamicsCompressor(), post = g(LIMITER_MAKEUP_UNDO);
    comp.threshold.value = -6; comp.knee.value = 4; comp.ratio.value = 12; comp.attack.value = 0.003; comp.release.value = 0.15;
    mix.connect(pre); pre.connect(comp); comp.connect(post); post.connect(E.out);
    E.mix = mix; E.outTrim = OUT_TRIM;

    // Música: tudo soma em musicBus → corta subgrave → teto quente → fade da música.
    E.musicGain = g(0); E.musicGain.connect(mix);
    E.tone = bq(ctx, 'lowpass', TONE_HZ, 0.5); E.tone.connect(E.musicGain);
    const hp = bq(ctx, 'highpass', 32, 0.7); hp.connect(E.tone);
    E.musicBus = g(1); E.musicBus.connect(hp);

    // Wow de fita: duas linhas de atraso moduladas — juntas (a fita) e em fases opostas (o coro estéreo).
    const wowIn = g(1), dl = ctx.createDelay(0.05), dr = ctx.createDelay(0.05), merge = ctx.createChannelMerger(2);
    dl.delayTime.value = WOW_DELAY; dr.delayTime.value = WOW_DELAY;
    wowIn.connect(dl); wowIn.connect(dr); dl.connect(merge, 0, 0); dr.connect(merge, 0, 1); merge.connect(E.musicBus);
    const wow = ctx.createOscillator(), wowL = g(0.0012), wowR = g(0.0012);
    wow.frequency.value = 0.31; wow.connect(wowL); wow.connect(wowR); wowL.connect(dl.delayTime); wowR.connect(dr.delayTime);
    const cho = ctx.createOscillator(), choL = g(0.0004), choR = g(-0.0004);
    cho.frequency.value = 0.9; cho.connect(choL); cho.connect(choR); choL.connect(dl.delayTime); choR.connect(dr.delayTime);

    // Eco de colcheia pontuada, filtrado para não embolar (piano e lead mandam um pouco).
    const echoIn = g(1), dly = ctx.createDelay(2), fb = g(0.3), eLP = bq(ctx, 'lowpass', 2300, 0.5), eHP = bq(ctx, 'highpass', 280, 0.5), eOut = g(0.5), ePan = panner(ctx, -0.3);
    dly.delayTime.value = BEAT * 0.75;
    echoIn.connect(dly); dly.connect(eLP); eLP.connect(eHP); eHP.connect(fb); fb.connect(dly); eHP.connect(eOut); eOut.connect(ePan); ePan.connect(E.musicBus);

    // Piano: tremolo leve → filtro → wow (+ eco)
    E.epIn = g(1);
    const trem = g(0.88), tremLfo = ctx.createOscillator(), tremDepth = g(0.12), epLP = bq(ctx, 'lowpass', 4200, 0.6), epSend = g(0.18);
    tremLfo.frequency.value = 4.4; tremLfo.connect(tremDepth); tremDepth.connect(trem.gain);
    E.epIn.connect(trem); trem.connect(epLP); epLP.connect(wowIn); epLP.connect(epSend); epSend.connect(echoIn);
    // Lead → wow (+ mais eco)
    E.leadIn = g(1);
    const leadSend = g(0.4);
    E.leadIn.connect(wowIn); E.leadIn.connect(leadSend); leadSend.connect(echoIn);
    // Baixo, bateria e vinil
    E.bassIn = g(1);
    const bLP = bq(ctx, 'lowpass', 900, 0.6); E.bassIn.connect(bLP); bLP.connect(E.musicBus);
    E.drumIn = g(1); E.drumIn.connect(E.musicBus);
    E.kickIn = g(1); E.kickIn.connect(E.drumIn);
    E.hatIn = panner(ctx, 0.22); E.hatIn.connect(E.drumIn);
    E.rimIn = panner(ctx, -0.12); E.rimIn.connect(E.drumIn);
    E.vinylIn = g(1); E.vinylIn.connect(E.musicBus);

    // Efeitos: barramento próprio (fora do fade da música) e um eco curto só deles.
    E.sfxIn = g(1); E.sfxIn.connect(mix);
    E.sfxEcho = g(1);
    const sd = ctx.createDelay(1), sfb = g(0.22), sLP = bq(ctx, 'lowpass', 3000, 0.5), sOut = g(0.3);
    sd.delayTime.value = 0.13;
    E.sfxEcho.connect(sd); sd.connect(sLP); sLP.connect(sfb); sfb.connect(sd); sLP.connect(sOut); sOut.connect(mix);

    // Formas de onda e ruídos, gerados uma vez com semente fixa.
    E.pulse = pulseWave(ctx, 0.25);
    E.noise = noiseBuffer(ctx, 2, 1234);
    E.crackle = crackleBuffer(ctx, 4.3, 99);

    E.lfos = [wow, cho, tremLfo];
    const t = ctx.currentTime;
    E.lfos.forEach(function (o) { o.start(t); });

    // Começa a trilha em t, a partir da semicolcheia startStep, com fade de entrada.
    E.musicStart = function (t0, startStep, fade) {
      const M = E.M;
      M.running = true; M.step = startStep | 0; M.t0 = t0 + 0.05 - stepOffset(M.step);
      E.tone.frequency.cancelScheduledValues(t0); E.tone.frequency.setValueAtTime(TONE_HZ, t0);
      const mg = E.musicGain.gain;
      mg.cancelScheduledValues(t0); mg.setValueAtTime(0, t0); mg.linearRampToValueAtTime(1, t0 + Math.max(0.01, fade || 0));
      vinyl(E, t0);
    };
    // Agenda tudo o que começa antes de tEnd. Se o relógio passou da grade (timer congelado em segundo
    // plano sem setPaused), a grade é empurrada para frente: nada de despejar as notas perdidas de uma vez.
    E.musicSchedule = function (tEnd, now) {
      const M = E.M;
      if (!M.running) return;
      let t = M.t0 + stepOffset(M.step);
      if (now != null && t < now + 0.03) { M.t0 += now + 0.05 - t; t = now + 0.05; }
      while (t < tEnd) { playStep(E, M.step, t); M.step++; t = M.t0 + stepOffset(M.step); }
    };
    E.musicStop = function (t0) {
      E.M.running = false;
      E.musicVoices.forEach(function (v) { kill(v, t0); });
      const mg = E.musicGain.gain, cur = mg.value;
      mg.cancelScheduledValues(t0); mg.setValueAtTime(cur, t0); mg.linearRampToValueAtTime(0, t0 + 0.03);
    };
    E.sfx = function (name, t0, k) {
      const fn = SFX[name];
      if (!fn) return null;
      const v = voice(E, E.sfxIn, E.sfxVoices, name, SFX_LEVEL[name] || 1, SFX_ECHO[name] || 0);
      fn(E, v, t0, k | 0);
      if (!v.srcs) free(v);
      return v;
    };
    E.dispose = function () {
      E.M.running = false;
      E.lfos.forEach(function (o) { try { o.stop(); } catch (e) { /* já parado */ } });
      E.musicVoices.forEach(free); E.sfxVoices.forEach(free);
      try { E.out.disconnect(); } catch (e) { /* já solto */ }
    };
    return E;
  }

  /* ------------------------------------------------------------------ */
  /* A API ao vivo                                                       */
  /* ------------------------------------------------------------------ */

  function readOn(key) {
    try { return global.localStorage.getItem(key) !== '0'; } catch (e) { return true; }
  }
  function saveOn(key, on) {
    try { global.localStorage.setItem(key, on ? '1' : '0'); } catch (e) { /* sem storage: vale só nesta visita */ }
  }
  // Rampa a partir do valor atual (sem degrau, mesmo no meio de outra rampa).
  function rampTo(p, target, t, dur) {
    const cur = p.value;
    p.cancelScheduledValues(t); p.setValueAtTime(cur, t); p.linearRampToValueAtTime(target, t + dur);
  }

  function create(opts) {
    opts = opts || {};
    const key = opts.storageKey || 'andreyos.som';
    const doc = global.document;
    let on = readOn(key);
    let ctx = null, E = null, unlocked = false, disposed = false;
    let wantMusic = false, musicOn = false, stopping = false;
    let tick = 0, killTimer = 0, offTimer = 0, pausedFlag = false;
    let rev = 0, chain = Promise.resolve(), sfxCount = 0;

    const paused = function () { return pausedFlag || !!(doc && doc.hidden); };
    const live = function () { return !!E && unlocked && on && !paused() && !disposed; };
    const warn = function (e) { if (global.console) console.warn('AndreyAudio: não deu para atualizar o áudio.', e); };

    function startTick() {
      if (tick || !musicOn) return;
      tick = global.setInterval(step, TICK_MS);
      step();
    }
    function stopTick() { if (tick) { global.clearInterval(tick); tick = 0; } }
    // Agenda o que vem pela frente. Continua andando durante o fade de desligar/pausar (até o contexto
    // suspender), para a grade não abrir buraco; com o contexto parado, não faz nada.
    function step() {
      if (!E || disposed || !musicOn || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      E.musicSchedule(now + LOOKAHEAD, now);
    }

    function killMusic() {
      if (killTimer) { global.clearTimeout(killTimer); killTimer = 0; }
      stopTick(); stopping = false;
      if (musicOn) { musicOn = false; E.musicStop(ctx.currentTime); }
    }
    // Faz a música bater com o que foi pedido. Só roda com o contexto andando.
    function syncMusic() {
      if (!live()) return;
      const now = ctx.currentTime;
      if (wantMusic) {
        if (!musicOn) { E.musicStart(now + 0.02, 0, FADE_MUSIC_IN); musicOn = true; stopping = false; }
        else if (stopping) {            // pediram de novo no meio do fade de saída: só volta o volume
          stopping = false;
          if (killTimer) { global.clearTimeout(killTimer); killTimer = 0; }
          rampTo(E.musicGain.gain, 1, now, FADE_MUSIC_OUT);
        }
        startTick();
      } else if (musicOn && !stopping) {
        stopping = true;                // o agendador segue durante o fade, para não abrir buraco
        rampTo(E.musicGain.gain, 0, now, FADE_MUSIC_OUT);
        killTimer = global.setTimeout(function () { killTimer = 0; if (stopping) killMusic(); }, FADE_MUSIC_OUT * 1000 + 70);
      }
    }

    // Reconcilia contexto, volume geral e agendador com o estado (ligado, pausado, liberado).
    // As transições são enfileiradas: um suspend atrasado nunca vence o último resume.
    function reconcile() {
      if (!E || disposed) return chain;
      const r = ++rev, now = ctx.currentTime;
      if (offTimer) { global.clearTimeout(offTimer); offTimer = 0; }
      if (live()) {
        rampTo(E.out.gain, 1, now, FADE_ONOFF);
        chain = chain.catch(noop).then(function () {
          if (r !== rev || ctx.state === 'running' || ctx.state === 'closed') return;
          return ctx.resume();
        }).then(function () { if (r === rev) syncMusic(); }).catch(warn);
      } else {
        const fade = on ? 0.05 : FADE_ONOFF;     // aba oculta: corte rápido; desligar: fade de 300 ms
        rampTo(E.out.gain, 0, now, fade);
        if (!wantMusic && musicOn) killMusic();
        offTimer = global.setTimeout(function () {
          offTimer = 0;
          if (r !== rev) return;
          stopTick();
          chain = chain.catch(noop).then(function () {
            if (r !== rev || ctx.state !== 'running') return;
            return ctx.suspend();
          }).catch(warn);
        }, fade * 1000 + 60);
      }
      return chain;
    }

    function onVisibility() { if (E) reconcile(); }
    if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', onVisibility);

    function unlock() {
      if (disposed || !AC) return;
      if (!ctx) {
        try { ctx = opts.contextOptions ? new AC(opts.contextOptions) : new AC(); } catch (e) { ctx = null; warn(e); return; }
        E = buildEngine(ctx);
        E.out.connect(ctx.destination);
        // iOS antigo só libera o áudio depois de tocar algo dentro do gesto: um buffer mudo de 1 amostra.
        try {
          const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource();
          s.buffer = b; s.connect(ctx.destination); s.start(0);
        } catch (e) { /* sem problema */ }
      }
      unlocked = true;
      // O resume precisa ser pedido aqui, ainda dentro do gesto (Safari).
      if (live() && ctx.state !== 'running' && ctx.state !== 'closed') {
        try { const p = ctx.resume(); if (p && p.catch) p.catch(noop); } catch (e) { /* tenta de novo no reconcile */ }
      }
      reconcile();
    }

    function setOn(value) {
      if (disposed) return on;
      on = !!value;
      saveOn(key, on);
      reconcile();
      return on;
    }

    function music(play) {
      if (disposed) return;
      wantMusic = !!play;
      if (!E) return;
      if (live()) syncMusic();
      else if (!wantMusic && musicOn) killMusic();   // parada com o som suspenso: não há fade a esperar
    }

    // Abre espaço para um efeito novo: no máximo N do mesmo nome e 8 no total (a mais velha sai com fade).
    // Devolve false se o mesmo efeito acabou de começar (chamada repetida no mesmo instante).
    function limit(name, now) {
      const same = [], all = [], gap = SFX_MIN_GAP[name] || SFX_MIN_GAP_DEFAULT;
      let recent = false;
      E.sfxVoices.forEach(function (v) {
        if (v.dying || v.dead) return;
        all.push(v);
        if (v.name === name) { same.push(v); if (now - v.t0 < gap) recent = true; }
      });
      if (recent) return false;
      const cap = SFX_CAP[name] || SFX_CAP_DEFAULT;
      while (same.length >= cap) { const old = same.shift(); kill(old, now); all.splice(all.indexOf(old), 1); }
      while (all.length >= SFX_CAP_TOTAL) kill(all.shift(), now);
      return true;
    }
    function sfx(name) {
      if (!E || disposed || !on || paused() || !SFX[name]) return;
      const fire = function () {
        const now = ctx.currentTime;
        if (limit(name, now)) E.sfx(name, now + 0.005, ++sfxCount);
      };
      if (ctx.state === 'running') { fire(); return; }
      // Logo depois do unlock o contexto ainda está retomando: toca quando ele andar, se ainda fizer sentido.
      const r = rev, asked = Date.now();
      chain.then(function () { if (r === rev && live() && ctx.state === 'running' && Date.now() - asked < 600) fire(); });
    }

    function setPaused(p) {
      if (disposed) return;
      pausedFlag = !!p;
      reconcile();
    }

    function dispose() {
      if (disposed) return;
      disposed = true; rev++;
      stopTick();
      if (killTimer) global.clearTimeout(killTimer);
      if (offTimer) global.clearTimeout(offTimer);
      if (doc && doc.removeEventListener) doc.removeEventListener('visibilitychange', onVisibility);
      if (E) E.dispose();
      musicOn = false; stopping = false;
      if (ctx && ctx.close) { try { const p = ctx.close(); if (p && p.catch) p.catch(noop); } catch (e) { /* já fechado */ } }
      ctx = null; E = null;
    }

    return {
      unlock: unlock,
      setOn: setOn,
      isOn: function () { return on; },
      toggle: function () { return setOn(!on); },
      music: music,
      sfx: sfx,
      setPaused: setPaused,
      dispose: dispose,
      _debug: function () {
        return {
          ctx: ctx ? ctx.state : null, time: ctx ? ctx.currentTime : 0, on: on, unlocked: unlocked, paused: paused(), disposed: disposed,
          wantMusic: wantMusic, musicOn: musicOn, stopping: stopping, ticking: !!tick,
          step: E ? E.M.step : 0, t0: E ? E.M.t0 : 0, musicVoices: E ? E.musicVoices.size : 0, sfxVoices: E ? E.sfxVoices.size : 0,
          sfxAlive: E ? Array.from(E.sfxVoices).filter(function (v) { return !v.dying; }).length : 0,
          master: E ? E.out.gain.value : 0, musicGain: E ? E.musicGain.gain.value : 0
        };
      }
    };
  }

  global.AndreyAudio = {
    create: create,
    BPM: BPM,
    LOOP_SECONDS: LOOP_SECONDS,
    SFX: Object.keys(SFX),
    // Só para o harness de dev/: o mesmo grafo num contexto qualquer (ex.: OfflineAudioContext).
    _engine: buildEngine,
    _stepOffset: stepOffset
  };
})(window);
