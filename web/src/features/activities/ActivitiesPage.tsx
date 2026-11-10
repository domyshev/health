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
import { ActivityIcon } from './ActivityIcon'

const activityTypes = ['all', 'running', 'cycling', 'walking', 'swimming', 'strength', 'other']

function duration(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours ? `${hours}h ${minutes}m` : `${minutes} min`
}

function distance(metres: number) {
  return `${(metres / 1000).toFixed(2)} km`
}

function pace(seconds?: number) {
  if (seconds === undefined) return undefined
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, '0')} /100m`
}

function ActivityCard({ activity }: { activity: Activity }) {
  return (
    <Card sx={{ height: '100%', borderRadius: '16px' }}>
      <CardActionArea component={RouterLink} sx={{ height: '100%', p: 0.5 }} to={`/activities/${activity.id}`}>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <ActivityIcon activity={activity} />
              <Typography color="text.secondary" sx={{ textAlign: 'right' }} variant="caption">
                {activity.startedAt ? new Date(activity.startedAt).toLocaleString() : 'Date unavailable'}
              </Typography>
            </Stack>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2.5 }}>
              {activity.distanceM !== undefined && (
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                  <StraightenRounded color="action" fontSize="small" />
                  <Typography>{distance(activity.distanceM)}</Typography>
                </Stack>
              )}
              {activity.durationS !== undefined && (
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                  <AccessTimeRounded color="action" fontSize="small" />
                  <Typography>{duration(activity.durationS)}</Typography>
                </Stack>
              )}
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
  const [pagination, setPagination] = useState<{
    baseKey: string
    items: Activity[]
    nextCursor?: string
  }>({ baseKey: '', items: [] })
  const sentinelRef = useRef<HTMLDivElement>(null)
  const { currentData: data, isError, isLoading, refetch } = useGetActivitiesQuery({ type })
  const [loadPage, nextPageState] = useLazyGetActivitiesQuery()
  const baseKey = `${data?.items[0]?.id ?? ''}:${data?.nextCursor ?? ''}`
  const additional = useMemo(
    () => pagination.baseKey === baseKey ? pagination.items : [],
    [baseKey, pagination.baseKey, pagination.items],
  )
  const nextCursor = pagination.baseKey === baseKey
    ? pagination.nextCursor
    : data?.nextCursor || undefined

  const activities = useMemo(() => {
    const seen = new Set<string>()
    return [...(data?.items ?? []), ...additional].filter((activity) => {
      if (seen.has(activity.id)) return false
      seen.add(activity.id)
      return true
    })
  }, [additional, data?.items])

  const loadMore = useCallback(async () => {
    if (!nextCursor || nextPageState.isFetching) return
    try {
      const next = await loadPage({ type, cursor: nextCursor }).unwrap()
      setPagination({
        baseKey,
        items: [...additional, ...next.items],
        nextCursor: next.nextCursor || undefined,
      })
    } catch {
      // The inline retry state keeps already loaded activities visible.
    }
  }, [additional, baseKey, loadPage, nextCursor, nextPageState.isFetching, type])

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !nextCursor || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !nextPageState.isFetching) void loadMore()
    }, { rootMargin: '240px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [loadMore, nextCursor, nextPageState.isFetching])

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
            setPagination({ baseKey: '', items: [] })
            nextPageState.reset()
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
        <Card sx={{ p: 5, textAlign: 'center' }}>
          <Typography component="h2" variant="h6">{type === 'all' ? 'No activities yet' : `No ${type} activities`}</Typography>
          <Typography color="text.secondary">
            {type === 'all' ? 'Connect Garmin and run your first sync.' : 'Choose another filter or run a new sync.'}
          </Typography>
        </Card>
      )}
      <Grid container spacing={2}>
        {activities.map((activity) => <Grid key={activity.id} size={{ xs: 12, md: 6 }}><ActivityCard activity={activity} /></Grid>)}
      </Grid>
      {nextPageState.isError && <Alert severity="error" sx={{ mt: 2 }}>The next page could not be loaded. Your current activities are still here.</Alert>}
      {nextCursor && (
        <Box ref={sentinelRef} sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Button loading={nextPageState.isFetching} onClick={() => void loadMore()} variant="outlined">Load more</Button>
        </Box>
      )}
    </Box>
  )
}
