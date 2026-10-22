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

  const setSize = (w: number, h: number) => {
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
  };

  const update = (state: PaperViewState) => {
    timeNode.value = state.time;

    if (state.stage === 'paper') {
      group.visible = true;
      const top = state.paperTop;
      group.position.y = camera.top - top;
      group.scale.setScalar(camera.right * 2 / paper.width);
    } else {
      group.visible = false;
    }
  };

  setSize(width, height);

  const dispose = () => {
    for (const mesh of sheetMeshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    disposeAboutPaper(paper);
  };

  return { scene, camera, setSize, update, dispose };
}
