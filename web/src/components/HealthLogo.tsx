import PoolRounded from '@mui/icons-material/PoolRounded'
import { Box } from '@mui/material'

const stars = [
  [12, 10, 3], [86, 13, 2], [72, 2, 1.5], [97, 48, 2.5],
  [5, 57, 1.6], [91, 86, 2], [24, 96, 2],
] as const

export function HealthLogo({ size = 36 }: { size?: number }) {
  return <Box role="img" aria-label="Health logo" sx={{ width: size, height: size, flexShrink: 0, position: 'relative', color: 'text.primary' }}>
    <svg aria-hidden="true" viewBox="0 0 100 100" width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
      {stars.map(([x, y, r]) => <path key={`${x}-${y}`} transform={`translate(${x} ${y})`} d={`M0 ${-r * 1.6} Q${r * 0.25} ${-r * 0.25} ${r} 0 Q${r * 0.25} ${r * 0.25} 0 ${r * 1.6} Q${-r * 0.25} ${r * 0.25} ${-r} 0 Q${-r * 0.25} ${-r * 0.25} 0 ${-r * 1.6}`} fill="#d5a43e" />)}
    </svg>
    <PoolRounded sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', color: 'inherit' }} />
  </Box>
}
