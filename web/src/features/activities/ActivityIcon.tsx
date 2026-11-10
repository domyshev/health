import DirectionsRunRounded from '@mui/icons-material/DirectionsRunRounded'
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded'
import MonitorHeartRounded from '@mui/icons-material/MonitorHeartRounded'
import { Box, Tooltip } from '@mui/material'

import swimmingImage from '../../assets/activities/swimming.png'
import walkingImage from '../../assets/activities/walking.png'
import strengthImage from '../../assets/activities/strength.png'
import poolImage from '../../assets/activities/pool.png'
import type { Activity } from '../../api/healthApi'

const images: Record<string, string> = {
  swimming: swimmingImage,
  walking: walkingImage,
  strength: strengthImage,
}

export function ActivityIcon({ activity, detail = false }: { activity: Activity; detail?: boolean }) {
  const name = activity.name || activity.type.replaceAll('_', ' ')
  const image = activity.type === 'swimming' && activity.swimEnvironment === 'pool' ? poolImage : images[activity.type]

  return (
    <Tooltip title={name}>
      <Box
        aria-label={name}
        component="span"
        role="img"
        tabIndex={detail ? 0 : undefined}
        sx={{ alignItems: 'center', backgroundColor: '#f3f4ef', borderRadius: 2.5, color: '#111', display: 'inline-flex', flexShrink: 0, height: detail ? 54 : 42, justifyContent: 'center', p: 0.75, verticalAlign: 'middle', width: detail ? 72 : 56 }}
      >
        {activity.type === 'cycling' ? (
          <Box aria-hidden="true" component="svg" viewBox="0 0 80 48" sx={{ height: '100%', width: '100%' }}>
            <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4">
              <circle cx="17" cy="34" r="11" /><circle cx="63" cy="34" r="11" />
              <path d="M17 34 29 16 40 34H17l17-14h18l11 14M40 34 29 16m-4 0h8m19 4-3-9h6l3 3M36 34h8" />
            </g>
          </Box>
        ) : image ? (
          <Box alt="" component="img" src={image} sx={{ filter: 'brightness(0)', height: '100%', objectFit: 'contain', width: '100%' }} />
        ) : activity.type === 'running' ? <DirectionsRunRounded aria-hidden="true" /> : activity.type === 'other' ? <MonitorHeartRounded aria-hidden="true" /> : <MoreHorizRounded aria-hidden="true" />}
      </Box>
    </Tooltip>
  )
}
