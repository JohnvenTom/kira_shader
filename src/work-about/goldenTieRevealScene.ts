/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { createCxStarArray, type CxStarArray } from './starArray';

/**
 * 碎纸之后的 golden-tie-reveal 页（原站「Still Not Convinced We're Serious About Business?」
 * 段，反编译自 04kr7kd5riobb.js）：
 *  - 远景黑→蓝渐变（mix(black, blue, pow(1-uv.y, 6))），20*vw × 14.4*vh，z=-50
 *  - 3D 文案从 z=-35 推到 z=-10（页面滚动 l = clamp((s - start + 4) / 5.6)）
 *  - cx 星星阵列（starArray.ts 共享工厂：7 颗金色星飞掠，领头星内芯=下一场景星形窗口）
 *    挂载 [-0.025, 1.6, 3.98] × scale 0.2（bundle 39084 实测值）
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
  // cx 星星阵列（starArray.ts 共享工厂：几何/材质/内芯/灯光/运动全部 1:1 共用）
  // ---------------------------------------------------------------------------
  const starArray: CxStarArray = createCxStarArray(renderer, scene);
  const cardsRoot = new THREE.Group();
  cardsRoot.position.set(-0.025, 1.6, 3.98);
  cardsRoot.scale.setScalar(0.2);
  scene.add(cardsRoot);
  cardsRoot.add(starArray.lift);

  // 领头星内芯的下一场景纹理（宿主每帧喂，转给工厂）
  let pendingTex: THREE.Texture | null = null;
  let pendingW = 1;
  let pendingH = 1;

  // ---------------------------------------------------------------------------
  // 更新
  // ---------------------------------------------------------------------------
  const update = (state: GoldenTieRevealState) => {
    lookTarget.set(state.mouseX * 0.25, state.mouseY * 0.25, -20);
    camera.lookAt(lookTarget);

    if (textMesh) {
      textMesh.position.z = Math.min(0, -35 + 25 * state.text);
    }

    starArray.update(state.cards, cssW, pendingTex, pendingW, pendingH);
  };

  const setNextTexture = (tex: THREE.Texture | null, w: number, h: number) => {
    pendingTex = tex;
    pendingW = Math.max(1, w);
    pendingH = Math.max(1, h);
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
    starArray.dispose();
    bgGeo.dispose();
    bgMat.dispose();
    textGeo?.dispose();
    textMat.dispose();
    textTexture?.dispose();
  };

  return { scene, camera, setSize, setNextTexture, update, dispose };
}
