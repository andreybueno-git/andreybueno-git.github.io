/* O monitor grafite gerado no Higgsfield (Tripo H3.1, 116 mil triângulos), preparado no Blender.
 * Medidas tiradas por raios contra o modelo (dev/otimizar-grafite.py e dev/medir-botao-grafite.py;
 * números em assets/pc-grafite.json), em coordenadas do próprio modelo: X para a direita, Y para cima,
 * Z para a frente, base em Y=0. O PC bege antigo ficou em assets/src/ como referência.
 *
 *   AndreyPC.load(THREE, url) -> Promise<{
 *     group,        // o monitor inteiro (escala 1 = 0,93 de largura)
 *     screen,       // mesh curvo que acompanha o vidro do CRT; recebe a CanvasTexture da tela
 *     corners(),    // 4 cantos da tela em coordenadas de mundo [TL, TR, BR, BL] (THREE.Vector3)
 *     power,        // alvo de clique invisível sobre o botão do gabinete (userData.pick = 'power')
 *     setPower(on)  // acende/apaga os LEDs do gabinete e do monitor
 *   }>
 */
(function (global) {
  'use strict';
  // Retângulo da imagem: o vidro medido inteiro, 1,5% para dentro (sobra só a bordinha preta do CRT).
  // O vidro é mais largo que 4:3 (1,43:1): o desktop 1024×768 estica uns 7% na horizontal para enchê-lo.
  // Em cima a imagem sobe só um pouco além do vidro medido (cobre a faixa clara da borda de dentro da moldura);
  // os cantos de cima ficam bem arredondados no CSS para acompanhar a curva da abertura e não passar da moldura.
  const SCREEN = { cx: 0, cy: 0.5345, halfW: 0.3600, halfH: 0.2569 };
  // Meia largura de referência para a escala do monitor na cena (a do retângulo 4:3 antigo): o monitor
  // continua do mesmo tamanho no quarto.
  const SCALE_HALFW = 0.33014;
  // O vidro medido inteiro (para o reflexo cobrir tudo, e não só o 4:3).
  const GLASS_RECT = { x0: -0.36773, x1: 0.36773, y0: 0.27365, y1: 0.78948 };
  // Superfície do vidro: z(nx, ny) = c + t·ny − kx·nx² − ky·ny², com nx, ny em [−1, 1] do SCREEN.
  // Ajustada a 99 pontos medidos (erro máximo 1,3 mm); os termos foram reescalados do retângulo 4:3 da medição.
  const GLASS = { c: 0.45874, t: -0.00997, kx: 0.02516, ky: 0.01860, offset: 0.004 };
  // Botão de ligar: disco escuro com anel laranja, no canto direito do queixo. LED âmbar à esquerda dele.
  const POWER = { x: 0.373, y: 0.118, z: 0.4967, r: 0.037 };
  const LED_CASE = { x: 0.2777, y: 0.1148, z: 0.4777 };
  const LED_MONITOR = LED_CASE;

  function glassZ(nx, ny) { return GLASS.c + GLASS.t * ny - GLASS.kx * nx * nx - GLASS.ky * ny * ny + GLASS.offset; }

  function buildScreen(T) {
    const geo = new T.PlaneGeometry(SCREEN.halfW * 2, SCREEN.halfH * 2, 24, 18);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const nx = pos.getX(i) / SCREEN.halfW, ny = pos.getY(i) / SCREEN.halfH;
      pos.setZ(i, glassZ(nx, ny));
    }
    geo.translate(SCREEN.cx, SCREEN.cy, 0);
    geo.computeVertexNormals();
    const mat = new T.MeshBasicMaterial({ color: 0x0a0c0e, toneMapped: false });
    const mesh = new T.Mesh(geo, mat);
    mesh.name = 'AndreyPC_Screen';
    mesh.userData.pick = 'screen';
    return mesh;
  }

  function led(T, p, color) {
    const m = new T.Mesh(new T.SphereGeometry(0.0042, 16, 12), new T.MeshStandardMaterial({ color: 0x1b1f1b, emissive: new T.Color(color), emissiveIntensity: 0, roughness: 0.4 }));
    m.position.set(p.x, p.y, p.z);
    return m;
  }

  // Carrega um GLB. A cópia publicada como Artifact troca esta função (lá o .glb vem dentro de um .js).
  function fetchGltf(T, url, onLoad, onError) { new T.GLTFLoader().load(url, onLoad, undefined, onError); }
  // Promessa com o glTF de qualquer GLB do teaser (o PC e os objetos de assets/props/).
  function loadGlb(T, url) {
    return new Promise((resolve, reject) => {
      if (!T.GLTFLoader) { reject(new Error('GLTFLoader ausente')); return; }
      fetchGltf(T, url, resolve, reject);
    });
  }

  function load(T, url) {
    return new Promise((resolve, reject) => {
      if (!T.GLTFLoader) { reject(new Error('GLTFLoader ausente')); return; }
      fetchGltf(T, url, (gltf) => {
        const group = new T.Group(); group.name = 'AndreyPC';
        const model = gltf.scene;
        model.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true; o.receiveShadow = true;
            const m = o.material;
            if (m && m.map) { m.map.encoding = T.sRGBEncoding; m.map.anisotropy = 8; }
            if (m) { m.roughness = Math.max(0.45, m.roughness ?? 0.6); m.envMapIntensity = 0.6; }
          }
        });
        group.add(model);
        const screen = buildScreen(T); group.add(screen);
        const ledCase = led(T, LED_CASE, 0x39ff6a); group.add(ledCase);
        const ledMonitor = led(T, LED_MONITOR, 0xffb000); group.add(ledMonitor);
        const power = new T.Mesh(new T.SphereGeometry(POWER.r, 12, 8), new T.MeshBasicMaterial({ visible: false }));
        power.position.set(POWER.x, POWER.y, POWER.z); power.userData.pick = 'power'; power.name = 'AndreyPC_Power';
        group.add(power);
        const local = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([nx, ny]) => new T.Vector3(SCREEN.cx + nx * SCREEN.halfW, SCREEN.cy + ny * SCREEN.halfH, glassZ(nx, ny)));
        resolve({
          group, screen, power, model,
          corners() { group.updateMatrixWorld(true); return local.map((v) => v.clone().applyMatrix4(group.matrixWorld)); },
          screenCenter() { group.updateMatrixWorld(true); return new T.Vector3(SCREEN.cx, SCREEN.cy, glassZ(0, 0)).applyMatrix4(group.matrixWorld); },
          setPower(on) { ledCase.material.emissiveIntensity = on ? 2.2 : 0; ledMonitor.material.emissiveIntensity = on ? 1.6 : 0.15; },
          size: { width: 0.9276, height: 0.8807, depth: 1.0 }
        });
      }, reject);
    });
  }

  global.AndreyPC = { load, loadGlb, glassZ, SCREEN, SCALE_HALFW, GLASS_RECT, POWER, LED_CASE, LED_MONITOR };
})(window);
