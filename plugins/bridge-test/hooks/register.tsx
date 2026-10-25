import type { Register } from 'claude-code'

const PANE = 'bridge-test'
const PREVIEWS = 'https://claude.ai/artifact/GN2tcQ42UgaNPiYshjgd26'
const C = { field: '#060a12', panel: '#0a1120', line: '#1b3550', ink: '#dcebf5', muted: '#7fa3bf', accent: '#5fd3ff', ok: '#4fe3b0', amber: '#ffb347' }

let isOpen = false
let wantCols = 60
let opens = 0

const f2 = (n: number) => String(n).padStart(2, '0')
const clock = () => { const d = new Date(); return `${f2(d.getHours())}:${f2(d.getMinutes())}:${f2(d.getSeconds())}` }

const ring = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
<rect width="120" height="120" fill="${C.field}"/>
<circle cx="60" cy="60" r="52" fill="none" stroke="${C.line}"/>
<g stroke="${C.accent}" stroke-width="2" fill="none"><circle cx="60" cy="60" r="44" stroke-dasharray="10 6" opacity=".7">
<animateTransform attributeName="transform" type="rotate" from="0 60 60" to="360 60 60" dur="12s" repeatCount="indefinite"/></circle></g>
<circle cx="60" cy="60" r="34" fill="none" stroke="${C.amber}" stroke-width="5" stroke-dasharray="150 214" transform="rotate(-90 60 60)"/>
<circle cx="60" cy="8" r="3" fill="${C.accent}"><animate attributeName="r" values="3;5;3" dur="2.4s" repeatCount="indefinite"/></circle>
<text x="60" y="65" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-size="16" font-weight="600" fill="${C.ink}">SVG OK</text>
</svg>`

async function openPane($: any, focus = false) {
  opens++
  const r = await $.ui.open({ id: PANE, title: 'Bridge (test)', columns: wantCols, ...(focus ? { focus: true } : {}) })
  isOpen = true
  $.ui.status(`Bridge test · pane ${r?.isPlaced ? 'placed' : 'not placed'} · /bridge toggles`)
  $.ui.invalidate('ui.render')
  return r
}
async function closePane($: any) {
  await $.ui.close({ id: PANE })
  isOpen = false
  $.ui.status('Bridge test · pane closed · /bridge reopens')
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'bridge', description: 'Bridge test: open or close the pane' })
    await $.command.register({ name: 'bridge-width', description: 'Bridge test: request a pane width in columns, e.g. /bridge-width 90', argumentHint: '<columns>' })
    $.ui.status('Bridge test loaded · /bridge opens the pane')
    $.clock.every(1000, () => { if (isOpen) $.ui.invalidate('ui.render') })
    return next(e)
  })

  on('command.run', { command: 'bridge' }, async $ => {
    if (isOpen) { await closePane($); return { text: 'Bridge test pane closed.' } }
    const r = await openPane($)
    return { text: `Bridge test pane opened (placed: ${r?.isPlaced ? 'yes' : 'no'}).` }
  })

  on('command.run', { command: 'bridge-width' }, async ($, e: any) => {
    const n = parseInt(String(e.args ?? e.arguments ?? '').trim(), 10)
    if (!Number.isFinite(n) || n < 24) return { text: 'Give a width in columns, 24 or more, e.g. /bridge-width 90' }
    wantCols = n
    await openPane($)
    return { text: `Requested ${n} columns. The pane may cap it; the pane shows what it got.` }
  })

  on('ui.close', async ($, e: any, next) => {
    if (e?.id === PANE) { isOpen = false; $.ui.status('Bridge test · pane closed · /bridge reopens') }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e: any) => {
    const { Box, Text, Button, Link, Svg } = $.ui.resolve(e) as any
    const p = e.props ?? {}
    const v = e.viewport ?? {}
    const row = (k: string, val: string, col = C.ink) => (
      <Box flexDirection="row" gap={1}>
        <Box width={14}><Text color={C.muted} size="caption">{k}</Text></Box>
        <Text color={col} tabular>{val}</Text>
      </Box>
    )
    return (
      <Box flexDirection="column" gap={1} padding={1} backgroundColor={C.field}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text color={C.accent} weight="bold" size="heading">BRIDGE · TEST</Text>
          <Text color={C.ink} tabular size="heading">{clock()}</Text>
        </Box>
        <Box flexDirection="column" borderStyle="single" borderColor={C.line} backgroundColor={C.panel} padding={1}>
          <Text color={C.accent} size="caption" weight="semibold">WHAT THE APP GAVE THE PANE</Text>
          {row('Surface', String(e.surface))}
          {row('Placement', String(p.placement ?? '?'), p.placement === 'dock' ? C.ok : C.amber)}
          {row('Width asked', `${wantCols} cols`)}
          {row('Width got', `${p.bodyColumns ?? '?'} cols`)}
          {row('Viewport', `${v.columns ?? '?'} × ${v.rows ?? '?'}`)}
          {row('Focused', p.isFocused ? 'yes' : 'no')}
          {row('Opens', String(opens))}
        </Box>
        {Svg ? <Svg source={ring} alt="Animated test ring" interactive width={120} height={120} /> : <Text color={C.amber}>No Svg element on this surface</Text>}
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="narrow" label="Narrower" onPress={() => { wantCols = Math.max(24, wantCols - 20); void openPane($) }} />
          <Button key="wide" label="Wider" variant="primary" onPress={() => { wantCols += 20; void openPane($) }} />
          <Button key="close" label="Collapse" onPress={() => { void closePane($) }} />
        </Box>
        <Link href={PREVIEWS} label="Open Bridge Previews ↗" />
        <Text color={C.muted} size="footnote">Try: drag the divider, /bridge-width 120, open an artifact beside it, then /bridge to collapse and reopen.</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e: any, next) => {
    if (isOpen) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e) as any
    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text color={C.accent} weight="semibold">BRIDGE</Text>
        <Text color={C.muted}>{clock()} · test band (pane closed)</Text>
        <Button key="reopen" label="Open pane" onPress={() => { void openPane($) }} />
      </Box>
    )
  })
}
