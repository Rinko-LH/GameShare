import { CONNECTION_MODES, type ConnectionMode } from './connection-modes';

export function ModeChooser({ onSelect, onCancel }: { onSelect: (mode: ConnectionMode) => void; onCancel?: () => void }) {
  return <div className="mode-chooser" role="dialog" aria-modal="true" aria-labelledby="mode-title">
    <div className="mode-chooser__content">
      <span className="mode-chooser__eyebrow">开始共享之前</span>
      <h2 id="mode-title">你和朋友怎样连接？</h2>
      <p className="hint">按你们的网络环境选择。我们会记住选择，你也可以随时切换。</p>
      <div className="mode-chooser__grid">
        {CONNECTION_MODES.map((mode, index) => <button key={mode.id} type="button" className="mode-card" disabled={Boolean(mode.unavailable)} title={mode.unavailable} onClick={() => onSelect(mode.id)}>
          <span className="mode-card__number">0{index + 1}</span>
          <strong>{mode.name}</strong><span>{mode.description}</span><span className="mode-card__action">{mode.unavailable ?? '使用这个模式 →'}</span>
        </button>)}
      </div>
      <p className="hint hint--dim">同一网络或已完成 UU 组网选“IP 连接”；自备可达公网地址选“公网连接”；需要自动生成临时房间入口选“异地便捷连接”。</p>
      {onCancel && <button className="btn" type="button" onClick={onCancel}>返回当前模式</button>}
    </div>
  </div>;
}
