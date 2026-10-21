import type { CSSProperties } from 'react';
import './selected-work.css';

/**
 * Selected Work 视口的 DOM 覆盖层（导航 / 翻页箭头 / 滚动提示）
 *
 * 线上这些 UI 是画在 WebGL 里的（Yoga 布局 + MSDF 文字），会和场景一起过桶形畸变。
 * 这里用 DOM 复刻同一套版式；边缘位置按参考截图校准（畸变把四角元素向内推，
 * 所以两侧箭头与导航留白比线上原始布局值更大）。
 */
export interface SelectedWorkUIProps {
  /** 外层样式（首页穿越结束的淡入由父级写 opacity / visibility） */
  style?: CSSProperties;
  onPrev?: () => void;
  onNext?: () => void;
  onScrollHint?: () => void;
  onAbout?: () => void;
}

const NAV_ITEMS = [
  { label: 'Home', href: '#hero', key: 'home' },
  { label: 'Selected Work', href: '#selected-work', key: 'work' },
  { label: 'About Us', href: '#about-us', key: 'about' },
  { label: 'Contact', href: '#contact', key: 'contact' },
] as const;

const BOOK_A_CALL = 'https://cal.com/simon-hedlund-kglzne';

export default function SelectedWorkUI({ style, onPrev, onNext, onScrollHint, onAbout }: SelectedWorkUIProps) {
  return (
    <div className="sw-ui" style={style} data-sw-ui>
      <header className="sw-nav">
        <a className="sw-logo" href="#hero" aria-label="Shader — home">
          <img src="/logo-shader.svg" alt="Shader" draggable={false} />
        </a>

        <nav className="sw-nav-links" aria-label="Main">
          {NAV_ITEMS.map((item) => {
            const active = item.key === 'work';
            return (
              <a
                key={item.key}
                href={item.href}
                className={`sw-nav-link${active ? ' is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={
                  item.key === 'about'
                    ? (e) => {
                        e.preventDefault();
                        onAbout?.();
                      }
                    : undefined
                }
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        <a
          className="sw-book"
          href={BOOK_A_CALL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <img src="/textures/icons/old_phone.svg" alt="" draggable={false} />
          <span>Book a call</span>
        </a>
      </header>

      <button type="button" className="sw-arrow sw-arrow-prev" onClick={onPrev} aria-label="Previous project">
        <img src="/textures/icons/arrow_right_white.svg" alt="" draggable={false} />
      </button>
      <button type="button" className="sw-arrow sw-arrow-next" onClick={onNext} aria-label="Next project">
        <img src="/textures/icons/arrow_right_white.svg" alt="" draggable={false} />
      </button>

      <button type="button" className="sw-hint" onClick={onScrollHint}>
        <span className="sw-hint-hand">
          <img src="/textures/icons/pointing_hand_light.svg" alt="" draggable={false} />
        </span>
        <span className="sw-hint-text">Scroll to About Us</span>
        <span className="sw-hint-hand">
          <img src="/textures/icons/pointing_hand_light.svg" alt="" draggable={false} />
        </span>
      </button>
    </div>
  );
}
