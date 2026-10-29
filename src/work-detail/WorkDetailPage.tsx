/**
 * WorkDetailPage - /work/<slug> 项目详情页（shader.se 反编译 1:1 重建，WebGPU 体验栈）
 *
 * 架构（= 原站同构，_bundles/glossary-work-details.md）：
 *  - 视图层全部进 canvas：createWorkDetailExperience（ProjectScene + GrainPass +
 *    heroCompose 后期链，参数=projectPageEffectsConfig）；DOM 只留：
 *    boot 覆盖屏（BIOS 复用）、顶栏 logo/Close（入 uikit TODO）、a11y 镜像、滚动撑高。
 *  - 滚动：文档滚动（html.wd-scrolling 解锁）→ scrollY px → 体验内阻尼 →
 *    progress（视口数）→ 相机 X 平移；撑高 = pageCount × 100vh（pageCount=内容宽/视口宽）。
 *  - Close ✕ → /#selected-work（SPA pushState，原站实证）；Esc 同（原站 p7 内 Escape 监听）。
 *  - boot：BIOS 视觉/状态机复用；进度源=缩略图预载（视频经 hls.js 由体验懒加载）。
 *  - TODO：双实例 2s 卷页换页转场、portrait 分支、顶栏入 uikit、鼠标视差精调。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import './work-detail.css';
import { findWorkProject } from './data';
import { consumeSpaNav, navigate, navigateBackToProjects } from './navigate';
import { skipBoot } from '../boot/bootStore';
import WorkDetailBootOverlay from './WorkDetailBootOverlay';
import type { WorkDetailExperience } from './workDetailExperience';

export default function WorkDetailPage({ slug }: { slug: string }) {
  const project = useMemo(() => findWorkProject(slug), [slug]);
  const hostRef = useRef<HTMLDivElement>(null);
  const expRef = useRef<WorkDetailExperience | null>(null);
  // SPA 内部导航（View project/Continue/Close 返回）→ 跳过 boot：
  // 原站实证（真站点击连拍 oc2-*）：boot 只在硬加载播，客户端路由进详情
  // = 胶片保持 → 内容以 subPageTransition 亮度渐起 + 相机 z 10→5 飞入打开
  const [spaNav] = useState(() => consumeSpaNav());
  const [bootDone, setBootDone] = useState(spaNav);
  const [pageCount, setPageCount] = useState(2);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (spaNav) skipBoot(); // bootStore 单例置 done（跨页状态一致）
  }, [spaNav]);

  const subtitleLine = project
    ? project.collaborator
      ? `${project.subtitle} with ${project.collaborator}`
      : project.subtitle
    : '';

  /* 未知 slug → 回首页（防御） */
  useEffect(() => {
    if (!project) navigateBackToProjects();
  }, [project]);

  /* 标题与 meta（原站 SSR 实证格式） */
  useEffect(() => {
    if (!project) return;
    document.title = `Work: ${project.title} | Shader Development Studio`;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', project.descriptionParagraphs[0] ?? '');
  }, [project]);

  /* 文档滚动解锁 + boot 期锁定 */
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('wd-scrolling');
    return () => html.classList.remove('wd-scrolling');
  }, []);
  useEffect(() => {
    const html = document.documentElement;
    if (bootDone) html.classList.remove('wd-booting');
    else html.classList.add('wd-booting');
    return () => html.classList.remove('wd-booting');
  }, [bootDone]);

  /* 体验挂载（async init）+ 滚动接线 + Esc */
  useEffect(() => {
    if (!project || !bootDone) return;
    let disposed = false;
    let raf = 0;
    let last = performance.now();
    const cleanups: Array<() => void> = [];

    (async () => {
      const host = hostRef.current;
      if (!host || disposed) return;
      const { createWorkDetailExperience } = await import('./workDetailExperience');
      if (disposed) return;
      const exp = await createWorkDetailExperience(host, project);
      if (disposed) {
        exp.dispose();
        return;
      }
      expRef.current = exp;
      console.error('[wd-debug]', JSON.stringify(exp.__debug()));
      setPageCount(exp.getPageCount());
      setReady(true);
      exp.enter();

      const onScroll = () => exp.setScrollTarget(window.scrollY);
      window.addEventListener('scroll', onScroll, { passive: true });
      const onResize = () => exp.resize();
      window.addEventListener('resize', onResize);
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') navigateBackToProjects();
      };
      window.addEventListener('keydown', onKey);

      const loop = (now: number) => {
        const dt = (now - last) / 1000;
        last = now;
        exp.frame(dt, now / 1000);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);

      cleanups.push(
        () => window.removeEventListener('scroll', onScroll),
        () => window.removeEventListener('resize', onResize),
        () => window.removeEventListener('keydown', onKey),
      );
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cleanups.forEach((c) => c());
      expRef.current?.dispose();
      expRef.current = null;
    };
  }, [project, bootDone]);

  if (!project) return null;

  return (
    <div className="wd-page">
      {/* boot 屏（BIOS 视觉/状态机复用；进度源=缩略图） */}
      {/* boot 屏（BIOS 复用；仅硬加载播——SPA 内部导航跳过，原站实证） */}
      {!spaNav && <WorkDetailBootOverlay project={project} onDone={() => setBootDone(true)} />}

      {/* 顶栏（入 uikit TODO） */}
      <header className="wd-topbar">
        <a
          className="wd-logo"
          href="/#hero"
          aria-label="Shader logo, go to home page"
          onClick={(e) => { e.preventDefault(); navigate('/#hero'); }}
        >
          <img src="/work-media/logo-colored.png" alt="Shader" draggable={false} />
        </a>
        <button type="button" className="wd-close" onClick={navigateBackToProjects}>
          Close <span className="wd-close-x">✕</span>
        </button>
      </header>

      {/* WebGPU 画布宿主 */}
      <div className="wd-canvas-host" ref={hostRef} aria-hidden />

      {/* 滚动撑高（pageCount 屏；体验就绪前给默认 2 屏） */}
      <div className="wd-spacer" style={{ height: `${ready ? pageCount * 100 : 200}vh` }} aria-hidden />

      {/* a11y 镜像（原站 a11y-overlay 同构） */}
      <div className="wd-a11y">
        <nav aria-label="Main navigation">
          <a href="/#hero">Shader — Home</a>
          <a href="/#selected-work" onClick={(e) => { e.preventDefault(); navigateBackToProjects(); }}>
            Back to projects
          </a>
        </nav>
        <section aria-label="Project details">
          <h1>{project.title}</h1>
          <p>{project.descriptionParagraphs.join('\n')}</p>
          <div>
            <h2>Next Project</h2>
            <p>{subtitleLine}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
