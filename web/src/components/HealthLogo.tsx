import PoolRounded from '@mui/icons-material/PoolRounded'
import { Box } from '@mui/material'
import { GoldStars } from './GoldStars'

export function HealthLogo({ size = 36 }: { size?: number }) {
  return <Box role="img" aria-label="Health logo" sx={{ width: size, height: size, flexShrink: 0, position: 'relative', color: 'text.primary' }}>
    <GoldStars />
    <PoolRounded sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', color: 'inherit' }} />
  </Box>
}
