import { Box, Chip, SvgIcon, type SvgIconProps } from '@mui/material'
import CheckBoxRounded from '@mui/icons-material/CheckBoxRounded'
import CheckBoxOutlineBlankRounded from '@mui/icons-material/CheckBoxOutlineBlankRounded'
import DirectionsRunRounded from '@mui/icons-material/DirectionsRunRounded'
import DirectionsBikeRounded from '@mui/icons-material/DirectionsBikeRounded'
import DirectionsWalkRounded from '@mui/icons-material/DirectionsWalkRounded'
import PoolRounded from '@mui/icons-material/PoolRounded'
import FitnessCenterRounded from '@mui/icons-material/FitnessCenterRounded'
import MonitorHeartRounded from '@mui/icons-material/MonitorHeartRounded'
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded'
import AppsRounded from '@mui/icons-material/AppsRounded'

function EllipticalIcon(props: SvgIconProps) {
  return <SvgIcon {...props} viewBox="0 0 64 48">
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3">
      <circle cx="32" cy="6" r="3" fill="currentColor" />
      <path d="m31 11-5 10 10 5 5 9m-11-22 8 6 6-4m-17 7-7 12m-4-9 8 15M14 40h36M25 40l10-5 10 5M46 10l4 30M14 21l3 19" />
      <ellipse cx="39" cy="40" rx="13" ry="4" />
    </g>
  </SvgIcon>
}

const filters = [
  { type: 'all', label: 'All', Icon: AppsRounded },
  { type: 'running', label: 'Running', Icon: DirectionsRunRounded },
  { type: 'cycling', label: 'Cycling', Icon: DirectionsBikeRounded },
  { type: 'walking', label: 'Walking', Icon: DirectionsWalkRounded },
  { type: 'swimming', label: 'Swimming', Icon: PoolRounded },
  { type: 'strength', label: 'Strength', Icon: FitnessCenterRounded },
  { type: 'cardio', label: 'Cardio', Icon: MonitorHeartRounded },
  { type: 'elliptical', label: 'Elliptical', Icon: EllipticalIcon },
  { type: 'other', label: 'Other', Icon: MoreHorizRounded },
]

export function ActivityFilters({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = value === 'all' ? [] : value.split(',')
  function toggle(type: string) {
    if (type === 'all') { onChange('all'); return }
    const next = selected.includes(type) ? selected.filter((item) => item !== type) : [...selected, type]
    onChange(filters.filter((item) => next.includes(item.type)).map((item) => item.type).join(',') || 'all')
  }
  return <Box role="group" aria-label="Activity types" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, overflowX: 'auto', minWidth: 0, py: 0.5, scrollbarWidth: 'thin' }}>
    {filters.map(({ type, label, Icon }) => {
      const checked = type === 'all' ? selected.length === 0 : selected.includes(type)
      return <Chip key={type} component="button" type="button" role="checkbox" aria-checked={checked} aria-label={label} onClick={() => toggle(type)} variant={checked ? 'filled' : 'outlined'} color={checked ? 'primary' : 'default'} icon={<Icon fontSize="small" />} label={<Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>{label}{checked ? <CheckBoxRounded sx={{ fontSize: 16 }} /> : <CheckBoxOutlineBlankRounded sx={{ fontSize: 16, opacity: 0.55 }} />}</Box>} sx={{ flexShrink: 0, cursor: 'pointer', height: 34, ...(checked ? { bgcolor: '#a51d43', color: '#fff', '&:hover': { bgcolor: '#891735' } } : {}), '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }} />
    })}
  </Box>
}
