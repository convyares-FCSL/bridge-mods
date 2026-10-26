import type { Register } from 'claude-code'

const VERSION = '0.1.1'
const PANE = 'bridge'
const BOARD = 'https://claude.ai/artifact/GN2tcQ42UgaNPiYshjgd26'
const VAULT = 'C:/vault'
const ME = '80462914'
const DIAG = `/tmp/bridge-diag-${Date.now().toString(36)}.log`

// hud-* tokens from the Bridge design system; Daylight is the light theme.
const DARK = { field: '#060a12', panel: '#0a1120', line: '#1b3550', ink: '#dcebf5', muted: '#7fa3bf', accent: '#5fd3ff', asoft: '#0f2236', seg: '#9fd9ff', ok: '#4fe3b0', amber: '#ffb347', red: '#ff5e5e', cat: ['#ff5e5e', '#ff7ab8', '#ff9f43', '#4fe3b0', '#2fd0c8', '#ff9f43', '#b48cff', '#ff5e5e', '#8aa0b4'] }
const DAY = { field: '#e6ecf2', panel: '#f7f9fb', line: '#b7c7d6', ink: '#0f1c2b', muted: '#4f6578', accent: '#0b74a8', asoft: '#dbe8f1', seg: '#3a9fd0', ok: '#0f7f5a', amber: '#a35a00', red: '#b8372b', cat: ['#c62828', '#c2185b', '#c05a00', '#0f7f5a', '#0d7f7a', '#c05a00', '#6b3fd1', '#c62828', '#5a6b7a'] }
let P = DARK

const CATS: [string, string][] = [['01', 'Follow Up'], ['02', 'Snooze'], ['03', 'Waiting'], ['04', 'Read Through'], ['05', 'Team'], ['06', 'Project'], ['07', 'Personnel'], ['08', 'Newsletter'], ['09', 'Induction']]
const AREAS = ['Engineering overview', 'ECR tracker', 'Toyota CEP development (1792)', 'Engineering workload', 'AI Rollout', 'HyQube supply plan 2027', 'FCSL Systems', 'Fleet (Grafana)']
const DEAD = /^(not required|shipped|closed|complete|completed|done|cancelled|canceled|rejected)$/i

type Ev = { subject: string; start: number; end: number }
type Task = { id: string; name: string; list: string; due: number }
type Sync = { s: 'syncing' | 'ok' | 'fail'; msg: string }
const D = {
  events: [] as Ev[], eventsErr: '',
  tasks: [] as Task[], overdue: -1, overdueMore: false, tasksErr: '',
  timer: null as null | { taskId: string; name: string; start: number }, tracked: -1, trackedBy: {} as Record<string, number>, timeErr: '',
  unread: -1, mailErr: '',
  cats: {} as Record<string, { n: number; more: boolean } | null>, catsErr: '',
  stale: -1, inbox: -1, vaultErr: '',
}
const sync: Record<string, Sync> = {}
const logLines: { t: string; m: string; warn: boolean }[] = []
const open = { comms: false, monitoring: false, brain: false }
let isOpen = false
let wantCols = 60
let capture = ''
let capNote = ''
let scrollOffset = 0
let dirty = false
let lastRaw = ''

let logText = ''
const note = async ($: any, msg: string) => { logText += `${new Date().toISOString()} ${msg}\n`; try { await $.fs.write(DIAG, logText) } catch {} }

const f2 = (n: number) => String(n).padStart(2, '0')
const hhmm = (d = new Date()) => `${f2(d.getHours())}:${f2(d.getMinutes())}`
const ymd = (d: Date) => `${d.getFullYear()}-${f2(d.getMonth() + 1)}-${f2(d.getDate())}`
const hrs = (d: Date) => d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
const hm = (h: number) => `${f2(Math.floor(h))}:${f2(Math.floor((h % 1) * 60))}`
const err = (e: any) => String(e?.message ?? e)
const mins = (ms: number) => { const m = Math.max(0, Math.floor(ms / 60000)); return `${Math.floor(m / 60)}:${f2(m % 60)}` }
const hmLeft = (h: number) => { const m = Math.max(0, Math.round(h * 60)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${m} m` }
const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }

const addLog = ($: any, m: string, warn = false) => { logLines.push({ t: hhmm(), m, warn }); if (logLines.length > 60) logLines.shift(); void note($, `log ${warn ? 'WARN ' : ''}${m}`) }

// ---- connectors (allow rules cover exactly these tools) ---------------------

const textOf = (r: any) => (r?.content ?? []).map((c: any) => c.text ?? '').join('\n')
const parseBlocks = (r: any): any[] => {
  const t = textOf(r).trim()
  if (!t) return []
  try { const v = JSON.parse(t); return Array.isArray(v) ? v : [v] } catch {}
  try { return JSON.parse('[' + t.replace(/}\s*{/g, '},{') + ']') } catch {}
  return []
}
let servers: Record<string, string[]> = {}
const discover = async ($: any) => {
  servers = {}
  for (const t of (await $.tool.list()) as any[]) {
    const m = t.mcp ? /^mcp__(.+?)__(.+)$/.exec(t.name) : null
    if (m) (servers[m[1]!] ??= []).push(m[2]!)
  }
}
const call = async ($: any, tool: string, args: Record<string, unknown>) => {
  if (!Object.keys(servers).length) await discover($)
  const srv = Object.keys(servers).find(s => servers[s]!.includes(tool))
  if (!srv) throw new Error(`no connected server exposes ${tool}`)
  const r: any = await $.mcp.call(srv, tool, args)
  if (r?.isError) throw new Error(`${tool}: ${textOf(r).slice(0, 200)}`)
  return r
}

const touch = ($: any) => {
  if (scrollOffset === 0) { dirty = false; $.ui.invalidate('ui.render') } else dirty = true
  updateStrip($)
}

async function refreshCalendar($: any) {
  try {
    const d = new Date(), n = new Date(d.getTime() + 864e5)
    const r = await call($, 'outlook_calendar_search', { query: '*', afterDateTime: `${ymd(d)}T00:00:00`, beforeDateTime: `${ymd(n)}T00:00:00`, limit: 25, order: 'oldest' })
    D.events = parseBlocks(r).filter((x: any) => x.subject && !x.isAllDay && !x.isCancelled).map((x: any) => ({ subject: String(x.subject), start: hrs(new Date(String(x.start?.dateTime).slice(0, 19))), end: hrs(new Date(String(x.end?.dateTime).slice(0, 19))) }))
    D.eventsErr = ''
  } catch (e) { D.eventsErr = err(e) }
  touch($)
}

async function refreshTasks($: any) {
  try {
    const r = await call($, 'clickup_filter_tasks', { assignees: [ME], due_date_to: ymd(new Date()), order_by: 'due_date', fields: ['due_date', 'list', 'status'] })
    const body = parseBlocks(r)[0] ?? {}
    const open_ = (body.tasks ?? []).filter((t: any) => !DEAD.test(String(t.status ?? '')))
    D.tasks = open_.map((t: any) => ({ id: String(t.id), name: String(t.name), list: String(t.list?.name ?? ''), due: Number(t.due_date) }))
    const t0 = dayStart()
    D.overdue = D.tasks.filter(t => t.due < t0).length
    D.overdueMore = !!body.has_more
    D.tasksErr = ''
  } catch (e) { D.tasksErr = err(e) }
  touch($)
}

async function refreshTimer($: any) {
  try {
    const j = parseBlocks(await call($, 'clickup_get_current_time_entry', {}))[0] ?? {}
    if (!lastRaw) { lastRaw = 'x'; void note($, `current entry raw ${JSON.stringify(j).slice(0, 600)}`) }
    const ce = j.currentEntry ?? j.data
    if (j.isTracking === false || !ce) D.timer = null
    else D.timer = { taskId: String(ce.task?.id ?? ce.task_id ?? ''), name: String(ce.task?.name ?? ce.description ?? 'Task'), start: Number(ce.start ?? ce.start_time ?? Date.now()) }
    D.timeErr = ''
  } catch (e) { D.timeErr = err(e) }
  try {
    const d = new Date(), n = new Date(d.getTime() + 864e5)
    const j = parseBlocks(await call($, 'clickup_get_time_entries', { start_date: `${ymd(d)} 00:00`, end_date: `${ymd(n)} 00:00` }))[0] ?? {}
    void note($, `time entries raw ${JSON.stringify(j).slice(0, 500)}`)
    const arr: any[] = Array.isArray(j) ? j : j.entries ?? j.data ?? j.time_entries ?? []
    D.trackedBy = {}
    let total = 0
    for (const e of arr) {
      const ms = Number(e.duration ?? 0)
      if (!(ms > 0)) continue
      total += ms
      const id = String(e.task?.id ?? e.task_id ?? '')
      if (id) D.trackedBy[id] = (D.trackedBy[id] ?? 0) + ms
    }
    D.tracked = total
  } catch (e) { D.timeErr = err(e) }
  touch($)
}

async function refreshMail($: any) {
  try {
    const folders = parseBlocks(await call($, 'read_resource', { uri: 'mail:///folders/' }))
    const inbox = folders.find((f: any) => f.name === 'Inbox')
    D.unread = inbox ? Number(inbox.unreadCount) : -1
    D.mailErr = inbox ? '' : 'Inbox folder not found'
  } catch (e) { D.mailErr = err(e) }
  touch($)
}

async function refreshCats($: any) {
  D.catsErr = ''
  for (const [nn, name] of CATS) {
    try {
      const items = parseBlocks(await call($, 'outlook_email_search', { query: `category:"[${nn}] ${name}"`, limit: 25 }))
      const msgs = items.filter((x: any) => x.subject)
      D.cats[nn] = { n: msgs.length, more: items.some((x: any) => x.moreResults) }
    } catch (e) { D.cats[nn] = null; D.catsErr = err(e) }
  }
  touch($)
}

async function scanVault($: any, dir: string, st: { files: number; stale: number }) {
  let ents: any[] = []
  try { ents = await $.fs.list(dir) } catch { return }
  for (const en of ents) {
    if (st.files >= 1500) return
    if (en.kind === 'dir') { if (!/^(\.|_attachments$|Claude outputs$)/.test(en.name)) await scanVault($, `${dir}/${en.name}`, st); continue }
    if (!en.name.endsWith('.md')) continue
    st.files++
    try {
      const head = String(await $.fs.read(`${dir}/${en.name}`)).split(/\r?\n/).slice(0, 40)
      if (head[0]?.trim() === '---') {
        const end = head.indexOf('---', 1)
        if ((end < 0 ? head : head.slice(1, end)).some(l => /^review:\s*stale\b/i.test(l))) st.stale++
      }
    } catch {}
  }
}
async function refreshVault($: any) {
  try {
    const st = { files: 0, stale: 0 }
    await scanVault($, VAULT, st)
    D.stale = st.stale
    D.inbox = ((await $.fs.list(`${VAULT}/01-Inbox`)) as any[]).filter(e => e.kind === 'file').length
    D.vaultErr = ''
  } catch (e) { D.vaultErr = err(e) }
  touch($)
}

let lastFast = 0, lastSlow = 0
async function refreshAll($: any, force = false) {
  const now = Date.now()
  const slow = force || now - lastSlow > 10 * 60000
  if (!force && now - lastFast < 4 * 60000 && !slow) return
  lastFast = now
  await Promise.all([refreshCalendar($), refreshTasks($), refreshTimer($), refreshMail($)])
  if (slow) { lastSlow = now; await refreshVault($); if (isOpen) await refreshCats($) }
}

// ---- actions ----------------------------------------------------------------

async function startTimer($: any, t: Task) {
  sync[t.id] = { s: 'syncing', msg: '' }; touch($)
  try {
    if (D.timer) await call($, 'clickup_stop_time_tracking', {})
    await call($, 'clickup_start_time_tracking', { task_id: t.id })
    D.timer = { taskId: t.id, name: t.name, start: Date.now() }
    sync[t.id] = { s: 'ok', msg: '' }
    addLog($, `Timer started · ${t.name} → ClickUp ✓`)
    touch($)
    $.clock.after(2400, () => { delete sync[t.id]; touch($) })
  } catch (e) { sync[t.id] = { s: 'fail', msg: err(e).slice(0, 120) }; addLog($, `Timer start failed · ${t.name} · ${err(e).slice(0, 80)}`, true); touch($) }
}
async function stopTimer($: any) {
  const cur = D.timer
  if (!cur) return
  sync[cur.taskId] = { s: 'syncing', msg: '' }; touch($)
  try {
    await call($, 'clickup_stop_time_tracking', {})
    addLog($, `Timer stopped ${mins(Date.now() - cur.start)} · ${cur.name} → ClickUp ✓`)
    D.timer = null
    sync[cur.taskId] = { s: 'ok', msg: '' }
    touch($)
    $.clock.after(2400, () => { delete sync[cur.taskId]; touch($) })
    void refreshTimer($)
  } catch (e) { sync[cur.taskId] = { s: 'fail', msg: err(e).slice(0, 120) }; addLog($, `Timer stop failed · ${cur.name} · ${err(e).slice(0, 80)}`, true); touch($) }
}
async function runBrief($: any, text: string, label: string) {
  try { await $.prompt.submit({ text }); addLog($, `${label} sent to the chat`) } catch (e) { addLog($, `${label} not sent · ${err(e).slice(0, 80)}`, true) }
  touch($)
}
async function fileCapture($: any) {
  const text = capture.trim()
  if (!text) { capNote = 'Nothing to file'; touch($); return }
  const d = new Date()
  const path = `${VAULT}/01-Inbox/${ymd(d)} ${f2(d.getHours())}${f2(d.getMinutes())} capture.md`
  try {
    await $.fs.write(path, `---\ncreated: ${d.toISOString()}\nsource: bridge\n---\n\n${text}\n`)
    capture = ''; capNote = `Filed ${hhmm(d)}`; addLog($, `Capture filed → 01-Inbox`)
    void refreshVault($)
  } catch (e) { capNote = `Failed: ${err(e).slice(0, 80)}`; addLog($, `Capture failed · ${err(e).slice(0, 80)}`, true) }
  touch($)
}

// ---- pane lifecycle ---------------------------------------------------------

function stripText() {
  const h = hrs(new Date())
  const nx = D.events.find(e => e.end > h)
  const parts = [
    nx ? `${nx.subject} ${hm(nx.start)} · ${nx.start > h ? `in ${hmLeft(nx.start - h)}` : 'now'}` : D.eventsErr ? 'calendar —' : 'no more meetings today',
    D.tasks.length || !D.tasksErr ? `${D.tasks.length} open` : 'open —',
  ]
  if (D.timer) parts.push(`▶ ${mins(Date.now() - D.timer.start)}`)
  parts.push(`inbox ${D.unread >= 0 ? D.unread : '—'}`, `${D.stale >= 0 ? D.stale : '—'} stale`)
  return `Bridge v${VERSION} · ${parts.join(' · ')}`
}
function updateStrip($: any) { try { $.ui.status(stripText()) } catch {} }

async function openPane($: any, focus = false) {
  const r: any = await $.ui.open({ id: PANE, title: 'Bridge', columns: wantCols, ...(focus ? { focus: true } : {}) })
  isOpen = true
  updateStrip($)
  $.ui.invalidate('ui.render')
  void refreshAll($, true)
  return r
}
async function closePane($: any) {
  await $.ui.close({ id: PANE })
  isOpen = false
  updateStrip($)
  $.ui.invalidate('ui.render')
}

// ---- svg --------------------------------------------------------------------

function ringSvg(now: Date) {
  const c = 48, R = 42
  const ang = (h: number) => ((h - 12) / 24) * 2 * Math.PI - Math.PI / 2
  const pt = (h: number, r: number): [number, number] => [c + r * Math.cos(ang(h)), c + r * Math.sin(ang(h))]
  const arc = (a: number, b: number, r: number, w: number, col: string, op: number) => {
    const [x1, y1] = pt(a, r), [x2, y2] = pt(b, r)
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${w}" opacity="${op}"/>`
  }
  const h = hrs(now)
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" fill="${P.panel}"/><circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="${P.line}"/>`
  for (let i = 0; i < 24; i++) { const [x1, y1] = pt(i, R), [x2, y2] = pt(i, R - (i % 6 ? 3 : 6)); s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${P.muted}" stroke-width="${i % 6 ? 0.6 : 1}"/>` }
  for (const e of D.events) s += arc(e.start, Math.max(e.end, e.start + 0.1), R - 8, 5, P.accent, 1)
  const sc = 2 * Math.PI * (R - 18)
  s += `<circle cx="${c}" cy="${c}" r="${R - 18}" fill="none" stroke="${P.line}" stroke-width="2"/><circle cx="${c}" cy="${c}" r="${R - 18}" fill="none" stroke="${P.accent}" stroke-width="2" stroke-dasharray="${sc.toFixed(1)}" transform="rotate(-90 ${c} ${c})"><animate attributeName="stroke-dashoffset" from="${(sc * (1 - now.getSeconds() / 60)).toFixed(1)}" to="0" dur="${60 - now.getSeconds()}s" fill="freeze"/></circle>`
  const deg = ((h - 12) / 24) * 360
  s += `<g transform="rotate(${deg.toFixed(2)} ${c} ${c})"><animateTransform attributeName="transform" type="rotate" from="${deg.toFixed(2)} ${c} ${c}" to="${(deg + 360).toFixed(2)} ${c} ${c}" dur="86400s" repeatCount="indefinite"/><line x1="${c}" y1="${c - 16}" x2="${c}" y2="${c - R + 1}" stroke="${P.accent}" stroke-width="1.5"/><circle cx="${c}" cy="${c - R + 1}" r="2.5" fill="${P.accent}"><animate attributeName="r" values="2.5;4;2.5" dur="2.4s" repeatCount="indefinite"/></circle></g>`
  const nx = D.events.find(e => e.end > h)
  const label = nx ? (nx.start > h ? hmLeft(nx.start - h) : 'now') : '—'
  s += `<text x="${c}" y="${c + 4}" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-size="12" font-weight="600" fill="${P.ink}">${label}</text></svg>`
  return s
}
let ringCache = { key: '', src: '' }
const ringFor = (now: Date) => {
  const key = `${P === DAY}|${D.events.map(e => e.start + e.end).join(',')}|${Math.floor(now.getTime() / 60000)}`
  if (ringCache.key !== key) ringCache = { key, src: ringSvg(now) }
  return ringCache.src
}

function gaugeSvg(n: number, max: number, band: string) {
  const r = 40, c = 50, a0 = -225, sweep = 270
  const pt = (d: number, rr: number): [number, number] => [c + rr * Math.cos((d * Math.PI) / 180), c + rr * Math.sin((d * Math.PI) / 180)]
  const fr = Math.max(0, Math.min(n / max, 1))
  const [sx, sy] = pt(a0, r), [ex, ey] = pt(a0 + sweep * fr, r), [fx, fy] = pt(45, r)
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="74" viewBox="0 0 100 92"><rect width="100" height="92" fill="${P.panel}"/><path d="M${sx.toFixed(1)} ${sy.toFixed(1)}A${r} ${r} 0 1 1 ${fx.toFixed(1)} ${fy.toFixed(1)}" fill="none" stroke="${P.line}" stroke-width="6"/>`
  for (let i = 0; i <= 18; i++) { const d = a0 + i * 15, [x1, y1] = pt(d, r + 7), [x2, y2] = pt(d, r + (i % 6 ? 9 : 12)); s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${P.muted}" stroke-width="${i % 6 ? 0.6 : 1}"/>` }
  if (n > 0) s += `<path d="M${sx.toFixed(1)} ${sy.toFixed(1)}A${r} ${r} 0 ${sweep * fr > 180 ? 1 : 0} 1 ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="${band}" stroke-width="6">${band === P.red ? '<animate attributeName="opacity" values="1;.4;1" dur="2.4s" repeatCount="indefinite"/>' : ''}</path>`
  s += `<text x="50" y="58" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-size="26" font-weight="600" fill="${P.ink}">${n < 0 ? '—' : n}</text></svg>`
  return s
}
const clockGlyph = () => `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><rect x="1" y="1" width="16" height="16" rx="2" fill="none" stroke="${P.amber}"/><circle cx="9" cy="9" r="4.5" fill="none" stroke="${P.amber}"/><path d="M9 6.5V9l2 1.2" fill="none" stroke="${P.amber}"/></svg>`

// ---- module -----------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e: any, next) => {
    const stored = await $.store.get('theme')
    try {
      const row: any = (await $.config.list()).find((r: any) => r.key === 'theme')
      const t = String(row?.value ?? '')
      P = stored === 'light' ? DAY : stored === 'dark' ? DARK : /light|day/i.test(t) ? DAY : DARK
    } catch { P = stored === 'light' ? DAY : DARK }
    const w = await $.store.get('width')
    if (typeof w === 'number') wantCols = w
    await $.command.register({ name: 'hud', description: 'Bridge: open or collapse the pane' })
    await $.command.register({ name: 'hud-refresh', description: 'Bridge: refresh all data now' })
    updateStrip($)
    // once a minute, held while the person scrolls; data changes redraw on their own
    $.clock.every(60000, () => { if (scrollOffset === 0) $.ui.invalidate('ui.render'); updateStrip($); void refreshAll($) })
    const r = await next(e)
    void (async () => { try { await openPane($) } catch (x) { await note($, `open failed ${err(x)}`) } })()
    return r
  })

  on('command.run', { command: 'hud' }, async $ => {
    if (isOpen) { await closePane($); return { text: 'Bridge collapsed.' } }
    await openPane($); return { text: 'Bridge opened.' }
  })
  on('command.run', { command: 'hud-refresh' }, async $ => { void refreshAll($, true); return { text: 'Refreshing Bridge data.' } })

  on('ui.close', async ($, e: any, next) => {
    if (e?.id === PANE) { isOpen = false; updateStrip($) }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e: any) => {
    scrollOffset = Number(e.props?.scroll?.offset ?? 0)
    const { Box, Text, Button, Link, Svg, Input } = $.ui.resolve(e) as any
    const now = new Date()
    const hr = hrs(now)
    const nx = D.events.find(ev => ev.end > hr)
    const later = D.events.filter(ev => ev.end > hr && ev !== nx)[0]
    const bandOf = (n: number, calm: number, amber: number) => (n < 0 ? P.muted : n <= calm ? P.ok : n <= amber ? P.amber : P.red)
    const bandWord = (n: number, calm: number, amber: number) => (n < 0 ? 'NO DATA' : n <= calm ? 'CALM' : n <= amber ? 'AMBER' : 'RED')
    const hk = (k: string, label: string, fn: () => void, variant?: string) => <Button key={`k-${k}`} label={label} hotkey={k} {...(variant ? { variant } : {})} onPress={() => { fn(); $.ui.invalidate('ui.render') }} />
    const panel = (key: string, title: string, right: any, kids: any) => (
      <Box key={key} flexDirection="column" borderStyle="single" borderColor={P.line} backgroundColor={P.panel} padding={1} gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text color={P.accent} size="caption" weight="semibold">{title}</Text>
          {right}
        </Box>
        {kids}
      </Box>
    )
    const dash = (v: number) => (v < 0 ? '—' : String(v))

    // ---- masthead
    const masthead = (
      <Box key="mast" flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text color={P.accent} size="caption" weight="bold">BRIDGE</Text>
          <Text color={P.ink} size="footnote" tabular>{hhmm(now)}</Text>
        </Box>
        <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          {hk('m', '▶ Morning', () => { void runBrief($, 'morning', 'Morning brief') }, 'primary')}
          {hk('e', 'Evening', () => { void runBrief($, 'evening', 'Evening close') })}
          {hk('w', 'Week', () => { void runBrief($, 'weekly review', 'Week review') })}
          <Link href={BOARD} label="Board ↗" />
          {hk('c', '⟩ Collapse', () => { void closePane($) })}
        </Box>
      </Box>
    )

    // ---- next meeting, with the timer folded in
    const timerRow = D.timer ? (
      <Box key="timer" flexDirection="row" gap={1} alignItems="center" borderStyle="single" borderColor={P.accent} backgroundColor={P.asoft} padding={1}>
        {Svg ? <Svg source={`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="${P.accent}"><animate attributeName="opacity" values="1;.25;1" dur="1.2s" repeatCount="indefinite"/></circle></svg>`} alt="Timer running" isInteractive width={8} height={8} /> : null}
        <Box flexDirection="column" flexGrow={1}>
          <Text color={P.accent} size="caption" weight="semibold">TIMER · RUNNING</Text>
          <Text color={P.ink} size="footnote">{D.timer.name}</Text>
        </Box>
        <Text color={P.accent} size="heading" weight="bold" tabular>{mins(now.getTime() - D.timer.start)}</Text>
        <Button key="stop" label="■ Stop" onPress={() => { void stopTimer($) }} />
      </Box>
    ) : null
    const next_ = (
      <Box key="next" flexDirection="column" borderStyle="single" borderColor={P.line} backgroundColor={P.panel} padding={1} gap={1}>
        <Box flexDirection="row" gap={2} alignItems="center">
          {Svg ? <Svg source={ringFor(now)} alt="Day ring with the countdown to the next meeting" isInteractive width={96} height={96} /> : null}
          <Box flexDirection="column" flexGrow={1} gap={0}>
            <Text color={P.muted} size="caption" weight="semibold">{nx ? `NEXT · ${hm(nx.start)}` : D.eventsErr ? 'NEXT · NO DATA' : 'NEXT'}</Text>
            <Text color={P.ink} size="heading" weight="semibold">{nx ? nx.subject : D.eventsErr ? '—' : 'Nothing more today'}</Text>
            <Text color={P.muted} size="footnote">{nx ? (nx.start > hr ? `in ${hmLeft(nx.start - hr)}` : 'now') : ' '}</Text>
            <Text color={P.muted} size="footnote">{later ? `then · ${later.subject} ${hm(later.start)}` : ' '}</Text>
          </Box>
        </Box>
        {D.eventsErr ? <Text color={P.amber} size="caption">Calendar: {D.eventsErr.slice(0, 140)}</Text> : null}
        {timerRow}
      </Box>
    )

    // ---- focus
    const rows = D.tasks.slice(0, 7).map(t => {
      const sy = sync[t.id]
      const running = D.timer?.taskId === t.id
      const el = (D.trackedBy[t.id] ?? 0) + (running ? now.getTime() - D.timer!.start : 0)
      const due = t.due < dayStart() ? 'overdue' : 'today'
      return (
        <Box key={t.id} flexDirection="row" gap={1} alignItems="center" {...(running ? { backgroundColor: P.asoft } : {})}>
          {Svg ? <Svg source={clockGlyph()} alt="Close needs approval" width={18} height={18} /> : null}
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text color={P.ink} size="body">{t.name}</Text>
            <Text color={due === 'overdue' ? P.amber : P.muted} size="caption">{t.list} · {due}</Text>
          </Box>
          {sy ? (
            sy.s === 'fail' ? (
              <Box flexDirection="row" gap={1} alignItems="center">
                <Text color={P.amber} size="caption" weight="bold">FAILED</Text>
                <Button key={`retry-${t.id}`} label="Retry" onPress={() => { void (running ? stopTimer($) : startTimer($, t)) }} />
              </Box>
            ) : <Text color={sy.s === 'ok' ? P.ok : P.accent} size="caption" weight="bold">{sy.s === 'ok' ? '✓ SYNCED' : 'SYNCING'}</Text>
          ) : <Text color={P.amber} size="caption">NEEDS APPROVAL</Text>}
          <Text color={running ? P.accent : P.muted} size="footnote" tabular>{el > 0 ? mins(el) : '0:00'}</Text>
          {running
            ? <Button key={`s-${t.id}`} label="■" onPress={() => { void stopTimer($) }} />
            : <Button key={`p-${t.id}`} label="▶" onPress={() => { void startTimer($, t) }} />}
        </Box>
      )
    })
    const focus = panel('focus', 'FOCUS · CLICKUP', (
      <Text color={P.muted} size="caption" tabular>{D.tasksErr ? 'NO DATA' : `${D.tasks.length} due or overdue${D.tracked >= 0 ? ` · tracked ${mins(D.tracked + (D.timer ? now.getTime() - D.timer.start : 0))}` : ''}`}</Text>
    ), (
      <Box flexDirection="column" gap={1}>
        {D.tasksErr ? <Text color={P.amber} size="footnote">ClickUp: {D.tasksErr.slice(0, 160)}</Text> : null}
        {!D.tasksErr && !D.tasks.length ? <Text color={P.muted} size="footnote">Nothing due or overdue.</Text> : null}
        {rows}
        {D.tasks.length > 7 ? <Text color={P.muted} size="caption">+ {D.tasks.length - 7} more</Text> : null}
        {D.timeErr ? <Text color={P.amber} size="caption">Timers: {D.timeErr.slice(0, 140)}</Text> : null}
      </Box>
    ))

    // ---- comms (one line, key 4 expands)
    const catCount = (nn: string) => { const c = D.cats[nn]; return c === undefined ? '…' : c === null ? '—' : `${c.n}${c.more ? '+' : ''}` }
    const line = `Outlook ${dash(D.unread)} · Teams NOT WIRED · ${catCount('01')} follow up · ${catCount('03')} waiting`
    const catBox = (nn: string, name: string, i: number, big: boolean) => (
      <Box key={nn} flexDirection="row" gap={1} alignItems="stretch" borderStyle="single" borderColor={P.line} paddingRight={1}>
        <Box width={big ? 2 : 1} backgroundColor={P.cat[i]!} />
        <Text color={P.cat[i]!} size="caption">[{nn}]</Text>
        <Text color={P.ink} size={big ? 'heading' : 'footnote'} weight="bold" tabular>{catCount(nn)}</Text>
        <Text color={P.muted} size="caption">{name}</Text>
      </Box>
    )
    const comms = panel('comms', 'COMMS', (
      <Button key="k-4" label={open.comms ? '‹ 4 Collapse' : '› 4 Expand'} hotkey="4" onPress={() => { open.comms = !open.comms; $.ui.invalidate('ui.render') }} />
    ), (
      open.comms ? (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={2} flexWrap="wrap">
            <Text color={P.ink} size="footnote">Outlook unread <Text color={P.ink} weight="bold" tabular>{dash(D.unread)}</Text></Text>
            <Text color={P.muted} size="footnote">Teams NOT WIRED</Text>
          </Box>
          <Box flexDirection="row" gap={1} flexWrap="wrap">{CATS.map(([nn, name], i) => catBox(nn, name, i, nn === '01' || nn === '03'))}</Box>
          <Text color={P.muted} size="caption">Category counts are messages in the category, up to 25 per category (+ means more).</Text>
          {D.mailErr ? <Text color={P.amber} size="caption">Mail: {D.mailErr.slice(0, 140)}</Text> : null}
          {D.catsErr ? <Text color={P.amber} size="caption">Categories: {D.catsErr.slice(0, 140)}</Text> : null}
        </Box>
      ) : <Text color={P.ink} size="footnote">{line}</Text>
    ))

    // ---- radar
    const gaugeBox = (key: string, n: number, max: number, calm: number, amber: number, label: string, more = false) => (
      <Box key={key} flexDirection="column" alignItems="center" gap={0}>
        {Svg ? <Svg source={gaugeSvg(n, max, bandOf(n, calm, amber))} alt={`${label} ${n}`} isInteractive width={80} height={74} /> : null}
        <Text color={bandOf(n, calm, amber)} size="caption" weight="bold">{bandWord(n, calm, amber)}{more ? '+' : ''}</Text>
        <Text color={P.muted} size="footnote">{label}</Text>
      </Box>
    )
    const radar = panel('radar', 'RADAR', <Text color={P.muted} size="caption">VAULT · CLICKUP</Text>, (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={3} justifyContent="center">
          {gaugeBox('stale', D.stale, 60, 20, 40, 'Stale notes')}
          {gaugeBox('over', D.overdue, 10, 2, 9, 'Overdue ClickUp', D.overdueMore)}
        </Box>
        {D.vaultErr ? <Text color={P.amber} size="caption">Vault: {D.vaultErr.slice(0, 140)}</Text> : null}
      </Box>
    ))

    // ---- monitoring and second brain, folded
    const mon = panel('mon', 'MONITORING', (
      <Button key="k-6" label={open.monitoring ? '‹ 6 Collapse' : '› 6 Expand'} hotkey="6" onPress={() => { open.monitoring = !open.monitoring; $.ui.invalidate('ui.render') }} />
    ), open.monitoring ? (
      <Box flexDirection="column" gap={1}>
        {AREAS.map(a => (
          <Box key={a} flexDirection="row" justifyContent="space-between" gap={1}>
            <Text color={P.ink} size="footnote">{a}</Text>
            <Text color={P.muted} size="caption" weight="bold">{/Grafana/.test(a) ? 'NOT WIRED' : '—'}</Text>
          </Box>
        ))}
        <Text color={P.muted} size="caption">Cards and dashboard links arrive in phase 2.</Text>
      </Box>
    ) : <Text color={P.ink} size="footnote">{AREAS.length} areas · no figures wired yet · Fleet NOT WIRED</Text>)
    const brain = panel('brain', 'SECOND BRAIN', (
      <Button key="k-7" label={open.brain ? '‹ 7 Collapse' : '› 7 Expand'} hotkey="7" onPress={() => { open.brain = !open.brain; $.ui.invalidate('ui.render') }} />
    ), open.brain ? (
      <Box flexDirection="column" gap={1}>
        <Text color={P.ink} size="footnote">Stale notes {dash(D.stale)} · 01-Inbox files {dash(D.inbox)}</Text>
        <Text color={P.muted} size="caption">Search, recent notes and the orbit page arrive in phase 2.</Text>
      </Box>
    ) : <Text color={P.ink} size="footnote">stale {dash(D.stale)} · inbox {dash(D.inbox)}</Text>)

    // ---- capture
    const cap = panel('cap', 'CAPTURE → 01-INBOX', capNote ? <Text color={capNote.startsWith('Failed') ? P.amber : P.ok} size="caption">{capNote}</Text> : <Text color={P.muted} size="caption"> </Text>, (
      <Box flexDirection="row" gap={1} alignItems="center">
        {Input ? <Input key="cap" placeholder="Capture → 01-Inbox" value={capture} onInput={(t: string) => { capture = t }} onSubmit={() => { void fileCapture($) }} submitLabel="file" /> : null}
        {hk('n', 'File', () => { void fileCapture($) }, 'primary')}
      </Box>
    ))

    const last = logLines[logLines.length - 1]
    const foot = (
      <Box key="foot" flexDirection="column" gap={0}>
        {last ? <Text color={last.warn ? P.amber : P.muted} size="caption">{last.t} · {last.m}</Text> : null}
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text color={P.muted} size="caption">M morning · E evening · W week · C collapse · 4 comms · 6 monitoring · 7 brain · N file ·</Text>
          {hk('t', P === DAY ? 'Theme: daylight' : 'Theme: dark', () => { P = P === DAY ? DARK : DAY; ringCache.key = ''; void $.store.set('theme', P === DAY ? 'light' : 'dark') })}
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1} padding={1} backgroundColor={P.field}>
        {masthead}
        {next_}
        {focus}
        {comms}
        {radar}
        {mon}
        {brain}
        {cap}
        {foot}
      </Box>
    )
  })

  // collapsed: the band above the prompt; the strip under it is the status line
  on('ui.render', { component: 'AbovePrompt' }, async ($, e: any, next) => {
    if (isOpen) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e) as any
    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text color={P.accent} weight="semibold">BRIDGE</Text>
        <Text color={P.muted}>{D.tasks.length} open{D.timer ? ` · ▶ ${mins(Date.now() - D.timer.start)}` : ''} · inbox {D.unread >= 0 ? D.unread : '—'}</Text>
        <Button key="band-morning" label="▶ Morning brief" variant="primary" onPress={() => { void runBrief($, 'morning', 'Morning brief') }} />
        <Button key="band-open" label="⟨ Pane" hotkey="c" onPress={() => { void openPane($) }} />
      </Box>
    )
  })
}
