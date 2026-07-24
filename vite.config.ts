import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite 配置（独立运行版）
 *
 * 功能：启用 React 插件；使用默认 publicDir 直接从项目自身的 public/ 目录加载静态资源
 *      （draco 解码器、smoke.png 纹理、computer.glb 模型均位于 public/asset/ 下）
 *
 * 注意事项：
 *  - 不再依赖父级 asset 目录，public/ 下的文件会被 Vite 自动映射到根路径
 *  - publicDir 默认值为 "public"，此处显式写明以提升可读性
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
  },
  publicDir: 'public',
});
