/**
 * 顶部导航组件
 *
 * 功能：固定在顶部的极简导航栏，包含 logo 与若干锚点链接
 *
 * 参数：
 *  - visible: boolean，boot 显现、标题入场后为 true（此前随 boot 屏一起隐藏）
 *
 * 返回值：React.ReactElement
 * 异常：无
 */
export function NavBar({ visible = true }: { visible?: boolean }) {
  return (
    <nav className={`nav-bar${visible ? ' visible' : ''}`}>
      <div className="logo">Kira</div>
      <div className="nav-links">
        <a href="#home">Home</a>
        <a href="#work">Work</a>
        <a href="#about">About</a>
        <a href="#contact">Contact</a>
      </div>
    </nav>
  );
}
