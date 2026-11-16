import PoolRounded from '@mui/icons-material/PoolRounded'
import { Box } from '@mui/material'

const stars = [
  [18, 18, 2.3], [39, 10, 1.6], [63, 13, 2.6], [81, 27, 1.8],
  [88, 51, 2.5], [80, 75, 1.5], [62, 88, 2.2], [37, 87, 1.6],
  [16, 73, 2.5], [10, 47, 1.6], [29, 32, 1.2], [69, 37, 1.2],
] as const

export function HealthLogo({ size = 36 }: { size?: number }) {
  return <Box role="img" aria-label="Health logo" sx={{ width: size, height: size, flexShrink: 0, position: 'relative', color: 'text.primary' }}>
    <svg aria-hidden="true" viewBox="0 0 100 100" width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
      {stars.map(([x, y, r]) => <path key={`${x}-${y}`} transform={`translate(${x} ${y})`} d={`M0 ${-r * 1.6} Q${r * 0.25} ${-r * 0.25} ${r} 0 Q${r * 0.25} ${r * 0.25} 0 ${r * 1.6} Q${-r * 0.25} ${r * 0.25} ${-r} 0 Q${-r * 0.25} ${-r * 0.25} 0 ${-r * 1.6}`} fill="currentColor" />)}
    </svg>
    <PoolRounded sx={{ position: 'absolute', inset: '22%', width: '56%', height: '56%', color: 'inherit' }} />
  </Box>
}
