import React from 'react';
import { ShieldGlyph } from './Icons';

interface Props {
  onDone: () => void;
}

/** 首次启动简介页：仅第一次打开显示，跳过后不再出现 */
export const IntroOverlay: React.FC<Props> = ({ onDone }) => {
  return (
    <div className="intro-overlay">
      <button className="intro-skip glass-btn" onClick={onDone}>跳过</button>
      <div className="intro-card glass-panel">
        <img className="intro-hero" src="./intro-hero.png" alt="" draggable={false} />
        <div className="intro-body">
          <div className="intro-head">
            <div className="intro-logo"><ShieldGlyph size={30} /></div>
            <div>
              <h1 className="intro-title">安全传输</h1>
              <p className="intro-sub">局域网里的加密聊天与文件传输，不经过任何服务器。</p>
            </div>
          </div>
          <ul className="intro-list">
            <li><b>端到端加密</b>——文字和文件全程加密，密钥只在两端手里。</li>
            <li><b>点对点直连</b>——同一网络自动发现设备，跨网段填 ID 和端口就能连。</li>
            <li><b>离线也能发</b>——对方不在线时消息先存本机，上线后自动补发。</li>
          </ul>
          <p className="intro-foot">加密强度、自定义密钥，之后都能在「设置」里改。</p>
          <button className="btn btn-primary intro-start" onClick={onDone}>开始使用</button>
        </div>
      </div>
    </div>
  );
};
