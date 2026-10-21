import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { AboutPaperResult, disposeAboutPaper } from './paperContent';

const T = TSL as any;

export interface PaperViewState {
  stage: 'paper' | 'ending';
  /** 纸页顶边距视口顶部的 CSS 像素（负值表示已滚出屏幕） */
  paperTop: number;
  /** 碎片进度 0..1 */
  shred: number;
  /** CTA 画布在屏幕顶部对应的设计像素 */
  ctaTop: number;
  time: number;
}

export interface PaperSceneHandle {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  setSize: (w: number, h: number) => void;
  update: (state: PaperViewState) => void;
  dispose: () => void;
}

function makeGradientTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w = 4, h = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function makeCurlTexture() {
  return makeGradientTexture((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const roll = ctx.createLinearGradient(0, 0, 0, h * 0.5);
    roll.addColorStop(0, 'rgba(255,252,238,0.95)');
    roll.addColorStop(0.55, 'rgba(246,238,215,0.9)');
    roll.addColorStop(0.82, 'rgba(212,197,166,0.85)');
    roll.addColorStop(1, 'rgba(120,103,74,0.28)');
    ctx.fillStyle = roll;
    ctx.fillRect(0, 0, w, h * 0.55);
    const shadow = ctx.createLinearGradient(0, h * 0.45, 0, h);
    shadow.addColorStop(0, 'rgba(24,18,8,0.28)');
    shadow.addColorStop(1, 'rgba(24,18,8,0)');
    ctx.fillStyle = shadow;
    ctx.fillRect(0, h * 0.45, w, h * 0.55);
  }, 8, 96);
}

function makeEdgeShadowTexture() {
  return makeGradientTexture((ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(8,6,3,0)');
    g.addColorStop(0.75, 'rgba(8,6,3,0.18)');
    g.addColorStop(1, 'rgba(8,6,3,0.38)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, 4, 128);
}

const sheetMaterials: THREE.Material[] = [];

function createSheetMaterial(texture: THREE.Texture, designW: number, designH: number, timeNode: any) {
  const mat = new THREE.MeshBasicNodeMaterial();
  const uv = T.uv();
  const col = T.texture(texture, uv);
  const noise = T.fract(
    T.sin(T.dot(uv.mul(T.vec2(designW, designH)).add(timeNode.mul(37.0)), T.vec2(12.9898, 78.233))).mul(43758.5453)
  );
  const grain = noise.sub(0.5).mul(0.062);
  const lum = T.dot(col.rgb, T.vec3(0.299, 0.587, 0.114));
  const desat = T.mix(col.rgb, T.vec3(lum, lum, lum), 0.21);
  const warm = desat.mul(T.vec3(1.03, 1.0, 0.93));
  const faded = warm.mul(0.94).add(T.vec3(0.038, 0.033, 0.022));
  const edgeX = T.smoothstep(0.0, 0.028, uv.x).mul(T.smoothstep(0.0, 0.028, T.float(1).sub(uv.x)));
  const shade = T.mix(0.79, 1.0, edgeX);
  mat.colorNode = T.vec4(faded.mul(shade).add(grain), 1.0);
  mat.toneMapped = false;
  mat.depthTest = false;
  mat.depthWrite = false;
  sheetMaterials.push(mat);
  return mat;
}

export function createAboutPaperScene(paper: AboutPaperResult, width: number, height: number): PaperSceneHandle {
  const scene = new THREE.Scene();
  scene.background = null;
  const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 100);
  camera.position.z = 10;

  const timeNode = T.uniform(0);

  const group = new THREE.Group();
  scene.add(group);

  const sheetMeshes: THREE.Mesh[] = [];
  for (const sheet of paper.sheets) {
    const geo = new THREE.PlaneGeometry(sheet.width, sheet.height);
    const mat = createSheetMaterial(sheet.texture, sheet.width, sheet.height, timeNode);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -sheet.y - sheet.height / 2;
    group.add(mesh);
    sheetMeshes.push(mesh);
  }

  const makeOverlayMaterial = (tex: THREE.Texture) => {
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
    const c = T.texture(tex, T.uv());
    mat.colorNode = T.vec4(c.rgb, c.a);
    mat.toneMapped = false;
    return mat;
  };
  const curlTex = makeCurlTexture();
  const shadowTex = makeEdgeShadowTexture();
  const curlMat = makeOverlayMaterial(curlTex);
  const edgeShadowMat = makeOverlayMaterial(shadowTex);
  const curl = new THREE.Mesh(new THREE.PlaneGeometry(1, 34), curlMat);
  curl.renderOrder = 20;
  curl.name = 'paper-curl';
  const edgeShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 86), edgeShadowMat);
  edgeShadow.renderOrder = 19;
  edgeShadow.name = 'paper-edge-shadow';
  scene.add(curl, edgeShadow);

  const setSize = (w: number, h: number) => {
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
    curl.scale.set(w, 1, 1);
    edgeShadow.scale.set(w, 1, 1);
  };

  const update = (state: PaperViewState) => {
    timeNode.value = state.time;

    if (state.stage === 'paper') {
      group.visible = true;
      const top = state.paperTop;
      group.position.y = camera.top - top;
      group.scale.setScalar(camera.right * 2 / paper.width);
      curl.visible = top > -34 && top < camera.top * 2;
      edgeShadow.visible = curl.visible;
      curl.position.y = camera.top - top - 17;
      edgeShadow.position.y = camera.top - top + 43;
    } else {
      group.visible = false;
      curl.visible = false;
      edgeShadow.visible = false;
    }
  };

  setSize(width, height);

  const dispose = () => {
    for (const mesh of sheetMeshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    curl.geometry.dispose();
    curlMat.dispose();
    curlTex.dispose();
    edgeShadow.geometry.dispose();
    edgeShadowMat.dispose();
    shadowTex.dispose();
    disposeAboutPaper(paper);
  };

  return { scene, camera, setSize, update, dispose };
}
