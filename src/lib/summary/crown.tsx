// VIP crown, drawn as plain SVG shapes (no emoji, no gradients) so it looks
// the same in the browser capture (SummarySheet) and in satori (LINE picture).
// Sized to sit ON the customer's head: centred over the top edge of the photo.
export function Crown({ w = 64 }: { w?: number }) {
  const h = Math.round((w * 76) / 108);
  const edge = "#b45309";
  return (
    <svg width={w} height={h} viewBox="-4 -6 108 76" xmlns="http://www.w3.org/2000/svg">
      {/* white sticker outline */}
      <path d="M8 56 L4 18 L28 36 L50 6 L72 36 L96 18 L92 56 Z" fill="#ffffff" stroke="#ffffff" strokeWidth="10" strokeLinejoin="round" />
      <rect x="6" y="50" width="88" height="16" rx="6" fill="#ffffff" stroke="#ffffff" strokeWidth="8" />
      {/* body */}
      <path d="M8 56 L4 18 L28 36 L50 6 L72 36 L96 18 L92 56 Z" fill="#fbbf24" stroke={edge} strokeWidth="3" strokeLinejoin="round" />
      <path d="M13 50 L10 27 L28 41 L50 14 L50 50 Z" fill="#fde68a" />
      {/* band */}
      <rect x="6" y="50" width="88" height="16" rx="6" fill="#f59e0b" stroke={edge} strokeWidth="3" />
      {/* points */}
      <circle cx="4" cy="17" r="6.5" fill="#fde047" stroke={edge} strokeWidth="3" />
      <circle cx="50" cy="5" r="7.5" fill="#fde047" stroke={edge} strokeWidth="3" />
      <circle cx="96" cy="17" r="6.5" fill="#fde047" stroke={edge} strokeWidth="3" />
      {/* jewels */}
      <circle cx="50" cy="58" r="5" fill="#ec4899" stroke="#9d174d" strokeWidth="1.5" />
      <circle cx="27" cy="58" r="3.8" fill="#38bdf8" stroke="#075985" strokeWidth="1.5" />
      <circle cx="73" cy="58" r="3.8" fill="#38bdf8" stroke="#075985" strokeWidth="1.5" />
      <circle cx="50" cy="34" r="4.5" fill="#f43f5e" stroke="#9f1239" strokeWidth="1.5" />
    </svg>
  );
}
