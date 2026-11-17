import { useRef, useState } from 'react'
import { Box, Tooltip } from '@mui/material'

export function ImageChoice({ label, src, onChoose, large = false }: { label: string; src: string; onChoose: () => void; large?: boolean }) {
  const [showTooltip, setShowTooltip] = useState(false)
  const lastPointer = useRef('')
  return <Tooltip title={label} arrow open={showTooltip} disableHoverListener disableTouchListener disableFocusListener disableInteractive>
    <Box component="button" type="button" aria-label={label}
      onPointerEnter={(event) => { if (event.pointerType !== 'touch') setShowTooltip(true) }}
      onPointerLeave={() => setShowTooltip(false)}
      onPointerDown={(event) => { lastPointer.current = event.pointerType; if (event.pointerType === 'touch') setShowTooltip(true) }}
      onPointerUp={(event) => { if (event.pointerType === 'touch') setShowTooltip(false) }}
      onPointerCancel={() => setShowTooltip(false)}
      onFocus={(event) => { if (lastPointer.current !== 'touch' || event.currentTarget.matches(':focus-visible')) setShowTooltip(true) }}
      onBlur={() => setShowTooltip(false)}
      onContextMenu={(event) => { if (lastPointer.current === 'touch') event.preventDefault() }}
      onClick={() => { setShowTooltip(false); onChoose() }}
      sx={{ display: 'block', width: large ? { xs: 144, sm: 176 } : '100%', aspectRatio: '1', p: 0, border: 0, borderRadius: 0, background: 'transparent', cursor: 'pointer', touchAction: 'manipulation', userSelect: 'none', WebkitTouchCallout: 'none', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 3 } }}>
      <Box component="img" src={src} alt="" draggable={false} sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', filter: 'none' }} />
    </Box>
  </Tooltip>
}
