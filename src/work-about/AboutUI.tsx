import { useEffect, useState, type MouseEvent } from 'react';
import './about.css';

export type AboutTheme = 'light' | 'dark';
export type AboutNavKey = 'about' | 'contact';

export interface AboutUIProps {
  theme: AboutTheme;
  visible: boolean;
  activeKey?: AboutNavKey;
  onNav?: (key: AboutNavKey) => void;
}

const NAV_ITEMS = [
  { label: 'Home', href: '#hero', key: 'home' },
  { label: 'Selected Work', href: '#selected-work', key: 'work' },
  { label: 'About Us', href: '#about-us', key: 'about' },
  { label: 'Contact', href: '#contact', key: 'contact' },
] as const;

const BOOK_URL = 'mailto:hello@shader.se?subject=Book%20a%20call';

const COPY = {
  introHeading: 'Making Digital Storytelling More Playful, Powerful, and Alive',
  intro: [
    "Shader is a creative development studio specialized in building interactive 3D and AI solutions for the web. Serious about business, based in Sweden, and working with brands, agencies and designers worldwide.",
    "Plugged into the future. While we're a small team of creative engineers, we have a hand-picked network of collaborators: designers, 3D artists, copywriters, animators, and creative technologists, ready to plug in with an array of capabilities.",
    "This modular approach means we can scale and adapt to each challenge. Whether it's a WebGL experiment, an interactive product visualization, a mobile app, or an AI-driven experience, we help bold brands stand out across every screen.",
    "We build storytelling platforms that demand attention and reward curiosity. We push digital mediums to places you haven't seen before, and have fun doing it. Beyond code, we offer 3D design and animation, UI and motion design, concepts and digital strategy, full-stack development, and creative consulting.",
    "Whether it's prototyping an idea, launching an augmented reality experience, or bringing high-fidelity visuals to life, Shader bridges the gap between creative ambition and technical execution. Our process is hands-on, collaborative, and tailored for teams that value both craft and innovation. We combine technical expertise with a designer's eye, ensuring that every interaction feels natural and every pixel is perfectly placed. We're not your regular IT department. We don't troubleshoot printers.",
  ],
  clientsHeading: 'A Showcase of Valued Clients',
  clientsBody:
    'We have had the benefit of working with a large pool of great clients throughout the years. Our partnerships ranges from some of the most recognizable Swedish brands to international innovators.',
  clientsQuestion: "Are you curious about what we can do for your company? Let's Talk.",
  seriousHeading: 'For Companies Serious About Technology',
  serious: [
    "In today's fast-paced corporate landscape, you need a partner who understands the bottom line. At Shader, we engineer success through strategic alliances and mutual profitability. Our team is ready to synergize with your organization, unlock new verticals, and maximize your digital ROI. We don't just close deals; we deliver results that compound.",
    'We leverage state-of-the-art technology to give your brand a decisive competitive advantage. Whether disrupting the market with paradigm-shifting 3D experiences or streamlining operations with cutting-edge AI, we provide turnkey solutions that scale. We merge high-performance engineering with executive-level design to build assets that appreciate your brand value.',
    "Ready to take your enterprise to the next level? Don't waste valuable time. Review our portfolio, crunch the numbers, and you'll see the trajectory points one way: up. Pick up the phone, send a fax, or schedule a consultation. The future of your business is waiting. Let's execute.",
  ],
  cardTitle: 'Act now! Book a Consultation.',
  cardBody:
    'Cut along the dotted line and mail this to the post address below for a free 30 minute video call consultation.',
  cardAddress: ['Shader Sweden AB', 'Laxholmstorget 3', '602 21 Norrköping, Sweden'],
  cardButton: 'Book a Call Today',
  ctaHeading: "Had Enough Reading? Let's Shred This Thing.",
};

export default function AboutUI({ theme, visible, activeKey = 'about', onNav }: AboutUIProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const light = theme === 'light';

  const handleItemClick = (key: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if ((key === 'about' || key === 'contact') && onNav) {
      e.preventDefault();
      setMenuOpen(false);
      onNav(key);
    }
  };

  useEffect(() => {
    if (!menuOpen) return;
    document.body.dataset.aboutMenu = '1';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      delete document.body.dataset.aboutMenu;
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!visible) setMenuOpen(false);
  }, [visible]);

  return (
    <div className="ab-ui" data-theme={theme} data-visible={visible ? '1' : '0'} data-ab-ui>
      <header className="ab-nav">
        <a className="ab-logo" href="#hero" aria-label="Shader — home">
          <img src={light ? '/logo-shader.svg' : '/textures/logo_dark.svg'} alt="Shader" draggable={false} />
        </a>

        <nav className="ab-nav-links" aria-label="Main">
          {NAV_ITEMS.map((item) => {
            const active = item.key === activeKey;
            return (
              <a
                key={item.key}
                href={item.href}
                className={`ab-nav-link${active ? ' is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={handleItemClick(item.key)}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        <a className="ab-book" href={BOOK_URL}>
          <img
            src={light ? '/textures/icons/old_phone.svg' : '/textures/icons/old_phone_dark.svg'}
            alt=""
            draggable={false}
          />
          <span>Book a call</span>
        </a>

        <button
          type="button"
          className="ab-burger"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </header>

      {menuOpen && (
        <div className="ab-menu" role="dialog" aria-modal="true" aria-label="Menu">
          <nav className="ab-menu-links">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.key}
                href={item.href}
                onClick={(e) => {
                  setMenuOpen(false);
                  handleItemClick(item.key)(e);
                }}
              >
                {item.label}
              </a>
            ))}
            <a href={BOOK_URL} onClick={() => setMenuOpen(false)}>
              Book a call
            </a>
          </nav>
        </div>
      )}

      <section className="ab-a11y">
        <h1>About Us</h1>
        <h2>{COPY.introHeading}</h2>
        {COPY.intro.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        <h2>{COPY.clientsHeading}</h2>
        <p>{COPY.clientsBody}</p>
        <p>{COPY.clientsQuestion}</p>
        <h2>{COPY.seriousHeading}</h2>
        {COPY.serious.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        <h3>{COPY.cardTitle}</h3>
        <p>{COPY.cardBody}</p>
        <p>{COPY.cardAddress.join(', ')}</p>
        <p>
          <a href={BOOK_URL}>{COPY.cardButton}</a>
        </p>
        <h2>{COPY.ctaHeading}</h2>
      </section>
    </div>
  );
}
