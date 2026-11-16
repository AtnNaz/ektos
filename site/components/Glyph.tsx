const A = '#FF6F5E', B = '#5BB5FF', S = '#E9B44C';

export function Glyph({ i }: { i: number }) {
  const common = { className: 'glyph', viewBox: '0 0 88 52', fill: 'none', 'aria-hidden': true } as const;
  switch (i) {
    case 0:
      return (
        <svg {...common}>
          <g fill="currentColor"><circle cx="12" cy="12" r="1.6" /><circle cx="70" cy="40" r="1.6" /><circle cx="60" cy="10" r="1.6" /><circle cx="20" cy="42" r="1.6" /></g>
          <circle cx="36" cy="27" r="4.5" fill={A} /><circle cx="52" cy="24" r="4.5" fill={B} />
        </svg>
      );
    case 1:
      return (
        <svg {...common}>
          <defs><linearGradient id="lvf" x1="0" x2="1"><stop offset="0" stopColor={B} /><stop offset="0.5" stopColor={S} /><stop offset="1" stopColor={A} /></linearGradient></defs>
          <rect x="6" y="16" width="76" height="20" fill="url(#lvf)" opacity="0.5" />
          <circle cx="22" cy="26" r="3" fill="#E8ECF4" /><circle cx="46" cy="26" r="3" fill="#E8ECF4" /><circle cx="68" cy="26" r="3" fill="#E8ECF4" />
        </svg>
      );
    case 2:
      return (
        <svg {...common}>
          <circle cx="20" cy="26" r="7" stroke="currentColor" /><circle cx="20" cy="26" r="2" fill="currentColor" />
          <path d="M33 26h10" stroke="currentColor" /><path d="M38 21v10" stroke="currentColor" opacity="0" />
          <circle cx="62" cy="26" r="7" stroke="currentColor" strokeDasharray="2 3" /><circle cx="62" cy="26" r="4" fill={S} />
        </svg>
      );
    case 3:
      return (
        <svg {...common}>
          <path d="M4 34h80" stroke="currentColor" strokeDasharray="3 4" />
          <path d="M6 34c8 0 10-14 16-14s4 14-2 14 8 0 14 0 10-14 16-14 4 14-2 14 8 0 14 0 10-14 16-14" stroke={S} strokeWidth="1.4" />
          <circle cx="8" cy="34" r="3" fill={A} /><circle cx="80" cy="20" r="3" fill={B} />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="8" y="10" width="30" height="32" stroke={A} /><rect x="50" y="10" width="30" height="32" stroke={B} />
          <circle cx="20" cy="26" r="2.6" fill={A} /><circle cx="68" cy="26" r="2.6" fill={B} />
          <g fill="currentColor"><circle cx="30" cy="18" r="1.4" /><circle cx="72" cy="18" r="1.4" /><circle cx="14" cy="36" r="1.4" /><circle cx="56" cy="36" r="1.4" /></g>
        </svg>
      );
  }
}
