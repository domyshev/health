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

import { useGetActivityQuery } from '../../api/healthApi'
import { ActivityFieldSettings, useActivityFields } from './ActivityFieldSettings'
import { fieldLabels, fieldValue } from './activityFields'
import { ActivityIcon } from './ActivityIcon'

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Grid size={{ xs: 6, sm: 4 }}>
      <Typography color="text.secondary" variant="caption">{label}</Typography>
      <Typography sx={{ fontWeight: 700 }}>{value}</Typography>
    </Grid>
  )
}

export function ActivityDetailsPage() {
  const { activityId = '' } = useParams()
  const { data: activity, isError, isLoading, refetch } = useGetActivityQuery(activityId, { skip: !activityId })

  const { fields } = useActivityFields(activity?.type ?? 'other', 'detail')

  if (isLoading) return <CircularProgress aria-label="Loading activity" />
  if (isError || !activity) {
    return <Alert action={<Button onClick={() => void refetch()}>Retry</Button>} severity="error">Activity could not be loaded.</Alert>
  }

  const activityMetrics = fields.flatMap((field) => {
    const value = fieldValue(activity, field)
    return value === undefined ? [] : [{ label: fieldLabels[field], value }]
  })
  return (
    <Box component="section">
      <Button component={RouterLink} startIcon={<ArrowBackRounded />} to="/">Back to activities</Button>
      <Stack spacing={1} sx={{ mt: 3, mb: 3 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography color="text.secondary">{activity.startedAt ? new Date(activity.startedAt).toLocaleString() : 'Date unavailable'}</Typography>
          <ActivityFieldSettings type={activity.type} view="detail" />
        </Stack>
        <Box component="h1" sx={{ m: 0 }}><ActivityIcon activity={activity} detail /></Box>
        <Typography color="text.secondary">
          {[activity.type.replace('_', ' '), activity.sourceType?.replaceAll('_', ' ')].filter(Boolean).join(' · ')}
        </Typography>
      </Stack>
      <Card>
        <CardContent>
          {activityMetrics.length ? (
            <Grid container spacing={3}>
              {activityMetrics.map(({ label, value }) => <Metric key={label} label={label} value={value} />)}
            </Grid>
          ) : (
            <Typography color="text.secondary">No additional metrics are available for this activity.</Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}
