import { useState } from 'react'
import MoreVertRounded from '@mui/icons-material/MoreVertRounded'
import { Alert, Box, Button, Checkbox, FormControlLabel, IconButton, Popover, Stack, Tooltip, Typography } from '@mui/material'

import { useGetActivityFieldSettingsQuery, useSaveActivityFieldSettingMutation, type Activity } from '../../api/healthApi'
import { availableFields, defaultFields, fieldLabels, type ActivityView, type Field } from './activityFields'

export function useActivityFields(type: Activity['type'], view: ActivityView) {
  const query = useGetActivityFieldSettingsQuery()
  const saved = query.data?.find((item) => item.type === type && item.view === view)
  return { ...query, fields: saved?.fields ?? defaultFields(type, view) }
}

export function ActivityFieldSettings({ type, view }: { type: Activity['type']; view: ActivityView }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const { fields, isFetching, isError, refetch } = useActivityFields(type, view)
  const [save, saveState] = useSaveActivityFieldSettingMutation()
  function toggle(field: Field) {
    const next = fields.includes(field) ? fields.filter((item) => item !== field) : [...fields, field]
    void save({ type, view, fields: next })
  }
  return <>
    <Tooltip title="Choose visible fields">
      <IconButton aria-label={`Choose ${view} fields for ${type}`} aria-haspopup="dialog" onClick={(event) => setAnchor(event.currentTarget)}><MoreVertRounded /></IconButton>
    </Tooltip>
    <Popover anchorEl={anchor} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }} onClose={() => setAnchor(null)} open={Boolean(anchor)}>
      <Box role="dialog" aria-label={`Visible ${view} fields for ${type}`} sx={{ p: 2, width: 270, maxHeight: '70vh', overflow: 'auto' }}>
        <Typography sx={{ fontWeight: 700 }}>Visible fields</Typography>
        <Typography color="text.secondary" variant="caption">Applies to {type} activities in {view === 'list' ? 'the list' : 'the detail view'}.</Typography>
        {isError && <Alert severity="error" action={<Button onClick={() => void refetch()}>Retry</Button>}>Could not load settings.</Alert>}
        {saveState.isError && <Alert severity="error">Could not save settings. Try again.</Alert>}
        <Stack>
          {availableFields(type).map((field) => <FormControlLabel key={field} control={<Checkbox checked={fields.includes(field)} disabled={isFetching || isError || saveState.isLoading} onChange={() => toggle(field)} />} label={fieldLabels[field]} />)}
        </Stack>
        <Button onClick={() => setAnchor(null)}>Done</Button>
      </Box>
    </Popover>
  </>
}
