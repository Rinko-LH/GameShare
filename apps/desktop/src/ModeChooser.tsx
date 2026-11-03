import { CONNECTION_MODES, type ConnectionMode } from './connection-modes';

export function ModeChooser({ onSelect, onCancel }: { onSelect: (mode: ConnectionMode) => void; onCancel?: () => void }) {
  return <div className="mode-chooser" role="dialog" aria-modal="true" aria-labelledby="mode-title">
    <div className="mode-chooser__content">
      <span className="mode-chooser__eyebrow">开始共享之前</span>
      <h2 id="mode-title">你和朋友怎样连接？</h2>
      <p className="hint">按你们的网络环境选择。我们会记住选择，你也可以随时切换。</p>
      <div className="mode-chooser__grid">
        {CONNECTION_MODES.map((mode, index) => <button key={mode.id} type="button" className="mode-card" onClick={() => onSelect(mode.id)}>
          <span className="mode-card__number">0{index + 1}</span>
          <strong>{mode.name}</strong><span>{mode.description}</span><span className="mode-card__action">使用这个模式 →</span>
        </button>)}
      </div>
      <p className="hint hint--dim">不知道选哪个？同一个家里选“本地局域网”；已在 UU 房间里选“UU 云联机”；其他情况可尝试 Cloudflare 异地连接。</p>
      {onCancel && <button className="btn" type="button" onClick={onCancel}>返回当前模式</button>}
    </div>
  </div>;
}
