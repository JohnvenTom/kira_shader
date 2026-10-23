import { forwardRef } from 'react';
import './contact.css';

export type ContactPhase = 'hello' | 'info' | 'photo' | 'footer';

export interface ContactUIProps {
  phase: ContactPhase;
  /** Contact 段是否激活；未激活时整层 inert，避免在 About 纸页里 Tab 到隐藏链接 */
  active: boolean;
}

const BOOK_URL = 'mailto:hello@shader.se?subject=Book%20a%20call';
const A11Y_URL = 'https://www.shader.se/accessibility-statement';

const SOCIAL = [
  { label: 'LinkedIn', href: 'https://www.linkedin.com/company/shadersweden/' },
  { label: 'Instagram', href: 'https://www.instagram.com/shadersweden/' },
  { label: 'X (Twitter)', href: 'https://x.com/shadersweden' },
];

/**
 * Contact 段的 DOM 层：Hello 标题 / 联系信息 / 页脚
 *
 * 透明度与位移由 WorkAboutExperience 每帧写入 CSS 变量：
 *  - --ct-hello / --ct-info / --ct-footer：0..1
 *  - data-phase 只在阶段切换时更新，用来控制哪一层可以点击
 */
const ContactUI = forwardRef<HTMLDivElement, ContactUIProps>(function ContactUI({ phase, active }, ref) {
  return (
    <div ref={ref} className="abct" data-phase={phase} role="region" aria-label="Contact" inert={!active}>
      <div className="abct-hello" aria-hidden="true">
        <span className="abct-quote">“</span>Hello<span className="abct-quote">”</span>
      </div>

      <section className="abct-info" aria-label="Contact details" inert={phase !== 'info'}>
        <div className="abct-info-intro">
          <p className="abct-kicker">Contact</p>
          <h2>Let&apos;s interface.</h2>
          <p className="abct-lede">
            Contact us about your digital project idea or general enquires. Call us today!
          </p>
        </div>

        <div className="abct-grid">
          <div className="abct-col">
            <h3>General Enquiries</h3>
            <a className="abct-link" href="mailto:hello@shader.se">
              hello@shader.se
            </a>
            <a className="abct-button" href={BOOK_URL}>
              Book a call
            </a>
          </div>

          <div className="abct-col">
            <h3>Visit us</h3>
            <address>
              Laxholmstorget 3
              <br />
              602 21 Norrköping
              <br />
              Sweden
            </address>
          </div>

          <div className="abct-col">
            <h3>Social</h3>
            {SOCIAL.map((item) => (
              <a key={item.label} className="abct-link" href={item.href} target="_blank" rel="noopener noreferrer">
                {item.label}
              </a>
            ))}
          </div>

          <div className="abct-col">
            <h3>New business</h3>
            <p>Reach out to our CEO for new business enquiries.</p>
            <a className="abct-link" href="mailto:ceo@shader.se">
              ceo@shader.se
            </a>
          </div>
        </div>
      </section>

      <footer className="abct-footer" inert={phase !== 'footer'}>
        <div className="abct-footer-inner">
          <div className="abct-seal">
            <img className="abct-cert" src="/textures/footer_certificate.png" alt="" draggable={false} />
            <img
              className="abct-copy"
              src="/textures/copyright_footer.png"
              alt="© Shader Sweden AB. All rights reserved."
              draggable={false}
            />
          </div>

          <div className="abct-footer-call">
            <p className="abct-kicker">One last trick</p>
            <h2>
              Let&apos;s build something
              <br />
              that feels like the future.
            </h2>
            <div className="abct-footer-links">
              <a className="abct-button" href={BOOK_URL}>
                Book a call
              </a>
              <a className="abct-link" href="mailto:hello@shader.se">
                hello@shader.se
              </a>
            </div>
          </div>

          <div className="abct-footer-aside">
            <img
              className="abct-simon"
              src="/textures/about/simon_calling.webp"
              alt="Simon from Shader on the phone"
              draggable={false}
            />
            <a
              className="abct-a11y"
              href={A11Y_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Accessibility Statement"
            >
              <img src="/textures/a11y.png" alt="Accessibility Statement" draggable={false} />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
});

export default ContactUI;
