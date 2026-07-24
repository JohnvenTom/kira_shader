/**
 * 顶部导航组件
 *
 * 功能：固定在顶部的极简导航栏，包含 logo 与若干锚点链接
 *
 * 参数：无
 * 返回值：React.ReactElement
 * 异常：无
 */
export function NavBar() {
  return (
    <nav className="nav-bar">
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
