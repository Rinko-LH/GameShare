import type { ReactNode } from 'react';

type ViewerIconName = 'voice' | 'speaker' | 'picture' | 'focus' | 'grid' | 'floating' | 'fullscreen';

const shapes: Record<ViewerIconName, ReactNode> = {
  voice: <>
    <rect x="6" y="1.75" width="4" height="8" rx="2" />
    <path d="M3.5 7.75v.5a4.5 4.5 0 0 0 9 0v-.5M8 12.75v1.5m-2 0h4" />
  </>,
  speaker: <path d="M6 5 9.5 2.5v11L6 11H3V5Zm6 1a3.25 3.25 0 0 1 0 4m1.5-5.5a5.5 5.5 0 0 1 0 7" />,
  picture: <path d="M1.75 3.25h12.5v8H1.75zM8 11.25v2m-3 0h6" />,
  focus: <>
    <rect x="2" y="2.5" width="12" height="7.5" rx="1" />
    <path d="M2.5 13.25h3m2.25 0h5.75" />
  </>,
  grid: <>
    <rect x="2" y="2" width="4.5" height="4.5" rx=".5" />
    <rect x="9.5" y="2" width="4.5" height="4.5" rx=".5" />
    <rect x="2" y="9.5" width="4.5" height="4.5" rx=".5" />
    <rect x="9.5" y="9.5" width="4.5" height="4.5" rx=".5" />
  </>,
  floating: <>
    <path d="M14.25 5.25v-2H1.75v9.5H5" />
    <rect x="7.25" y="7.25" width="7" height="5.5" rx=".75" />
  </>,
  fullscreen: <path d="M6 2.5H2.5V6m7.5-3.5h3.5V6m0 4v3.5H10m-4 0H2.5V10" />,
};

const offShapes: Partial<Record<ViewerIconName, ReactNode>> = {
  voice: <path d="M6 5.5V3.75a2 2 0 0 1 4 0v3m-4.9 2.2a4.5 4.5 0 0 0 7.4-.7v-.5M8 12.75v1.5m-2 0h4" />,
  speaker: <path d="M8.5 3.25 6.4 4.75m-2.65.5H3v5.5h3l3.5 2.5V10.5m0-8v3.75" />,
  picture: <path d="M5.25 3.25h9v7m-3 1H1.75v-7M8 11.25v2m-3 0h6" />,
};

export function ViewerIcon({ name, off = false, className }: { name: ViewerIconName; off?: boolean; className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {off ? (offShapes[name] ?? shapes[name]) : shapes[name]}
      {off && <path d="m2 2 12 12" />}
    </svg>
  );
}
