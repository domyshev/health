import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, ClickAwayListener, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Paper, Popper, Stack, TextField, Typography, useMediaQuery } from '@mui/material'
import CloseRounded from '@mui/icons-material/CloseRounded'
import { apiRequest } from '../../api/client'
import sweetIllustration from '../../assets/sweet-comic.png'

type Note = { id: string; note: string; createdAt: string }
type Position = { x: number; y: number }
const sweets = [
  { id: 'candy', label: 'Candy' }, { id: 'wafer', label: 'Wafer' },
  { id: 'snickers', label: 'Snickers' }, { id: 'ice-cream', label: 'Ice cream' },
  { id: 'gummy', label: 'Gummy candy' }, { id: 'condensed-milk', label: 'Condensed milk' },
] as const

const clamp = (p: Position, size: number): Position => ({ x: Math.max(0, Math.min(p.x, window.innerWidth - size)), y: Math.max(0, Math.min(p.y, window.innerHeight - size)) })

export function Help({ statisticsOpen, onCloseStatistics }: { statisticsOpen: boolean; onCloseStatistics: () => void }) {
  const size = useMediaQuery('(min-width:600px)') ? 46 : 56
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
  const [arrow, setArrow] = useState<HTMLSpanElement | null>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  useEffect(() => {
    if (open) popoverRef.current?.focus()
  }, [open])

  useEffect(() => {
    const resize = () => setPosition((p) => p ? clamp(p, size) : null)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [size])
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
    <Box component="button" ref={fabRef} type="button" aria-label="Help me. Drag to move" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? 'life-situations-popover' : undefined} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { startX: e.clientX, startY: e.clientY, x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().top, moved: false } }}
      onPointerMove={(e) => { const d = drag.current; if (!d) return; const dx = e.clientX - d.startX; const dy = e.clientY - d.startY; if (Math.hypot(dx, dy) > 5) d.moved = true; if (d.moved) setPosition(clamp({ x: d.x + dx, y: d.y + dy }, size)) }}
      onPointerUp={() => { suppressClick.current = drag.current?.moved ?? false; drag.current = null }} onPointerCancel={() => { drag.current = null }}
      onClick={() => { if (suppressClick.current) { suppressClick.current = false; return }; if (!saving) { setError(''); setOpen((value) => !value) } }}
      onKeyDown={(e) => { const offsets: Record<string, Position> = { ArrowLeft: { x: -20, y: 0 }, ArrowRight: { x: 20, y: 0 }, ArrowUp: { x: 0, y: -20 }, ArrowDown: { x: 0, y: 20 } }; const offset = offsets[e.key]; if (offset) { e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); setPosition((p) => { return clamp({ x: (p?.x ?? rect.left) + offset.x, y: (p?.y ?? rect.top) + offset.y }, size) }) } }}
      sx={{ position: 'fixed', ...(position ? { left: position.x, top: position.y } : { right: 16, bottom: 16, '@supports (-webkit-touch-callout: none)': { '@media (max-width: 599.95px)': { 'html:not([data-platform="ios"]) &': { bottom: 0 } } } }), width: size, height: size, display: 'grid', placeItems: 'center', padding: 0, borderRadius: '50%', border: '1px solid rgba(255, 220, 232, 0.52)', background: 'radial-gradient(ellipse at 32% 16%, rgba(255, 229, 238, 0.5), transparent 38%), radial-gradient(circle at 50% 75%, rgba(126, 10, 44, 0.45), transparent 65%), linear-gradient(145deg, rgba(224, 68, 113, 0.62), rgba(118, 8, 41, 0.7))', backdropFilter: 'blur(16px) saturate(150%)', WebkitBackdropFilter: 'blur(16px) saturate(150%)', color: '#fff', zIndex: 1200, boxShadow: '0 7px 18px rgba(0, 0, 0, 0.3), inset 0 2px 3px rgba(255, 255, 255, 0.55), inset 0 -4px 7px rgba(67, 0, 20, 0.35)', cursor: 'grab', touchAction: 'none', '&::before': { content: '""', position: 'absolute', top: '6%', left: '17%', width: '66%', height: '30%', borderRadius: '50%', background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.46), rgba(255, 255, 255, 0))', pointerEvents: 'none' }, '&:active': { cursor: 'grabbing' }, '&:focus-visible': { outline: '2px solid #ffd1e3', outlineOffset: 3 } }}>
      <svg aria-hidden="true" viewBox="0 0 64 64" style={{ position: 'absolute', inset: 3, width: size - 8, height: size - 8, pointerEvents: 'none' }}>
        <path transform="translate(1 1)" d="M31 1 C47.6 1 61 14.4 61 31 S47.6 61 31 61 S4 48.9 4 34 S15.4 7 29.5 7 S55 18.4 55 32 S44.9 55 32.5 55 S10 45.4 10 33.5 S19 12 30 12 S50 20.5 50 31 S42.4 50 33 50 S16 42.8 16 34 S22.7 18 31 18 S46 24.3 46 32 S40.2 46 33 46 S20 40.6 20 34 S24.9 22 31 22 S42 26.5 42 32 S38 42 33 42" fill="none" stroke="#ff88b4" strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
      </svg>
    </Box>
    <Popper open={open} anchorEl={fabRef.current} placement="top-end" modifiers={[{ name: 'offset', options: { offset: [0, 12] } }, { name: 'arrow', options: { element: arrow, padding: 12 } }, { name: 'preventOverflow', options: { padding: 8 } }]} sx={{ zIndex: 1300, '&[data-popper-placement^="top"] .help-arrow': { bottom: -7 }, '&[data-popper-placement^="bottom"] .help-arrow': { top: -7 } }}>
      <ClickAwayListener onClickAway={(event) => { if (!saving && !fabRef.current?.contains(event.target as Node)) setOpen(false) }}>
        <Paper id="life-situations-popover" ref={popoverRef} role="dialog" aria-labelledby="life-situations-title" tabIndex={-1} elevation={12} onKeyDown={(event) => { if (event.key === 'Escape' && !saving) { event.stopPropagation(); setOpen(false); fabRef.current?.focus() } }} sx={{ position: 'relative', width: 'min(360px, calc(100vw - 16px))', outline: 'none', backgroundImage: 'none', border: '1px solid', borderColor: 'divider' }}>
          <Box component="span" ref={setArrow} className="help-arrow" aria-hidden="true" sx={{ position: 'absolute', width: 14, height: 14, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', transform: 'rotate(45deg)', pointerEvents: 'none' }} />
          <Box sx={{ position: 'relative', borderRadius: 'inherit', bgcolor: 'background.paper', maxHeight: 'min(680px, calc(100dvh - 88px))', overflowY: 'auto' }}>
      <DialogTitle id="life-situations-title">Life situations</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <Stack spacing={0.75} sx={{ alignItems: 'center' }}>
          <Box component="button" type="button" aria-label="I want to eat something sweet" aria-pressed={choosing} onClick={() => setChoosing(true)} sx={{ width: { xs: 144, sm: 176 }, aspectRatio: '1', p: 0, borderRadius: 3, overflow: 'hidden', border: '2px solid', borderColor: choosing ? 'primary.main' : 'transparent', background: 'transparent', boxShadow: '0 6px 22px rgba(0, 0, 0, 0.22)', cursor: 'pointer', transition: 'transform 160ms ease, box-shadow 160ms ease', '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 10px 26px rgba(0, 0, 0, 0.3)' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 3 }, '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }}>
            <Box component="img" src={sweetIllustration} alt="" sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', filter: 'none' }} />
          </Box>
          <Typography color="text.secondary" variant="body2">I want to eat something sweet</Typography>
        </Stack>
        {choosing && <>
          <Typography color="text.secondary" variant="body2">Choose a sweet</Typography>
          <Box role="group" aria-label="Choose a sweet" sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}>
            {sweets.map((sweet) => <Box key={sweet.id} component="button" type="button" aria-label={sweet.label} aria-pressed={selected?.id === sweet.id} title={sweet.label} onClick={() => setSelected(sweet)} sx={{ display: 'grid', placeItems: 'center', minHeight: 84, borderRadius: 2, border: '2px solid', borderColor: selected?.id === sweet.id ? 'primary.main' : 'divider', color: selected?.id === sweet.id ? 'primary.main' : 'text.primary', background: 'transparent', font: 'inherit', fontWeight: 600, padding: 1, cursor: 'pointer', '&:focus-visible': { outline: '2px solid', outlineOffset: 2 } }}>{sweet.label}</Box>)}
          </Box>
          <TextField label="Calories (optional)" type="number" value={calories} onChange={(e) => setCalories(e.target.value)} error={calories !== '' && (!Number.isFinite(Number(calories)) || Number(calories) < 0)} slotProps={{ htmlInput: { min: 0, step: 'any', inputMode: 'decimal' } }} />
        </>}
        {error && <Alert severity="error">{error}</Alert>}
      </Stack></DialogContent>
      <DialogActions><Button className="quiet-red-action" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>{choosing && <Button variant="contained" disabled={!selected || saving || (calories !== '' && (!Number.isFinite(Number(calories)) || Number(calories) < 0))} onClick={() => void save()}>Save</Button>}</DialogActions>
          </Box>
        </Paper>
      </ClickAwayListener>
    </Popper>
    <Dialog fullWidth maxWidth="sm" open={statisticsOpen} onClose={onCloseStatistics}>
      <DialogTitle>Help statistics<IconButton className="quiet-red-action" aria-label="Close help statistics" onClick={onCloseStatistics} sx={{ position: 'absolute', right: 12, top: 12 }}><CloseRounded /></IconButton></DialogTitle>
      <DialogContent><Stack spacing={2}>{loading ? <Typography color="text.secondary">Loading notes…</Typography> : loadError ? <Alert severity="error">Could not load your notes. Close and reopen to try again.</Alert> : items.length === 0 ? <Typography color="text.secondary">No notes yet.</Typography> : items.map((item) => <Box key={item.id} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}><Typography variant="caption" color="text.secondary">{new Date(item.createdAt).toLocaleString()} · UTC {new Date(item.createdAt).toISOString().replace('T', ' ').slice(0, 16)}</Typography><Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', mt: 1 }}>{item.note}</Typography></Box>)}</Stack></DialogContent>
    </Dialog>
  </>
}
