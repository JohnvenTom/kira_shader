/**
 * #film 页 hash → section 索引映射（纯数据模块）
 *
 * 独立成模块的原因：main.tsx 对 KiraFilmDemo 改为 React.lazy 按需加载后，
 * 无法再从该模块同步导入命名导出；把纯数据抽到这里，让入口在不上加载
 * KiraFilmDemo 代码（及其依赖的 three WebGL 构建全量模块）的情况下也能
 * 完成 hash 路由判定。
 */
export const FILM_SECTION_BY_HASH: Record<string, number> = {
  '#home': 0,
  '#work': 1,
  '#about': 2,
  '#contact': 3,
};
