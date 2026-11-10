import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Grid,
  Stack,
  Typography,
} from '@mui/material'
import { Link as RouterLink, useParams } from 'react-router-dom'

import { useGetActivityQuery, type Activity } from '../../api/healthApi'
import { ActivityIcon } from './ActivityIcon'

function formatDuration(seconds: number) {
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainder = total % 60
  return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', `${remainder}s`].filter(Boolean).join(' ')
}

function formatDistance(metres: number) {
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`
}

function formatPace(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, '0')} /100m`
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Grid size={{ xs: 6, sm: 4 }}>
      <Typography color="text.secondary" variant="caption">{label}</Typography>
      <Typography sx={{ fontWeight: 700 }}>{value}</Typography>
    </Grid>
  )
}

function metrics(activity: Activity) {
  const values: Array<[string, string]> = []
  if (activity.distanceM !== undefined) values.push(['Distance', formatDistance(activity.distanceM)])
  if (activity.durationS !== undefined) values.push(['Duration', formatDuration(activity.durationS)])
  if (activity.movingDurationS !== undefined) values.push(['Moving time', formatDuration(activity.movingDurationS)])
  if (activity.elapsedDurationS !== undefined) values.push(['Elapsed time', formatDuration(activity.elapsedDurationS)])
  if (activity.caloriesKcal !== undefined) values.push(['Calories', `${Math.round(activity.caloriesKcal)} kcal`])
  if (activity.averageHrBpm !== undefined) values.push(['Average heart rate', `${Math.round(activity.averageHrBpm)} bpm`])
  if (activity.maxHrBpm !== undefined) values.push(['Maximum heart rate', `${Math.round(activity.maxHrBpm)} bpm`])
  if (activity.poolLengthM !== undefined) values.push(['Pool length', `${activity.poolLengthM} m`])
  if (activity.averagePacePer100mS !== undefined) values.push(['Average pace', formatPace(activity.averagePacePer100mS)])
  if (activity.activeLengths !== undefined) values.push(['Active lengths', String(activity.activeLengths)])
  if (activity.lapCount !== undefined) values.push(['Laps', String(activity.lapCount)])
  if (activity.totalStrokes !== undefined) values.push(['Total strokes', String(activity.totalStrokes)])
  if (activity.averageStrokesPerLength !== undefined) values.push(['Strokes per length', activity.averageStrokesPerLength.toFixed(1)])
  if (activity.averageSwolf !== undefined) values.push(['Average SWOLF', activity.averageSwolf.toFixed(1)])
  return values
}

export function ActivityDetailsPage() {
  const { activityId = '' } = useParams()
  const { data: activity, isError, isLoading, refetch } = useGetActivityQuery(activityId, { skip: !activityId })

  if (isLoading) return <CircularProgress aria-label="Loading activity" />
  if (isError || !activity) {
    return <Alert action={<Button onClick={() => void refetch()}>Retry</Button>} severity="error">Activity could not be loaded.</Alert>
  }

  const activityMetrics = metrics(activity)
  return (
    <Box component="section">
      <Button component={RouterLink} startIcon={<ArrowBackRounded />} to="/">Back to activities</Button>
      <Stack spacing={1} sx={{ mt: 3, mb: 3 }}>
        <Box component="h1" sx={{ m: 0 }}><ActivityIcon activity={activity} detail /></Box>
        <Typography color="text.secondary">
          {activity.startedAt ? new Date(activity.startedAt).toLocaleString() : 'Date unavailable'}
        </Typography>
        <Typography color="text.secondary">
          {[activity.type.replace('_', ' '), activity.sourceType?.replaceAll('_', ' '), activity.swimEnvironment?.replace('_', ' ')].filter(Boolean).join(' · ')}
        </Typography>
      </Stack>
      <Card>
        <CardContent>
          {activityMetrics.length ? (
            <Grid container spacing={3}>
              {activityMetrics.map(([label, value]) => <Metric key={label} label={label} value={value} />)}
            </Grid>
          ) : (
            <Typography color="text.secondary">No additional metrics are available for this activity.</Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}
