import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link as RouterLink } from 'react-router-dom'
import AccessTimeRounded from '@mui/icons-material/AccessTimeRounded'
import FavoriteRounded from '@mui/icons-material/FavoriteRounded'
import LocalFireDepartmentRounded from '@mui/icons-material/LocalFireDepartmentRounded'
import StraightenRounded from '@mui/icons-material/StraightenRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Grid,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'

import {
  useGetActivitiesQuery,
  useLazyGetActivitiesQuery,
  type Activity,
} from '../../api/healthApi'
import { setActivityType, type AppDispatch, type RootState } from '../../store'

const activityTypes = ['all', 'running', 'cycling', 'walking', 'swimming', 'strength', 'other']

function duration(seconds?: number) {
  if (seconds === undefined) return '—'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours ? `${hours}h ${minutes}m` : `${minutes} min`
}

function distance(metres?: number) {
  return metres === undefined ? '—' : `${(metres / 1000).toFixed(2)} km`
}

function pace(seconds?: number) {
  if (seconds === undefined) return undefined
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, '0')} /100m`
}

function ActivityCard({ activity }: { activity: Activity }) {
  return (
    <Card sx={{ height: '100%', borderRadius: 4 }}>
      <CardActionArea component={RouterLink} sx={{ height: '100%', p: 0.5 }} to={`/activities/${activity.id}`}>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Box>
                <Typography color="text.secondary" variant="caption">
                  {activity.startedAt ? new Date(activity.startedAt).toLocaleString() : 'Date unavailable'}
                </Typography>
                <Typography component="h2" sx={{ fontWeight: 750 }} variant="h6">
                  {activity.name || activity.type}
                </Typography>
              </Box>
              <Chip color="primary" label={activity.type.replace('_', ' ')} size="small" variant="outlined" />
            </Stack>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2.5 }}>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                <StraightenRounded color="action" fontSize="small" />
                <Typography>{distance(activity.distanceM)}</Typography>
              </Stack>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                <AccessTimeRounded color="action" fontSize="small" />
                <Typography>{duration(activity.durationS)}</Typography>
              </Stack>
              {activity.averageHrBpm !== undefined && (
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                  <FavoriteRounded color="error" fontSize="small" />
                  <Typography>{Math.round(activity.averageHrBpm)} bpm</Typography>
                </Stack>
              )}
              {activity.caloriesKcal !== undefined && (
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                  <LocalFireDepartmentRounded color="warning" fontSize="small" />
                  <Typography>{Math.round(activity.caloriesKcal)} kcal</Typography>
                </Stack>
              )}
            </Stack>
            {activity.type === 'swimming' && (activity.swimEnvironment || activity.averagePacePer100mS !== undefined) && (
              <Typography color="text.secondary" variant="body2">
                {[activity.swimEnvironment?.replace('_', ' '), pace(activity.averagePacePer100mS)].filter(Boolean).join(' · ')}
              </Typography>
            )}
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

export function ActivitiesPage() {
  const dispatch = useDispatch<AppDispatch>()
  const type = useSelector((state: RootState) => state.ui.activityType)
  const [additional, setAdditional] = useState<Activity[]>([])
  const sentinelRef = useRef<HTMLDivElement>(null)
  const { data, isError, isLoading, refetch } = useGetActivitiesQuery({ type })
  const [loadPage, nextPageState] = useLazyGetActivitiesQuery()


  const activities = useMemo(() => {
    const unique = new Map<string, Activity>()
    for (const activity of [...(data?.items ?? []), ...additional]) unique.set(activity.id, activity)
    return [...unique.values()]
  }, [additional, data?.items])
  const cursor = nextPageState.data?.nextCursor ?? data?.nextCursor

  const loadMore = useCallback(async () => {
    if (!cursor || nextPageState.isFetching) return
    try {
      const next = await loadPage({ type, cursor }).unwrap()
      setAdditional((items) => [...items, ...next.items])
    } catch {
      // The inline retry state keeps already loaded activities visible.
    }
  }, [cursor, loadPage, nextPageState.isFetching, type])

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !cursor || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !nextPageState.isFetching) void loadMore()
    }, { rootMargin: '240px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [cursor, loadMore, nextPageState.isFetching])

  return (
    <Box component="section">
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography component="h1" variant="h1">Activities</Typography>
          <Typography color="text.secondary">A focused record of every imported workout.</Typography>
        </Box>
        <TextField
          label="Activity type"
          onChange={(event) => {
            setAdditional([])
            dispatch(setActivityType(event.target.value))
          }}
          select
          size="small"
          sx={{ minWidth: 190 }}
          value={type}
        >
          {activityTypes.map((item) => (
            <MenuItem key={item} value={item}>{item === 'all' ? 'All activities' : item}</MenuItem>
          ))}
        </TextField>
      </Stack>

      {isLoading && (
        <Grid container spacing={2}>
          {[0, 1, 2].map((item) => <Grid key={item} size={{ xs: 12, md: 6 }}><Skeleton height={180} variant="rounded" /></Grid>)}
        </Grid>
      )}
      {isError && <Alert action={<Button onClick={() => void refetch()}>Retry</Button>} severity="error">Activities could not be loaded.</Alert>}
      {!isLoading && !isError && activities.length === 0 && (
        <Card sx={{ p: 5, textAlign: 'center' }}><Typography variant="h6">No activities yet</Typography><Typography color="text.secondary">Connect Garmin and run your first sync.</Typography></Card>
      )}
      <Grid container spacing={2}>
        {activities.map((activity) => <Grid key={activity.id} size={{ xs: 12, md: 6 }}><ActivityCard activity={activity} /></Grid>)}
      </Grid>
      {nextPageState.isError && <Alert severity="error" sx={{ mt: 2 }}>The next page could not be loaded. Your current activities are still here.</Alert>}
      {cursor && (
        <Box ref={sentinelRef} sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Button loading={nextPageState.isFetching} onClick={() => void loadMore()} variant="outlined">Load more</Button>
        </Box>
      )}
    </Box>
  )
}
