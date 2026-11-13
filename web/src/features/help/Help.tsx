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
      sx={{ position: 'fixed', left: position.x, top: position.y, width: size, height: size, borderRadius: '50%', border: '1px solid rgba(255, 160, 160, 0.8)', background: 'radial-gradient(ellipse at 35% 15%, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0.08) 35%, transparent 52%), linear-gradient(155deg, #ff4b52 0%, #dc1725 50%, #980511 100%)', color: '#fff', textShadow: '0 1px 2px rgba(95, 0, 0, 0.7)', fontSize: 12, fontWeight: 700, zIndex: 1200, boxShadow: 'inset 0 1px 3px rgba(255, 255, 255, 0.7), inset 0 -5px 10px rgba(90, 0, 0, 0.4), 0 6px 16px rgba(0, 0, 0, 0.4), 0 2px 5px rgba(135, 0, 0, 0.5)', cursor: 'grab', touchAction: 'none', '&:active': { cursor: 'grabbing' }, '&:focus-visible': { outline: '3px solid #111', outlineOffset: 3 } }}>help me</Box>
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
