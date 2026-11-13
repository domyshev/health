import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, TextField, Typography } from '@mui/material'
import CloseRounded from '@mui/icons-material/CloseRounded'
import { apiRequest } from '../../api/client'

type Note = { id: string; note: string; createdAt: string }
type Position = { x: number; y: number }
const sweets = [
  { id: 'candy', label: 'Candy' }, { id: 'wafer', label: 'Wafer' },
  { id: 'snickers', label: 'Snickers' }, { id: 'ice-cream', label: 'Ice cream' },
  { id: 'gummy', label: 'Gummy candy' }, { id: 'condensed-milk', label: 'Condensed milk' },
] as const

function SweetIcon({ id }: { id: typeof sweets[number]['id'] }) {
  return <svg aria-hidden="true" viewBox="0 0 64 64" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    {id === 'candy' && <><path d="M19 25 8 20v24l11-5M45 25l11-5v24l-11-5" /><rect x="19" y="21" width="26" height="22" rx="8" /><path d="m25 27 14 10m-14 0 14-10" /></>}
    {id === 'wafer' && <><rect x="12" y="15" width="40" height="34" rx="4" /><path d="M22 15v34M32 15v34M42 15v34M12 25h40M12 37h40" /></>}
    {id === 'snickers' && <><path d="M12 23 7 18v28l5-5m40-18 5-5v28l-5-5M12 23h40v18H12z" /><path d="M17 29c4-5 7 5 11 0s7 5 11 0 6 2 8 0M17 35h30" /></>}
    {id === 'ice-cream' && <><path d="M21 36 32 57l11-21M19 35a10 10 0 0 1 3-18 10 10 0 0 1 20 0 10 10 0 0 1 3 18zM27 40l9 10m1-10-7 9" /></>}
    {id === 'gummy' && <><path d="M23 17a6 6 0 1 1 11-3 6 6 0 1 1 9 5c5 4 5 9 2 13 6 3 7 10 2 12-3 2-5 0-7-2 1 8-4 11-8 8-4 3-9 0-8-8-2 2-4 4-7 2-5-2-4-9 2-12-3-4-3-9 4-15z" /><path d="M27 24h.1M37 24h.1M28 31c2 2 6 2 8 0" /></>}
    {id === 'condensed-milk' && <><path d="M18 17c0-3 28-3 28 0v31c0 4-28 4-28 0zM18 17c0 4 28 4 28 0M18 23c0 4 28 4 28 0M18 44c0 4 28 4 28 0" /><path d="M26 33c2-5 5-7 6-9 1 2 4 4 6 9a6 6 0 0 1-12 0z" /></>}
  </svg>
}

const size = 68
const clamp = (p: Position): Position => ({ x: Math.max(0, Math.min(p.x, window.innerWidth - size)), y: Math.max(0, Math.min(p.y, window.innerHeight - size)) })

export function Help({ statisticsOpen, onCloseStatistics }: { statisticsOpen: boolean; onCloseStatistics: () => void }) {
  const [position, setPosition] = useState<Position>(() => clamp({ x: window.innerWidth - size - 20, y: window.innerHeight - size - 30 }))
  const [open, setOpen] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [selected, setSelected] = useState<typeof sweets[number] | null>(null)
  const [calories, setCalories] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [items, setItems] = useState<Note[]>([])
  const [loadError, setLoadError] = useState(false)
  const [loading, setLoading] = useState(false)
  const drag = useRef<{ startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  useEffect(() => {
    const resize = () => setPosition((p) => clamp(p))
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => {
    if (!statisticsOpen) return
    let active = true
    setLoadError(false)
    setLoading(true)
    apiRequest<{ items: Note[] }>('/v1/help-notes').then((data) => { if (active) setItems(data.items) }).catch(() => { if (active) setLoadError(true) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [statisticsOpen])

  async function save() {
    if (!selected || saving || (calories !== '' && (!Number.isFinite(Number(calories)) || Number(calories) < 0))) return
    setSaving(true); setError('')
    try {
      await apiRequest<Note>('/v1/help-notes', { method: 'POST', body: JSON.stringify({ note: `Wanted to eat: ${selected.label}${calories === '' ? '' : ` · ${Number(calories)} kcal`}` }) })
      setSelected(null); setCalories(''); setChoosing(false); setOpen(false)
    } catch { setError('Could not save your note. Please try again.') }
    finally { setSaving(false) }
  }
  return <>
    <Box component="button" type="button" aria-label="Help me. Drag to move" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { startX: e.clientX, startY: e.clientY, x: position.x, y: position.y, moved: false } }}
      onPointerMove={(e) => { const d = drag.current; if (!d) return; const dx = e.clientX - d.startX; const dy = e.clientY - d.startY; if (Math.hypot(dx, dy) > 5) d.moved = true; if (d.moved) setPosition(clamp({ x: d.x + dx, y: d.y + dy })) }}
      onPointerUp={() => { suppressClick.current = drag.current?.moved ?? false; drag.current = null }} onPointerCancel={() => { drag.current = null }}
      onClick={() => { if (suppressClick.current) { suppressClick.current = false; return }; setError(''); setOpen(true) }}
      onKeyDown={(e) => { const offsets: Record<string, Position> = { ArrowLeft: { x: -20, y: 0 }, ArrowRight: { x: 20, y: 0 }, ArrowUp: { x: 0, y: -20 }, ArrowDown: { x: 0, y: 20 } }; const offset = offsets[e.key]; if (offset) { e.preventDefault(); setPosition((p) => clamp({ x: p.x + offset.x, y: p.y + offset.y })) } }}
      sx={{ position: 'fixed', left: position.x, top: position.y, width: size, height: size, borderRadius: '50%', border: '2px solid #d21f2b', background: '#fff', color: '#111', fontSize: 12, fontWeight: 700, zIndex: 1200, boxShadow: '0 4px 20px #0003', cursor: 'grab', touchAction: 'none', '&:active': { cursor: 'grabbing' }, '&:focus-visible': { outline: '3px solid #111', outlineOffset: 3 } }}>help me</Box>
    <Dialog fullWidth maxWidth="sm" open={open} onClose={() => { if (!saving) setOpen(false) }}>
      <DialogTitle>Take a moment</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <Button variant={choosing ? 'outlined' : 'contained'} onClick={() => setChoosing(true)}>I want to eat something sweet</Button>
        {choosing && <>
          <Typography color="text.secondary" variant="body2">Choose a sweet</Typography>
          <Box role="group" aria-label="Choose a sweet" sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}>
            {sweets.map((sweet) => <Box key={sweet.id} component="button" type="button" aria-label={sweet.label} aria-pressed={selected?.id === sweet.id} title={sweet.label} onClick={() => setSelected(sweet)} sx={{ display: 'grid', placeItems: 'center', minHeight: 84, borderRadius: 2, border: '2px solid', borderColor: selected?.id === sweet.id ? 'primary.main' : 'divider', color: selected?.id === sweet.id ? 'primary.main' : 'text.primary', background: 'transparent', cursor: 'pointer', '&:focus-visible': { outline: '2px solid', outlineOffset: 2 } }}><SweetIcon id={sweet.id} /></Box>)}
          </Box>
          <TextField label="Calories (optional)" type="number" value={calories} onChange={(e) => setCalories(e.target.value)} error={calories !== '' && (!Number.isFinite(Number(calories)) || Number(calories) < 0)} slotProps={{ htmlInput: { min: 0, step: 'any', inputMode: 'decimal' } }} />
        </>}
        {error && <Alert severity="error">{error}</Alert>}
      </Stack></DialogContent>
      <DialogActions><Button onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>{choosing && <Button variant="contained" disabled={!selected || saving || (calories !== '' && (!Number.isFinite(Number(calories)) || Number(calories) < 0))} onClick={() => void save()}>Save</Button>}</DialogActions>
    </Dialog>
    <Dialog fullWidth maxWidth="sm" open={statisticsOpen} onClose={onCloseStatistics}>
      <DialogTitle>Help statistics<IconButton aria-label="Close help statistics" onClick={onCloseStatistics} sx={{ position: 'absolute', right: 12, top: 12 }}><CloseRounded /></IconButton></DialogTitle>
      <DialogContent><Stack spacing={2}>{loading ? <Typography color="text.secondary">Loading notes…</Typography> : loadError ? <Alert severity="error">Could not load your notes. Close and reopen to try again.</Alert> : items.length === 0 ? <Typography color="text.secondary">No notes yet.</Typography> : items.map((item) => <Box key={item.id} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}><Typography variant="caption" color="text.secondary">{new Date(item.createdAt).toLocaleString()} · UTC {new Date(item.createdAt).toISOString().replace('T', ' ').slice(0, 16)}</Typography><Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', mt: 1 }}>{item.note}</Typography></Box>)}</Stack></DialogContent>
    </Dialog>
  </>
}
