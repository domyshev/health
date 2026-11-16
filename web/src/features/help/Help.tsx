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

const size = 56
const clamp = (p: Position): Position => ({ x: Math.max(0, Math.min(p.x, window.innerWidth - size)), y: Math.max(0, Math.min(p.y, window.innerHeight - size)) })

export function Help({ statisticsOpen, onCloseStatistics }: { statisticsOpen: boolean; onCloseStatistics: () => void }) {
  const [position, setPosition] = useState<Position | null>(null)
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
    const resize = () => setPosition((p) => p ? clamp(p) : null)
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
    <Box component="button" type="button" aria-label="Help me. Drag to move" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { startX: e.clientX, startY: e.clientY, x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().top, moved: false } }}
      onPointerMove={(e) => { const d = drag.current; if (!d) return; const dx = e.clientX - d.startX; const dy = e.clientY - d.startY; if (Math.hypot(dx, dy) > 5) d.moved = true; if (d.moved) setPosition(clamp({ x: d.x + dx, y: d.y + dy })) }}
      onPointerUp={() => { suppressClick.current = drag.current?.moved ?? false; drag.current = null }} onPointerCancel={() => { drag.current = null }}
      onClick={() => { if (suppressClick.current) { suppressClick.current = false; return }; setError(''); setOpen(true) }}
      onKeyDown={(e) => { const offsets: Record<string, Position> = { ArrowLeft: { x: -20, y: 0 }, ArrowRight: { x: 20, y: 0 }, ArrowUp: { x: 0, y: -20 }, ArrowDown: { x: 0, y: 20 } }; const offset = offsets[e.key]; if (offset) { e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); setPosition((p) => { return clamp({ x: (p?.x ?? rect.left) + offset.x, y: (p?.y ?? rect.top) + offset.y }) }) } }}
      sx={{ position: 'fixed', ...(position ? { left: position.x, top: position.y } : { right: 16, bottom: 16 }), width: size, height: size, display: 'grid', placeItems: 'center', padding: 0, borderRadius: '50%', border: 0, background: 'radial-gradient(circle at 30% 20%, #d93260 0%, #a40e3d 42%, #65051f 100%)', color: '#fff', textShadow: '0 1px 4px #4a0018', fontSize: 12, fontWeight: 700, zIndex: 1200, boxShadow: 'inset 0 2px 5px rgba(255, 190, 210, 0.35)', cursor: 'grab', touchAction: 'none', '&:active': { cursor: 'grabbing' }, outline: 'none', '&:focus-visible': { outline: 'none', '& path': { stroke: '#ffd1e3', opacity: 1 } } }}>
      <svg aria-hidden="true" viewBox="0 0 64 64" style={{ position: 'absolute', inset: 3, width: size - 6, height: size - 6, pointerEvents: 'none' }}>
        <path transform="translate(1 1)" d="M31 1 C47.6 1 61 14.4 61 31 S47.6 61 31 61 S4 48.9 4 34 S15.4 7 29.5 7 S55 18.4 55 32 S44.9 55 32.5 55 S10 45.4 10 33.5 S19 12 30 12 S50 20.5 50 31 S42.4 50 33 50 S16 42.8 16 34 S22.7 18 31 18 S46 24.3 46 32 S40.2 46 33 46 S20 40.6 20 34 S24.9 22 31 22 S42 26.5 42 32 S38 42 33 42" fill="none" stroke="#ff88b4" strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
      </svg>
    </Box>
    <Dialog fullWidth maxWidth="sm" open={open} onClose={() => { if (!saving) setOpen(false) }}>
      <DialogTitle>I’m one step away from doing something very, very bad...</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <Button variant={choosing ? 'outlined' : 'contained'} onClick={() => setChoosing(true)}>I want to eat something sweet</Button>
        {choosing && <>
          <Typography color="text.secondary" variant="body2">Choose a sweet</Typography>
          <Box role="group" aria-label="Choose a sweet" sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}>
            {sweets.map((sweet) => <Box key={sweet.id} component="button" type="button" aria-label={sweet.label} aria-pressed={selected?.id === sweet.id} title={sweet.label} onClick={() => setSelected(sweet)} sx={{ display: 'grid', placeItems: 'center', minHeight: 84, borderRadius: 2, border: '2px solid', borderColor: selected?.id === sweet.id ? 'primary.main' : 'divider', color: selected?.id === sweet.id ? 'primary.main' : 'text.primary', background: 'transparent', font: 'inherit', fontWeight: 600, padding: 1, cursor: 'pointer', '&:focus-visible': { outline: '2px solid', outlineOffset: 2 } }}>{sweet.label}</Box>)}
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
