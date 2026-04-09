export function OrbitMark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" fill="none" style={{ margin: '0 auto', display: 'block' }}>
      <circle cx="22" cy="22" r="7" fill="#00c8a0" />
      <ellipse cx="22" cy="22" rx="18" ry="9" stroke="#00c8a0" strokeWidth="2" fill="none" opacity="0.5" />
      <ellipse cx="22" cy="22" rx="18" ry="9" stroke="#00c8a0" strokeWidth="2" fill="none" opacity="0.5" transform="rotate(60 22 22)" />
      <ellipse cx="22" cy="22" rx="18" ry="9" stroke="#00c8a0" strokeWidth="2" fill="none" opacity="0.5" transform="rotate(120 22 22)" />
    </svg>
  )
}
