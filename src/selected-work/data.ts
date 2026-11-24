/**
 * Selected Work 项目清单
 *
 * 数据来源：线上首页 RSC flight payload（`title/subtitle/collaborator/brightness/contrast`
 * 逐字提取）。缩略图由同源 Mux 图床（w800-h600-fpreserve-t0-webp）本地化到
 * `public/textures/projects/`，文件名按项目重命名。
 *
 * 顺序即胶片条的环绕顺序：eHealth Arena（0）→ Select Concept（1）→ … → Design is Funny（10）。
 * 线上实现的 `prismicProjects` 是反序存放的，进入胶片材质前又 `.reverse()` 一次 —— 两次相消，
 * 屏幕上看就是从 eHealth 开始的自然顺序。
 */
export interface SelectedProject {
  title: string;
  subtitle: string;
  collaborator: string;
  thumbnail: string;
  /** 原版按项目微调胶片画格亮度（缺省 1） */
  brightness: number;
  /** 原版按项目微调胶片画格对比度（缺省 1） */
  contrast: number;
}

export const SELECTED_PROJECTS: SelectedProject[] = [
  {
    title: 'eHealth Arena',
    subtitle: '3D Showroom',
    collaborator: 'Markus Reklambyrå',
    thumbnail: '/textures/projects/ehealth-arena.webp',
    brightness: 1,
    contrast: 1,
  },
  {
    title: 'Select Concept',
    subtitle: '3D Interior Designer',
    collaborator: '',
    thumbnail: '/textures/projects/select-concept.webp',
    brightness: 0.75,
    contrast: 1,
  },
  {
    title: 'Gamily',
    subtitle: 'Campaign Website',
    collaborator: '',
    thumbnail: '/textures/projects/gamily.webp',
    brightness: 1,
    contrast: 1,
  },
  {
    title: 'Alamance Foods',
    subtitle: 'Website',
    collaborator: '',
    thumbnail: '/textures/projects/alamance-foods.webp',
    brightness: 0.8,
    contrast: 1,
  },
  {
    title: 'Norrköpings Symfoniorkester',
    subtitle: 'Website',
    collaborator: '',
    thumbnail: '/textures/projects/son.webp',
    brightness: 1,
    contrast: 1,
  },
  {
    title: 'Glasbolaget',
    subtitle: '3D Configurator',
    collaborator: '',
    thumbnail: '/textures/projects/glasbolaget.webp',
    brightness: 0.75,
    contrast: 1,
  },
  {
    title: 'SPP Dream Generator',
    subtitle: 'AI Image and Video Generator',
    collaborator: 'Jungle Design',
    thumbnail: '/textures/projects/spp-dream-generator.webp',
    brightness: 0.8,
    contrast: 1,
  },
  {
    title: 'ICA-nissen',
    subtitle: 'AR Game',
    collaborator: '',
    thumbnail: '/textures/projects/ica-nissen.webp',
    brightness: 0.7,
    contrast: 1,
  },
  {
    title: 'Norrköpings Hamn',
    subtitle: '3D Flow Visualization',
    collaborator: '',
    thumbnail: '/textures/projects/norrkopings-hamn.webp',
    brightness: 0.75,
    contrast: 1,
  },
  {
    title: 'HEIP',
    subtitle: '3D Visualisation',
    collaborator: '',
    thumbnail: '/textures/projects/heip.webp',
    brightness: 1,
    contrast: 1,
  },
  {
    title: 'Design is Funny',
    subtitle: 'Portfolio',
    collaborator: 'Daniele Buffa',
    thumbnail: '/textures/projects/design-is-funny.webp',
    brightness: 1,
    contrast: 1,
  },
];

/** 环形取值（负数也能得到 0..len-1） */
export const wrapIndex = (index: number, length = SELECTED_PROJECTS.length) =>
  ((index % length) + length) % length;
