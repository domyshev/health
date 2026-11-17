const stars = [
  [12, 10, 3], [86, 13, 2], [72, 2, 1.5], [97, 48, 2.5],
  [5, 57, 1.6], [91, 86, 2], [24, 96, 2],
] as const

export function GoldStars() {
  return <svg aria-hidden="true" viewBox="0 0 100 100" width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
    {stars.map(([x, y, r]) => <path key={`${x}-${y}`} transform={`translate(${x} ${y})`} d={`M0 ${-r * 1.6} Q${r * 0.25} ${-r * 0.25} ${r} 0 Q${r * 0.25} ${r * 0.25} 0 ${r * 1.6} Q${-r * 0.25} ${r * 0.25} ${-r} 0 Q${-r * 0.25} ${-r * 0.25} 0 ${-r * 1.6}`} fill="#d5a43e" />)}
  </svg>
}
