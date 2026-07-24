import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

/**
 * 应用入口
 * 功能：将根组件 App 挂载到 #root 节点
 * 参数：无
 * 返回值：无
 * 异常：若 #root 不存在会抛出 TypeError
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
