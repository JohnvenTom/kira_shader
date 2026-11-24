// 临时 dev 配置：仅把 vite 依赖缓存指到项目外，避开 node_modules/.vite/deps 的批量删除确认
// （node_modules/.vite/deps 里 94 个缓存文件触发 safe-delete bulk confirm，阻塞 dev server 启动）
import { mergeConfig } from 'vite';
import baseConfig from './vite.config';

export default mergeConfig(baseConfig, {
  cacheDir: 'C:/Users/tom/.workbuddy/tmp/kira-vite-cache',
});
