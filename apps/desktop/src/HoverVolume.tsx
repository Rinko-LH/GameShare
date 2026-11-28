import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes } from 'react';
import { ViewerIcon } from './ViewerIcon';
import './hover-volume.css';

export type VolumeChannel = 'voice' | 'share';

export function HoverVolume({ channel, button, muted, value, label, disabled, onChange }: {
  channel: VolumeChannel;
  button: ButtonHTMLAttributes<HTMLButtonElement> & { 'data-viewer-action'?: string; 'data-float-action'?: string };
  muted: boolean;
  value: number;
  label: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const percent = Math.round(value * 100);

  const show = () => {
    const surface = panel.current;
    const anchor = trigger.current;
    if (!surface || !anchor || surface.matches(':popover-open')) return;
    const rect = anchor.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const above = rect.top >= 128 || rect.top > below;
    surface.style.maxHeight = `${Math.max(0, above ? rect.top : below)}px`;
    surface.showPopover();
    const { offsetWidth: width, offsetHeight: height } = surface;
    const top = above ? rect.top - height : rect.bottom;
    const left = Math.max(0, Math.min(window.innerWidth - width, rect.left + (rect.width - width) / 2));
    surface.style.top = `${top}px`;
    surface.style.left = `${left}px`;
    setOpen(true);
  };

  const hide = () => {
    panel.current?.hidePopover();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [open]);

  return (
    <div className="hover-volume"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={(event) => { if (event.target.matches(':focus-visible')) show(); }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && !event.currentTarget.matches(':hover')) hide();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.preventDefault();
        trigger.current?.focus();
        hide();
      }}>
      <button {...button} ref={trigger} type="button" aria-controls={panelId} aria-expanded={open}>
        <ViewerIcon name={channel === 'voice' ? 'voice' : 'speaker'} off={muted} />
      </button>
      <div id={panelId} className="hover-volume__panel"
        ref={(node) => { panel.current = node; node?.setAttribute('popover', 'manual'); }}>
        <span aria-hidden="true">{percent}%</span>
        <input data-volume-channel={channel} type="range" min={0} max={100} step={5} value={percent}
          aria-label={label} aria-orientation="vertical" aria-valuetext={`${percent}%`} disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value) / 100)} />
      </div>
    </div>
  );
}
