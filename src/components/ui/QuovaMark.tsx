export function QuovaMark({ size = 44 }: { size?: number }) {
  return (
    <img
      src="/quova-icon.png"
      alt="Quova"
      width={size}
      height={size}
      style={{ margin: '0 auto', display: 'block', objectFit: 'contain' }}
    />
  )
}

// Backward-compatible alias
export { QuovaMark as OrbitMark }
