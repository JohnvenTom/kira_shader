/**
 * 静态资源类型声明
 *
 * 功能：让 TypeScript 识别以 import 方式引入的图片资源（.png/.jpg/.webp 等），
 *      避免在 tsconfig 未引入 vite/client 类型时出现 "Cannot find module" 报错。
 *
 * 注意事项：仅在类型层面声明，不影响实际打包；Vite 会自动处理资源 URL 解析。
 */
declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.jpg' {
  const src: string;
  export default src;
}

declare module '*.webp' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.gif' {
  const src: string;
  export default src;
}

/**
 * gifuct-js 类型声明
 *
 * 功能：为无官方类型的 gifuct-js 库提供最小化的类型声明，
 *       仅覆盖 ScreenDisplay 组件用到的 parseGIF / decompressFrames 接口。
 *
 * 字段说明：
 *  - ParsedGif.header      GIF 文件头信息（版本号等）
 *  - ParsedGif.frames      未解压的帧描述列表
 *  - GifFrame dims         单帧在画布上的位置与尺寸 { width, height, top, left }
 *  - GifFrame patch        解压后的 RGBA 像素数据（Uint8ClampedArray）
 *  - GifFrame delay        该帧停留时长（毫秒）
 *  - GifFrame disposalType 帧处置类型（0/1/2/3，决定下一帧如何处理本帧）
 */
declare module 'gifuct-js' {
  export interface GifFrameDims {
    width: number;
    height: number;
    top: number;
    left: number;
  }

  export interface GifFrame {
    dims: GifFrameDims;
    patch: Uint8ClampedArray;
    delay: number;
    disposalType: number;
    transparentIndex: number | null;
    colorTable: number[][];
  }

  export interface ParsedGif {
    header: { signature: string; version: string };
    frames: unknown[];
    isGif: boolean;
    gifEngine: unknown;
  }

  /** 解析 GIF 文件二进制为结构化对象（未解压帧数据） */
  export function parseGIF(buffer: ArrayBuffer): ParsedGif;

  /** 解压 GIF 帧数据，得到每帧的 RGBA patch 和时序信息 */
  export function decompressFrames(parsedGif: ParsedGif, buildImagePatch: boolean): GifFrame[];
}
