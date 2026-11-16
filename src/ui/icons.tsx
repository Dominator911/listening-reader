// Small inline icon set (stroke icons, currentColor).
import type { ReactNode, SVGProps } from 'react';

function Svg({ children, ...p }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      {children}
    </svg>
  );
}

export const Play = () => (
  <Svg>
    <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none" />
  </Svg>
);
export const Pause = () => (
  <Svg>
    <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
  </Svg>
);
export const SentenceBack = () => (
  <Svg>
    <path d="M15 6l-6 6 6 6" />
  </Svg>
);
export const SentenceFwd = () => (
  <Svg>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);
export const ParaBack = () => (
  <Svg>
    <path d="M12 6l-6 6 6 6M18 6l-6 6 6 6" />
  </Svg>
);
export const ParaFwd = () => (
  <Svg>
    <path d="M6 6l6 6-6 6M12 6l6 6-6 6" />
  </Svg>
);
export const ChapterBack = () => (
  <Svg>
    <path d="M6 5v14" />
    <path d="M18 5L9 12l9 7z" fill="currentColor" />
  </Svg>
);
export const ChapterFwd = () => (
  <Svg>
    <path d="M18 5v14" />
    <path d="M6 5l9 7-9 7z" fill="currentColor" />
  </Svg>
);
export const ListIcon = () => (
  <Svg>
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </Svg>
);
export const Gear = () => (
  <Svg>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
);
export const Back = () => (
  <Svg>
    <path d="M15 18l-6-6 6-6" />
  </Svg>
);
export const BookmarkIcon = ({ filled }: { filled?: boolean }) => (
  <Svg>
    <path d="M6 3h12v18l-6-4-6 4z" fill={filled ? 'currentColor' : 'none'} />
  </Svg>
);
export const Moon = () => (
  <Svg>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Svg>
);
export const Plus = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const Close = () => (
  <Svg>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const More = () => (
  <Svg>
    <circle cx="5" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="19" cy="12" r="1.2" fill="currentColor" />
  </Svg>
);
export const Target = () => (
  <Svg>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2" fill="currentColor" />
  </Svg>
);
