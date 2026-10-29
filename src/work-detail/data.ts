/**
 * /work/<slug> 详情页项目数据
 *
 * 来源：shader.se RSC flight payload（screenshots/re-work/rsc-projects.json，逐字段照抄）。
 * description 内的段间分隔是**字面的 "\n" 两字符序列**（原站 a11y overlay 实证：
 * "…in the game.\nThe game was developed…"），渲染前用 split('\\n') 切段。
 *
 * 资产约定：视频本地化到 /work-media/<uid>/<mux_playback_id>.mp4
 * （scripts/pull-hls.mjs 下载 HLS 最高带宽档，fMP4 init+分段拼接）。
 */

export interface WorkProject {
  uid: string;
  title: string;
  subtitle: string;
  /** 外链站点（ica-nissen 为 undefined → 详情页不渲染 Visit site 行） */
  siteLink?: { url: string; target?: string };
  /** 有值时副标题行拼 " with {collaborator}" */
  collaborator?: string;
  /** 首屏 demo 主视频 */
  muxPlaybackId: string;
  brightness?: number;
  contrast?: number;
  /** 媒体流视频（个别与主视频重复，按原站顺序保留） */
  projectMedia: string[];
  /** 描述段落（已按字面 \n 切分） */
  descriptionParagraphs: string[];
}

interface RawProject {
  uid: string;
  url: string;
  title: string;
  subtitle: string;
  site_link?: { url: string; target?: string } | string;
  collaborator?: string;
  mux_playback_id: string;
  brightness?: number | string;
  contrast?: number | string;
  project_media?: { mux_playback_id: string }[];
  description: string;
}

/** RSC payload 原始数据（$undefined 已清理为缺省；字符串未做任何改写） */
const RAW: RawProject[] = [
  {
    uid: 'ehealth-arena', url: '/work/ehealth-arena', title: 'eHealth Arena', subtitle: '3D Showroom',
    site_link: { url: 'https://www.ehealtharena.se/digitalt-showroom' },
    collaborator: 'Markus Reklambyrå',
    mux_playback_id: 'Y7HzOsrmhjd7M00Ib6JYF861ME00I3ZqicLcr4V9vhoXU',
    project_media: [
      { mux_playback_id: 'gyP026f00GygEUVxzl6e4xG1hTvyPyf9DUFTMEok02FvDk' },
      { mux_playback_id: '8jgvDY37uHSMjcWjV59G2hcnBAw01WOs7rbtsid6veoU' },
      { mux_playback_id: 'M5WUYh6JnUN454BfB02Q01VfDA4VHCSi7ASLwsQm9Tn1w' },
    ],
    description: "We created an interactive 3D platform that explores how the latest e-health solutions work in practice. From the patient's home to hospital environments and care providers' workplaces. Users can follow real care journeys, and understand how it all connects to create safer, more efficient care.",
  },
  {
    uid: 'select-concept', url: '/work/select-concept', title: 'Select Concept', subtitle: '3D Interior Designer',
    site_link: { url: 'https://selectconcept.com/planner', target: '_blank' },
    mux_playback_id: '29xq00NijxLTofeMmyr1hvjJjStsZbMzzOBnP8JN24NM',
    brightness: 0.75, contrast: 1,
    project_media: [
      { mux_playback_id: 'h344B28uehxF4mUqnTW6tOURAZRB3MJ5r8LRWFo6iEw' },
      { mux_playback_id: 'M55yk01Z5rPltnIoTS01025MhFaUHjGO43nCkL2Zi1WLP8' },
      { mux_playback_id: 'VOkEARnsJsYOyePubj67h6Us7LtBkdH601M28mKhUWc00' },
    ],
    description: 'Select Concept is a Swedish brand offering high-quality products for restaurants, hotels and cafes. We teamed up with them to conceptualize, design, and develop a user-friendly yet powerful 3D product planning tool, along with a new website.\nThe tool includes over 100 modeled products, and gives the user the ability to freely design and plan their room, buffet tables and products within a realistic 3D environment. Once completed, the user can add the products to the cart and request a quote.',
  },
  {
    uid: 'gamily', url: '/work/gamily', title: 'Gamily', subtitle: 'Campaign Website',
    site_link: { url: 'https://gamilyapp.com/' },
    mux_playback_id: 'WR4ERwHNIF5rXY9l026yYwwacbpWgU7q3FrYxKYwqDrY',
    project_media: [
      { mux_playback_id: '5WDfnYn02j24uZtRuOWrBqdZs00dGQJIB9JfgLKOLlM6g' },
      { mux_playback_id: 'WR4ERwHNIF5rXY9l026yYwwacbpWgU7q3FrYxKYwqDrY' },
      { mux_playback_id: 'uzwe1m8025rHS02KDPay7GI85DlCO7PR5v5YC7ebUqDWY' },
      { mux_playback_id: 'r3KpNeJPj3ycDd7t1tbufUqYlw007AiXHsDhdbrz62Jo' },
    ],
    description: 'Gamily is the dating and friend app designed for gamers who are looking for meaningful relationships with fellow gamers.\nWe contributed to the development and deployment of the landing page. The webpage showcases the app\'s brand identity by integrating creative visual animations complemented by custom-built 3D assets.',
  },
  {
    uid: 'alamance-foods', url: '/work/alamance-foods', title: 'Alamance Foods', subtitle: 'Website',
    site_link: { url: 'https://www.alamancefoods.com/brands/coffee-toppers', target: '_blank' },
    mux_playback_id: 'crXxuu5ds7W2UrGP1JE00V01xgtotSe02OOUojNBKjprKg',
    brightness: 0.8,
    project_media: [
      { mux_playback_id: 'crXxuu5ds7W2UrGP1JE00V01xgtotSe02OOUojNBKjprKg' },
      { mux_playback_id: 'aimjydu6qzX2HftFtWUqO9Q02uwai7vR02WcU102ARxxws' },
      { mux_playback_id: 'lz00yfsd6KGy9SndkMAaQcTIYDKoqhIp8dgyh8R700MqI' },
      { mux_playback_id: 'Hwh005XC00jk901GgBSNnaEzOKYa7gaKIyLRkblI8i6yrU' },
    ],
    description: 'Alamance Foods make fun foods. We made their web page using creative design ideas complemented with their products in 3D.\nAll models were made by us using Blender. For the programming of the models we used React Three Fiber. A particularly smart thing in this solution is the shader programming of the materials to make them behave realistically and still have high performance on slower devices.',
  },
  {
    uid: 'son', url: '/work/son', title: 'Norrköpings Symfoniorkester', subtitle: 'Website',
    site_link: { url: 'https://www.norrkopingssymfoniorkester.se/', target: '_blank' },
    mux_playback_id: 'hrfPaZr4FOpHh2iiUzTz01ppZApstkbjMH01vyZ5bDEg8',
    project_media: [
      { mux_playback_id: 'XGZPxx01Di01mSOSTZc7r01Kn2H8RN9rbrUqnwX01snmeFw' },
      { mux_playback_id: 'qqHoqRFJmREhhYB6fBnB02rYbtgmZT7KccPYswBfLe0200' },
      { mux_playback_id: 'tOwPdRvWzCrqBATUIOo7q6KEYeDy8ZAc5L11Gil8EAc' },
      { mux_playback_id: 'ps02qxHI6qgHOmnhVwS00y4u13m01R1i00YUOLRDBQQRqsY' },
    ],
    description: 'We manage the entire web platform for Scenkonst Öst where Norrköping Symphony Orchestra is a part. The audience can browse concerts, book tickets, buy gift cards and much more.',
  },
  {
    uid: 'glasbolaget', url: '/work/glasbolaget', title: 'Glasbolaget', subtitle: '3D Configurator',
    site_link: { url: 'https://glasbolaget-configurator.vercel.app/', target: '_blank' },
    mux_playback_id: 'cUnrcyhPVk47A500005QHTfK00wUyr201vc2NEORq5ybaCE',
    brightness: 0.75,
    project_media: [
      { mux_playback_id: 'bYuaivFc7Q6eVLBdcX31KAeqnsgluc7yFXchTIKHHdc' },
      { mux_playback_id: 'whhI01nHb1V02BeO43Ax92AMwXXPAp1yQ01vkW1ZvL5cpM' },
      { mux_playback_id: '79yry93M01MVaxHIFuCLYEeFowTkMkIdnrTEiex00XM01Q' },
    ],
    description: 'We made a configurator for a company that sells glass in different forms. The user can create their own glass rails, walls and separate pieces using our 3D configurator. The prices are being fetched from an API so that we can calculate the total cost as the user designs.\nSome models have been modelled by hand and some are generated as the user modifies the parameters in the configurator.',
  },
  {
    uid: 'spp-dream-generator', url: '/work/spp-dream-generator', title: 'SPP Dream Generator', subtitle: 'AI Image and Video Generator',
    site_link: { url: 'https://retirement-dream-generator.se' },
    collaborator: 'Jungle Design',
    mux_playback_id: 'JFKPwSwJdrTK6zn1c013dCw5HTxkekifCD8cbWWmd7JQ',
    brightness: 0.8,
    project_media: [
      { mux_playback_id: 'uzBOoiGvXfxdOASlVqDU005foqLExaLY7482szwaUo8g' },
      { mux_playback_id: 'H3BBktaN1wLTt5hcjLU00FxM7X500cS602pwInC00FxfRVg' },
      { mux_playback_id: 'cOKCARGGC6Te2RzXstxln4fDWP8vSK8eTvx1eZAvp6w' },
      { mux_playback_id: 'JCuoog00nHzvxcJzE02aqG9Z1l8lyq2JJzY201e5n3Dy1c' },
    ],
    description: 'What was supposed to be a one shot PR event became a lasting piece of the SPP website. The visitor takes a photo of him/herself and writes a short description of what the days would look like when retired from work.\nThe program then generates a realistic video of the person in the dream that they described along with a description of what life could look like. A presentation page containing the video and description is emailed to the visitor. This PR stunt helped transfer customers to SPP on its own.',
  },
  {
    uid: 'ica-nissen', url: '/work/ica-nissen', title: 'ICA-nissen', subtitle: 'AR Game',
    collaborator: 'Wenderfalck',
    mux_playback_id: 'caSLneThURyYn402mCTXi6sgHLpL2F0201EcF01rI3ZwKk8',
    brightness: 0.7,
    project_media: [
      { mux_playback_id: '5ySYfYF02sqCtkV8vy009HS1z1vPP7pBKB3zYDaWDI6Us' },
      { mux_playback_id: 'wPWOmus01QZjlNL6YYFXj1Z1NWkk8TOBMJdLLsEQKg44' },
      { mux_playback_id: 'AJkkMkHOt6xQsgOxpQa6j2nvIOhvtejYFs6SU3aAgJs' },
      { mux_playback_id: '01vZOcXfUrPvKGOILFcwB7lhhH5DBTwY006m3tgeRGjJA' },
      { mux_playback_id: 'bb02O7nwwDJ3wG5Ksr02Hs01xrETmBlkeeaEY4YyTq3ArY' },
      { mux_playback_id: 'caSLneThURyYn402mCTXi6sgHLpL2F0201EcF01rI3ZwKk8' },
    ],
    description: "ICA is one of Sweden's largest grocery stores. For Christmas 2024 we made an AR game for them where users could scan ICA's products and unlock features in the game.\nThe game was developed with 8th wall which is the same software used in Pokemon GO. This makes the AR experience work fluently on both Android and iOS. Models and textures made with Blender.",
  },
  {
    uid: 'norrkopings-hamn', url: '/work/norrkopings-hamn', title: 'Norrköpings Hamn', subtitle: '3D Flow Visualization',
    site_link: { url: 'https://visual-of-sweden.vercel.app/hamnen' },
    mux_playback_id: 'byyZFSODgpXF2dwVzYl1sLBSfpwUw4mHYhWiqT3qRZ4',
    brightness: 0.75,
    project_media: [
      { mux_playback_id: '7xt9X00JO5m9YJ301iOaLnXJHI801GbA8FKWNr001OjRbFw' },
      { mux_playback_id: 'sheOFcp9fDYsGRNko802zE9bONvR011Zx83kXkwQe65XY' },
      { mux_playback_id: 'UTKAQh00009GaGixHM8QJTZnda8qIdPaggG4FKiGiaJGA' },
      { mux_playback_id: 'c6bE7jLrDuM4ZwPU6GRcUmLeIM013zS3Q2eQnjRY6L3o' },
      { mux_playback_id: 'dJA1iG1fPVw3hPcXxwVacVOlPmx6J4jbpjaHNg5deHE' },
      { mux_playback_id: 'T4YRKbtsXNqDZxgpwDc87V02eVkiTXwzk5Jo01MEFz01E00' },
    ],
    description: 'We created a real-time 3D visual experience detailing the physical journey and logistics of two shipping containers. The objective of this application was to provide users with a detailed and engaging insight into the complex operations conducted at the docks of Norrköping.\nThe application was made with Next.js, React, and TypeScript. All 3D models were created with Blender and integrated into the web environment using React Three Fiber.',
  },
  {
    uid: 'heip', url: '/work/heip', title: 'HEIP', subtitle: '3D Visualisation',
    site_link: { url: 'https://heip-vis.vercel.app/sv', target: '_blank' },
    mux_playback_id: 'LbdE02DF9Gx1iVtxU98nv6uOtEEmQkTSs00Uyqb6O0201Tw',
    project_media: [
      { mux_playback_id: 'LbdE02DF9Gx1iVtxU98nv6uOtEEmQkTSs00Uyqb6O0201Tw' },
      { mux_playback_id: 'mAHI2XHR02R49Q02ZTknqKi4JmkIkHeUPrsQ0200101MFFKE' },
      { mux_playback_id: '005QKAjn5uzXCECW6eQSaNXX01LLEIBg6rT3P6nySuJL4' },
    ],
    description: 'This visualization was created for Händelö Eco-Industrial Park and shows how different factories and units exchange by-products, reducing waste and maximizing overall efficiency.',
  },
  {
    uid: 'design-is-funny', url: '/work/design-is-funny', title: 'Design is Funny', subtitle: 'Portfolio',
    site_link: { url: 'https://www.designisfunny.co/' },
    collaborator: 'Daniele Buffa',
    mux_playback_id: '83n4y2fZh2ztnRDEkkHBr2CxcTt9ofYGNL601sy9bpW00',
    brightness: 1, contrast: 1,
    project_media: [
      { mux_playback_id: '013qxnkYrVxEnqwseKxlEb11Cad02z02BJLjOhQdz01v02nk' },
      { mux_playback_id: 'vV1lkODuGFp00ahFD8D5PxuFwMyf01M4ZaZ02934yL3ya00' },
      { mux_playback_id: '00gwM2OvfPxE1LB73lvkkQdiJ7Dfi01ciEIadSGYSW2do' },
    ],
    description: "Funny is the design work of Daniele Buffa, a Roman designer now based in London, UK. Buffa ('boo-f:ah) from the Italian means funny, comic, or droll.\nWe helped develop the portfolio website, which is a sophisticated single-page application that features integrated interactive visuals and a progressive design structure.",
  },
];

const undefined_ = (v: unknown) => v === '$undefined' || v === undefined;

export const WORK_PROJECTS: WorkProject[] = RAW.map((p) => ({
  uid: p.uid,
  title: p.title,
  subtitle: p.subtitle,
  siteLink: undefined_(p.site_link) ? undefined : (p.site_link as { url: string; target?: string }),
  collaborator: undefined_(p.collaborator) ? undefined : p.collaborator,
  muxPlaybackId: p.mux_playback_id,
  brightness: undefined_(p.brightness) ? undefined : (p.brightness as number),
  contrast: undefined_(p.contrast) ? undefined : (p.contrast as number),
  projectMedia: (p.project_media ?? []).map((m) => m.mux_playback_id),
  // 原站 description 用字面 "\n"（反斜杠+n 两字符）分段——a11y overlay 实证
  descriptionParagraphs: p.description.split('\\n'),
}));

/** 环序取下一项目（最后一个 → 第一个，原站 Continue 环序） */
export function nextWorkProject(uid: string): WorkProject {
  const i = WORK_PROJECTS.findIndex((p) => p.uid === uid);
  return WORK_PROJECTS[(i + 1 + WORK_PROJECTS.length) % WORK_PROJECTS.length];
}

export function findWorkProject(slug: string): WorkProject | undefined {
  return WORK_PROJECTS.find((p) => p.uid === slug);
}

/** 本地视频路径（/work-media/<uid>/<id>.mp4，由 scripts/download-work-media.mjs 产出） */
export const workVideoSrc = (uid: string, playbackId: string) =>
  `/work-media/${uid}/${playbackId}.mp4`;
