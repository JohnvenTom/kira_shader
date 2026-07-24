import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, extname } from 'node:path';

/**
 * Vite 配置
 * 功能：启用 React 插件；允许开发服务器访问父级 asset 目录（用于加载 .glb 模型与 Draco 解码器）
 */
const projectRoot = dirname(fileURLToPath(import.meta.url));
const assetRoot = resolve(projectRoot, '..', 'asset');

/**
 * 根据文件扩展名返回 MIME 类型
 *
 * 功能：中间件返回静态文件时设置正确的 Content-Type，否则浏览器会因为
 *      缺少 MIME 类型（或 X-Content-Type-Options: nosniff）拒绝执行 .js/.wasm
 *
 * 参数：
 *  - filePath {string} 文件绝对路径
 *
 * 返回值：{string} MIME 类型，默认 application/octet-stream
 */
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.wasm': 'application/wasm',
    '.glb': 'model/gltf-binary',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.css': 'text/css',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };
  return map[ext] ?? 'application/octet-stream';
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'serve-parent-asset',
      configureServer(server) {
        // 把 /asset/* 请求映射到父级 asset 目录，使 useGLTF 能直接 fetch 模型
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.startsWith('/asset/')) {
            const relPath = req.url.replace('/asset/', '').replace(/\?.*$/, '');
            const absPath = resolve(assetRoot, relPath.replaceAll('/', '\\'));
            // 仅允许在 asset 目录内（防止路径穿越）
            if (absPath.startsWith(assetRoot)) {
              // 设置正确的 Content-Type，否则浏览器会拒绝执行 .js/.wasm
              res.setHeader('Content-Type', getMimeType(absPath));
              import('fs').then((fs) => {
                fs.promises.readFile(absPath).then((buf) => {
                  res.end(buf);
                }).catch(() => {
                  res.statusCode = 404;
                  res.end('Not Found');
                });
              });
              return;
            }
          }
          next();
        });
      },
    },
  ],
  server: {
    port: 5173,
    open: true,
    fs: {
      // 允许访问父级目录（用于读取 asset）
      allow: ['..'],
    },
  },
  publicDir: false,
});
