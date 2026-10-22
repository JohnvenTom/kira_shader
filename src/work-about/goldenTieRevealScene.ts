/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

/**
 * 碎纸之后的 golden-tie-reveal 页（反编译自 04kr7kd5riobb.js 的 cw/cx/cv/cb）：
 *  - 远景黑→蓝渐变（mix(black, blue, pow(1-uv.y, 6))），20*vw × 14.4*vh，z=-50
 *  - 3D 文案从 z=-35 推到 z=-10（页面滚动 l = clamp((s - start + 4) / 5.6)）
 *  - 7 张金色星形卡片从镜头前飞掠（z=30cos(aπ+π/2), x=14cos(1.5πa)·o, y=6cos(1.5πa)）
 *  - 第一张卡片中心是「下一场景」的屏幕空间星形窗口，t∈[0.8,0.9] 打开，[0.96,1] 放大到 2 倍
 */

const T = TSL as any;
const DEG = Math.PI / 180;

export interface GoldenTieRevealState {
  /** 文案推近进度 0..1（对应原站 text group 的 l） */
  text: number;
  /** 卡片飞行/揭示进度 0..1（对应原站 n_ 缓动后的 reveal progress） */
  cards: number;
  time: number;
  /** -1..1 */
  mouseX: number;
  mouseY: number;
}

export interface GoldenTieRevealHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  setSize: (w: number, h: number) => void;
  setNextTexture: (tex: THREE.Texture | null, w: number, h: number) => void;
  update: (state: GoldenTieRevealState) => void;
  dispose: () => void;
}

const TEXT_COLOR = 'rgb(255, 240, 235)';

function starShape() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? 2 : 1;
    const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

export function createGoldenTieRevealScene(
  renderer: THREE.WebGPURenderer,
  width: number,
  height: number
): GoldenTieRevealHandle {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, Math.max(1, width) / Math.max(1, height), 0.1, 100);
  camera.position.set(0, 0, 5);

  let vw = 2 * 5 * Math.tan(32.5 * DEG);
  let vh = vw / (Math.max(1, width) / Math.max(1, height));
  let cssW = width;

  const lookTarget = new THREE.Vector3(0, 0, -20);
  camera.lookAt(lookTarget);

  // ---------------------------------------------------------------------------
  // 远景：黑 → 蓝
  // ---------------------------------------------------------------------------
  const bgMat = new THREE.MeshBasicNodeMaterial();
  {
    const uv = T.uv();
    const grad = T.pow(T.float(1).sub(uv.y), T.float(6));
    bgMat.colorNode = T.vec4(T.mix(T.vec3(0, 0, 0), T.vec3(0, 0, 1), grad), 1);
    bgMat.toneMapped = false;
    bgMat.depthWrite = false;
    bgMat.depthTest = false;
  }
  const bgGeo = new THREE.PlaneGeometry(1, 1);
  const bgMesh = new THREE.Mesh(bgGeo, bgMat);
  bgMesh.position.z = -50;
  bgMesh.renderOrder = -10;
  bgMesh.frustumCulled = false;
  scene.add(bgMesh);

  // ---------------------------------------------------------------------------
  // 3D 文案
  // ---------------------------------------------------------------------------
  let textCanvas: HTMLCanvasElement | null = null;
  let textTexture: THREE.CanvasTexture | null = null;
  let textGeo: THREE.PlaneGeometry | null = null;
  let textMesh: THREE.Mesh | null = null;
  const textMat = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });

  const drawText = () => {
    const designW = 1920;
    const designH = Math.round((designW * Math.max(1, height)) / Math.max(1, width));
    const canvasW = Math.min(2048, Math.max(1024, Math.round(designW * 1)));
    const scale = canvasW / designW;
    const canvasH = Math.max(2, Math.round(designH * scale));
    const canvas = textCanvas ?? document.createElement('canvas');
    textCanvas = canvas;
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.save();
    ctx.scale(scale, scale);

    const heading = "Still Not Convinced We're Serious About Business?";
    const subline = "We've got one last trick up our sleeve.";
    const headingSize = 144;
    const headingLine = 156;
    const maxWidth = 1080;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = `500 ${headingSize}px "STIX Two Text", "Times New Roman", serif`;
    const words = heading.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);

    const subSize = 32;
    const subLine = 36;
    const gap = 20;
    const blockH = lines.length * headingLine + gap + subLine;
    const top = (designH - blockH) / 2;
    lines.forEach((l, i) => ctx.fillText(l, designW / 2, top + i * headingLine));
    ctx.font = `400 ${subSize}px "STIX Two Text", "Times New Roman", serif`;
    ctx.fillText(subline, designW / 2, top + lines.length * headingLine + gap);
    ctx.restore();

    if (!textTexture) {
      textTexture = new THREE.CanvasTexture(canvas);
      textTexture.colorSpace = THREE.SRGBColorSpace;
      textTexture.minFilter = THREE.LinearFilter;
      textTexture.magFilter = THREE.LinearFilter;
      textTexture.generateMipmaps = false;
      textMat.map = textTexture;
      textMat.needsUpdate = true;
    } else {
      textTexture.dispose();
      textTexture = new THREE.CanvasTexture(canvas);
      textTexture.colorSpace = THREE.SRGBColorSpace;
      textTexture.minFilter = THREE.LinearFilter;
      textTexture.magFilter = THREE.LinearFilter;
      textTexture.generateMipmaps = false;
      textMat.map = textTexture;
      textMat.needsUpdate = true;
    }
  };

  const buildText = () => {
    drawText();
    textGeo?.dispose();
    // 原站：group scale 3 + 视口尺寸的 UI 层，在 z=-10 时正好铺满屏幕
    textGeo = new THREE.PlaneGeometry(vw * 3, vh * 3);
    if (!textMesh) {
      textMesh = new THREE.Mesh(textGeo, textMat);
      textMesh.position.z = -10;
      textMesh.renderOrder = -1;
      scene.add(textMesh);
    } else {
      textMesh.geometry = textGeo;
    }
  };
  buildText();

  // ---------------------------------------------------------------------------
  // 金色星形卡片
  // ---------------------------------------------------------------------------
  const star = starShape();
  const extrudeGeo = new THREE.ExtrudeGeometry(star, {
    depth: 0.2,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.01,
    bevelThickness: 0.01,
  });
  const flatGeo = new THREE.ShapeGeometry(star);

  const cardsRoot = new THREE.Group();
  cardsRoot.position.set(-0.025, 1.6, 3.98);
  cardsRoot.scale.setScalar(0.2);
  scene.add(cardsRoot);

  const lift = new THREE.Group();
  cardsRoot.add(lift);

  const cardsGroup = new THREE.Group();
  cardsGroup.position.set(0, 0, 4.3);
  lift.add(cardsGroup);

  interface Card {
    group: THREE.Group;
    material: THREE.MeshStandardMaterial;
    inner?: THREE.Mesh;
    innerMaterial?: THREE.MeshBasicNodeMaterial;
    innerOpacity?: any;
  }
  const cards: Card[] = [];
  const goldColor = new THREE.Color('#ffff50');
  const emptyTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  emptyTex.needsUpdate = true;

  for (let i = 0; i < 7; i++) {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: goldColor,
      metalness: 0.5,
      roughness: 0.05,
      transparent: true,
      opacity: 0,
    });
    const mesh = new THREE.Mesh(extrudeGeo, material);
    group.add(mesh);

    let inner: THREE.Mesh | undefined;
    let innerMaterial: THREE.MeshBasicNodeMaterial | undefined;
    let innerOpacity: any;
    if (i === 0) {
      innerMaterial = new THREE.MeshBasicNodeMaterial();
      innerMaterial.transparent = true;
      innerMaterial.depthTest = false;
      innerMaterial.depthWrite = false;
      innerMaterial.toneMapped = false;
      const resolution = T.uniform(new THREE.Vector2(1, 1));
      const nextTexNode = T.texture(emptyTex, T.screenCoordinate.div(resolution));
      innerOpacity = T.uniform(0);
      innerMaterial.colorNode = T.vec4(nextTexNode.rgb, 1);
      innerMaterial.opacityNode = innerOpacity;
      (innerMaterial as any).userData = { nextTexNode, resolution };
      inner = new THREE.Mesh(flatGeo, innerMaterial);
      inner.scale.setScalar(0.85);
      inner.position.z = 0.13;
      inner.renderOrder = 20;
      group.add(inner);
    }

    cardsGroup.add(group);
    cards.push({ group, material, inner, innerMaterial, innerOpacity });
  }

  // ---------------------------------------------------------------------------
  // 灯光 / 环境
  // ---------------------------------------------------------------------------
  let envRT: THREE.RenderTarget | null = null;
  try {
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color('#0a0908');
    const panel = (color: number[], pos: number[], size: [number, number]) => {
      const mat = new THREE.MeshBasicNodeMaterial();
      mat.colorNode = T.vec4(T.vec3(color[0], color[1], color[2]), 1);
      mat.side = THREE.DoubleSide;
      mat.toneMapped = false;
      const geo = new THREE.PlaneGeometry(size[0], size[1]);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.lookAt(0, 0, 0);
      envScene.add(mesh);
    };
    panel([7.5, 6.4, 4.6], [2, 5, 5], [10, 6]);
    panel([4.2, 3.6, 2.4], [-5, 1, 4], [6, 4]);
    panel([2.2, 2.8, 5.2], [5, -1, 3], [5, 5]);
    panel([6.0, 5.4, 4.0], [0, -5, 2], [8, 5]);
    const pmrem = new THREE.PMREMGenerator(renderer);
    envRT = pmrem.fromScene(envScene, 0.04);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 1.25;
  } catch {
    // 环境贴图失败时仅靠灯光
  }

  scene.add(new THREE.AmbientLight(0xfff2e6, 0.6));
  const key = new THREE.PointLight(0xfff1d8, 30, 30, 2);
  key.position.set(2, 3, 6);
  scene.add(key);
  const rim = new THREE.PointLight(0xbcd0ff, 22, 30, 2);
  rim.position.set(-3, 1, 4);
  scene.add(rim);
  const gold = new THREE.PointLight(0xffd27a, 18, 25, 2);
  gold.position.set(0.5, -2, 7);
  scene.add(gold);

  // ---------------------------------------------------------------------------
  // 更新
  // ---------------------------------------------------------------------------
  const liftA = new THREE.Vector3(0, -8, -5);
  const liftB = new THREE.Vector3(0, -8, 0);

  const update = (state: GoldenTieRevealState) => {
    lookTarget.set(state.mouseX * 0.25, state.mouseY * 0.25, -20);
    camera.lookAt(lookTarget);

    if (textMesh) {
      textMesh.position.z = Math.min(0, -35 + 25 * state.text);
    }

    lift.position.lerpVectors(liftA, liftB, state.cards);
    const o = Math.min(Math.max(cssW / 1920, 0.4), 0.75);

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const a = Math.min(1, Math.max(0, state.cards - 0.15 * i));
      const ax = 14 * Math.cos(a * Math.PI * 1.5) * o + 0.2;
      const ay = 6 * Math.cos(a * Math.PI * 1.5);
      const az = 30 * Math.cos(a * Math.PI + Math.PI * 0.5);
      card.group.position.set(ax, ay, az);
      card.group.rotation.set(0, a * Math.PI * 2, a * Math.PI * 2);
      card.material.opacity = Math.min(1, Math.max(0, (a - 0.05) / 0.25));

      if (card.innerMaterial) {
        const scale = 1 + Math.min(1, Math.max(0, (a - 0.96) / 0.04));
        card.group.scale.setScalar(scale);
        const op = Math.min(1, Math.max(0, (a - 0.8) / 0.1));
        if (card.innerOpacity) card.innerOpacity.value = op;
      }
    }
  };

  const setNextTexture = (tex: THREE.Texture | null, w: number, h: number) => {
    const card = cards[0];
    if (!card.innerMaterial || !tex) return;
    const ud = (card.innerMaterial as any).userData as {
      nextTexNode: { value: THREE.Texture };
      resolution: { value: THREE.Vector2 };
    };
    ud.nextTexNode.value = tex;
    ud.resolution.value.set(Math.max(1, w), Math.max(1, h));
  };

  const setSize = (w: number, h: number) => {
    cssW = w;
    camera.aspect = Math.max(1, w) / Math.max(1, h);
    camera.updateProjectionMatrix();
    vh = 2 * 5 * Math.tan(32.5 * DEG);
    vw = vh * (Math.max(1, w) / Math.max(1, h));
    bgMesh.scale.set(vw * 20, vh * 14.4, 1);
    if (textGeo && textMesh) {
      textGeo.dispose();
      textGeo = new THREE.PlaneGeometry(vw * 3, vh * 3);
      textMesh.geometry = textGeo;
    }
    drawText();
  };
  setSize(width, height);

  const dispose = () => {
    extrudeGeo.dispose();
    flatGeo.dispose();
    bgGeo.dispose();
    bgMat.dispose();
    textGeo?.dispose();
    textMat.dispose();
    textTexture?.dispose();
    emptyTex.dispose();
    for (const c of cards) {
      c.material.dispose();
      c.innerMaterial?.dispose();
    }
    scene.environment = null;
    envRT?.dispose();
  };

  return { scene, camera, setSize, setNextTexture, update, dispose };
}
