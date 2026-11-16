export function FlagGB() {
  return (
    <svg className="flag" viewBox="0 0 60 42" aria-hidden="true" preserveAspectRatio="none">
      <rect width="60" height="42" fill="#012169" />
      <path d="M0 0l60 42M60 0L0 42" stroke="#fff" strokeWidth="8" />
      <path d="M0 0l60 42M60 0L0 42" stroke="#C8102E" strokeWidth="3" />
      <path d="M30 0v42M0 21h60" stroke="#fff" strokeWidth="14" />
      <path d="M30 0v42M0 21h60" stroke="#C8102E" strokeWidth="8" />
    </svg>
  );
}

export function FlagTR() {
  return (
    <svg className="flag" viewBox="0 0 60 42" aria-hidden="true" preserveAspectRatio="none">
      <rect width="60" height="42" fill="#E30A17" />
      <circle cx="22" cy="21" r="10.5" fill="#fff" />
      <circle cx="24.6" cy="21" r="8.4" fill="#E30A17" />
      <path fill="#fff" d="M30.2 21l9.5-3.1-5.9 8.1v-10l5.9 8.1z" />
    </svg>
  );
}

export function Arrow() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2 8h11M9 4l4 4-4 4" />
    </svg>
  );
}
