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
