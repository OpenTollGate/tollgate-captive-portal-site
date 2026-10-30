export default function CobradorMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      class="cobrador-mark"
    >
      <path d="M3 25c4-5 8-7 13-7s9 2 13 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <path d="M13 25h6l-1.2-10h-3.6z" fill="currentColor" />
      <rect x="12" y="11" width="8" height="2" rx="1" fill="currentColor" />
      <path d="M13.4 11l1.2-3.2h3l1.2 3.2z" fill="currentColor" />
      <rect x="14.8" y="6.8" width="2.4" height="1.8" rx=".5" fill="currentColor" />
      <path d="M16 6.8V4.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      <path d="M16 9L6 6.5l2.4 2.5L6 11.5zM16 9l10-2.5-2.4 2.5 2.4 2.5z" fill="currentColor" opacity=".45" />
    </svg>
  );
}
