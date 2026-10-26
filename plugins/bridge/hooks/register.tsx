import type { Register } from 'claude-code'

const VERSION = '0.3.1'
const PANE = 'bridge'
const BOARD = 'https://claude.ai/artifact/Xmi8Zam4rQdaYutpmBkbjT'
const BOARD_PAGES = ['Cortex', 'Team', 'Infrastructure', 'Projects', 'Products', 'Registers']
// ClickUp's daily limit is shared by every chat, page and agent: poll gently, keep a saved copy.
const POLL = { tasks: 15 * 60000, timer: 2 * 60000, entries: 10 * 60000, outlook: 5 * 60000, slow: 10 * 60000 }
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
  tasks: [] as Task[], overdue: -1, overdueMore: false, tasksErr: '', tasksAt: 0, tasksOkAt: 0,
  timer: null as null | { taskId: string; name: string; start: number }, timerAt: 0, tracked: -1, trackedBy: {} as Record<string, number>, trackedAt: 0, trackedOkAt: 0, timeErr: '',
  limitUntil: 0, limitAt: 0, perm: {} as Record<string, string>,
  cuCalls: 0, cuDay: '',
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
// A failed call is classified once, so the pane can say what to do instead of dumping an error.
const mk = (kind: 'limit' | 'perm' | 'other', msg: string, rule = '') => Object.assign(new Error(msg), { kind, rule })
const limitMsg = () => `ClickUp daily limit reached · resets ~${D.limitUntil ? hhmm(new Date(D.limitUntil)) : '12:00'}`
const fr = (e: any) => (e?.kind === 'limit' ? limitMsg() : e?.kind === 'perm' ? `Needs permission · add "${e.rule}" to permissions.allow` : err(e).slice(0, 140))
const classify = (srv: string, tool: string, text: string) => {
  if (/RATE_LIMIT_EXCEEDED|Daily MCP limit|limit reached/i.test(text)) {
    const secs = /"retryAfter"\s*:\s*(\d+)/.exec(text)
    const hm_ = /Try again in (\d+)h\s*(\d+)m/i.exec(text)
    const wait = secs ? Number(secs[1]) * 1000 : hm_ ? (Number(hm_[1]) * 60 + Number(hm_[2])) * 60000 : 6 * 3600000
    D.limitAt = Date.now(); D.limitUntil = Date.now() + wait
    return mk('limit', limitMsg())
  }
  if (/classifier/i.test(text)) { const rule = `mcp__${srv}__${tool}`; D.perm[tool] = rule; return mk('perm', `needs permission ${rule}`, rule) }
  return mk('other', `${tool}: ${text.slice(0, 160)}`)
}
const call = async ($: any, tool: string, args: Record<string, unknown>) => {
  if (!Object.keys(servers).length) await discover($)
  const srv = Object.keys(servers).find(s => servers[s]!.includes(tool))
  if (!srv) throw mk('other', `no connected server exposes ${tool}`)
  if (tool.startsWith('clickup_')) {
    if (Date.now() < D.limitUntil) throw mk('limit', limitMsg())
    const day = ymd(new Date())
    if (D.cuDay !== day) { D.cuDay = day; D.cuCalls = 0 }
    D.cuCalls++
    void $.store.set('cuCalls', { day, n: D.cuCalls })
    void note($, `ClickUp call ${D.cuCalls} today: ${tool}`)
  }
  const bad = (text: string) => { const ce = classify(srv, tool, text); if (ce.kind === 'limit') void $.store.set('cuLimit', D.limitUntil); return ce }
  let r: any
  try { r = await $.mcp.call(srv, tool, args) } catch (e) { throw bad(err(e)) }
  if (r?.isError || /RATE_LIMIT_EXCEEDED/.test(textOf(r))) throw bad(textOf(r))
  return r
}

async function saveCache($: any) {
  try { await $.store.set('cuCache', { tasks: D.tasks, tasksOkAt: D.tasksOkAt, overdue: D.overdue, overdueMore: D.overdueMore, tracked: D.tracked, trackedBy: D.trackedBy, trackedOkAt: D.trackedOkAt, timer: D.timer, timerAt: D.timerAt }) } catch {}
}
async function loadCache($: any) {
  try {
    const c: any = await $.store.get('cuCache')
    if (c) Object.assign(D, { tasks: c.tasks ?? [], tasksOkAt: c.tasksOkAt ?? 0, overdue: c.overdue ?? -1, overdueMore: !!c.overdueMore, tracked: c.tracked ?? -1, trackedBy: c.trackedBy ?? {}, trackedOkAt: c.trackedOkAt ?? 0, timer: c.timer ?? null, timerAt: c.timerAt ?? 0 })
    const lim = Number(await $.store.get('cuLimit'))
    if (lim > Date.now()) D.limitUntil = lim
    const n: any = await $.store.get('cuCalls')
    if (n?.day === ymd(new Date())) { D.cuDay = n.day; D.cuCalls = Number(n.n) || 0 }
  } catch {}
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
  } catch (e) { D.eventsErr = fr(e) }
  touch($)
}

async function refreshTasks($: any) {
  D.tasksAt = Date.now()
  try {
    const r = await call($, 'clickup_filter_tasks', { assignees: [ME], due_date_to: ymd(new Date()), order_by: 'due_date', fields: ['due_date', 'list', 'status'] })
    const body = parseBlocks(r)[0] ?? {}
    const open_ = (body.tasks ?? []).filter((t: any) => !DEAD.test(String(t.status ?? '')))
    D.tasks = open_.map((t: any) => ({ id: String(t.id), name: String(t.name), list: String(t.list?.name ?? ''), due: Number(t.due_date) }))
    const t0 = dayStart()
    D.overdue = D.tasks.filter(t => t.due < t0).length
    D.overdueMore = !!body.has_more
    D.tasksErr = ''
    D.tasksOkAt = Date.now()
    await saveCache($)
  } catch (e) { D.tasksErr = fr(e) }
  touch($)
}

async function refreshTimerNow($: any) {
  D.timerAt = Date.now()
  try {
    const j = parseBlocks(await call($, 'clickup_get_current_time_entry', {}))[0] ?? {}
    if (!lastRaw) { lastRaw = 'x'; void note($, `current entry raw ${JSON.stringify(j).slice(0, 600)}`) }
    const ce = j.currentEntry ?? j.data
    if (j.isTracking === false || !ce) D.timer = null
    else D.timer = { taskId: String(ce.task?.id ?? ce.task_id ?? ''), name: String(ce.task?.name ?? ce.description ?? 'Task'), start: Number(ce.start ?? ce.start_time ?? Date.now()) }
    D.timeErr = ''
    await saveCache($)
  } catch (e) { D.timeErr = fr(e) }
  touch($)
}

async function refreshEntries($: any) {
  D.trackedAt = Date.now()
  try {
    const d = new Date(), n = new Date(d.getTime() + 864e5)
    const j = parseBlocks(await call($, 'clickup_get_time_entries', { assignee: [ME], start_date: `${ymd(d)} 00:00`, end_date: `${ymd(n)} 00:00` }))[0] ?? {}
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
    D.timeErr = ''
    D.trackedOkAt = Date.now()
    await saveCache($)
  } catch (e) { D.timeErr = fr(e) }
  touch($)
}
const refreshTimer = async ($: any) => { await refreshTimerNow($); await refreshEntries($) }

async function refreshMail($: any) {
  try {
    const folders = parseBlocks(await call($, 'read_resource', { uri: 'mail:///folders/' }))
    const inbox = folders.find((f: any) => f.name === 'Inbox')
    D.unread = inbox ? Number(inbox.unreadCount) : -1
    D.mailErr = inbox ? '' : 'Inbox folder not found'
  } catch (e) { D.mailErr = fr(e) }
  touch($)
}

async function refreshCats($: any) {
  D.catsErr = ''
  for (const [nn, name] of CATS) {
    try {
      const items = parseBlocks(await call($, 'outlook_email_search', { query: `category:"[${nn}] ${name}"`, limit: 25 }))
      const msgs = items.filter((x: any) => x.subject)
      D.cats[nn] = { n: msgs.length, more: items.some((x: any) => x.moreResults) }
    } catch (e) { D.cats[nn] = null; D.catsErr = fr(e) }
  }
  touch($)
}

async function scanVault($: any, dir: string, st: { files: number; stale: number; idx: { rel: string; name: string; mtime: number }[] }) {
  let ents: any[] = []
  try { ents = await $.fs.list(dir) } catch { return }
  for (const en of ents) {
    if (st.files >= 1500) return
    if (en.kind === 'dir') { if (!/^(\.|_attachments$|Claude outputs$)/.test(en.name)) await scanVault($, `${dir}/${en.name}`, st); continue }
    if (!en.name.endsWith('.md')) continue
    st.files++
    st.idx.push({ rel: dir.replace(VAULT + "/", "").replace(VAULT, ""), name: en.name, mtime: Number(en.mtimeMs ?? 0) })
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
    const st = { files: 0, stale: 0, idx: [] as { rel: string; name: string; mtime: number }[] }
    await scanVault($, VAULT, st)
    D.stale = st.stale
    vaultIndex = st.idx
    D.inbox = ((await $.fs.list(`${VAULT}/01-Inbox`)) as any[]).filter(e => e.kind === 'file').length
    D.vaultErr = ''
  } catch (e) { D.vaultErr = fr(e) }
  touch($)
}

// Fetch only what is older than its poll interval; force (the button, /hud-refresh) fetches everything.
let lastOutlook = 0, lastSlow = 0
async function refreshAll($: any, force = false) {
  const now = Date.now()
  const due = (at: number, every: number) => force || now - at > every
  const jobs: Promise<void>[] = []
  if (due(lastOutlook, POLL.outlook)) { lastOutlook = now; jobs.push(refreshCalendar($), refreshMail($)) }
  if (due(D.tasksAt, POLL.tasks)) jobs.push(refreshTasks($))
  if (due(D.timerAt, POLL.timer)) jobs.push(refreshTimerNow($))
  if (due(D.trackedAt, POLL.entries)) jobs.push(refreshEntries($))
  await Promise.all(jobs)
  if (due(lastSlow, POLL.slow)) { lastSlow = now; await refreshVault($); if (isOpen) await refreshCats($) }
  if (force) addLog($, `Refreshed · ClickUp calls today ${D.cuCalls}`)
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
    void refreshTimerNow($)
    touch($)
    $.clock.after(2400, () => { delete sync[t.id]; touch($) })
  } catch (e) { sync[t.id] = { s: 'fail', msg: fr(e) }; addLog($, `Timer start failed · ${t.name} · ${fr(e)}`, true); touch($) }
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
  } catch (e) { sync[cur.taskId] = { s: 'fail', msg: fr(e) }; addLog($, `Timer stop failed · ${cur.name} · ${fr(e)}`, true); touch($) }
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
    D.tasksOkAt ? `${D.tasks.length} open` : 'open —',
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
  void refreshAll($, false)
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

// ---- phase 2 drawings: timeline, day clock, monitoring art, vertical titles ----

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function timelineSvg(W: number, now: Date) {
  const x = (hh: number) => 8 + ((hh - 6) / 14) * (W - 16)
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="56" viewBox="0 0 ${W} 56"><rect width="${W}" height="56" fill="${P.panel}"/><line x1="8" y1="38" x2="${W - 8}" y2="38" stroke="${P.line}"/>`
  for (let hh = 6; hh <= 20; hh++) {
    const X = x(hh)
    s += `<line x1="${X.toFixed(1)}" y1="38" x2="${X.toFixed(1)}" y2="${hh % 2 ? 41 : 44}" stroke="${P.line}"/>`
    if (hh % 2 === 0) s += `<text x="${X.toFixed(1)}" y="54" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-size="10" fill="${P.muted}">${f2(hh)}</text>`
  }
  for (const ev of D.events) {
    const X = x(Math.max(6, ev.start)), w = Math.max(3, x(Math.min(20, ev.end)) - X)
    s += `<rect x="${X.toFixed(1)}" y="10" width="${w.toFixed(1)}" height="20" fill="${P.accent}"><title>${esc(ev.subject)} ${hm(ev.start)}</title></rect>`
    if (w > ev.subject.length * 6.6 + 12) s += `<text x="${(X + 6).toFixed(1)}" y="24" font-family="Segoe UI, system-ui, sans-serif" font-size="10" fill="${P === DAY ? '#ffffff' : '#061018'}">${esc(ev.subject)}</text>`
  }
  const hh = Math.min(20, Math.max(6, hrs(now)))
  const x0 = x(hh), x1 = x(20)
  s += `<g transform="translate(${x0.toFixed(1)} 0)"><line x1="0" y1="2" x2="0" y2="48" stroke="${P.accent}" stroke-width="1.5"/><path d="M-5 2h10l-5 6z" fill="${P.accent}"/><text x="7" y="10" font-family="Segoe UI, system-ui, sans-serif" font-size="10" fill="${P.accent}">${hhmm(now)}</text><animateTransform attributeName="transform" type="translate" from="${x0.toFixed(1)} 0" to="${x1.toFixed(1)} 0" dur="${Math.max(60, Math.round((20 - hh) * 3600))}s" fill="freeze"/></g></svg>`
  return s
}

function dayClockSvg(S: number, now: Date) {
  const c = 200, R = 186
  const ang = (hh: number) => ((hh - 12) / 24) * 2 * Math.PI - Math.PI / 2
  const pt = (hh: number, r: number): [number, number] => [c + r * Math.cos(ang(hh)), c + r * Math.sin(ang(hh))]
  const arc = (a: number, b: number, r: number, w: number, col: string, op: number) => {
    const [x1, y1] = pt(a, r), [x2, y2] = pt(b, r)
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${w}" opacity="${op}"/>`
  }
  const font = 'font-family="Segoe UI, system-ui, sans-serif"'
  const hrNow = hrs(now), sec = now.getSeconds()
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 400 400"><defs><radialGradient id="wg" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${P.accent}" stop-opacity="0"/><stop offset="1" stop-color="${P.accent}" stop-opacity=".16"/></radialGradient><filter id="gl"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect width="400" height="400" fill="${P.panel}"/>`
  s += `<circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="${P.line}"/>`
  for (let i = 0; i < 24; i++) {
    const [x1, y1] = pt(i, R), [x2, y2] = pt(i, R - (i % 6 ? 6 : 12))
    s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${P.muted}" stroke-width="${i % 6 ? 1 : 1.5}"/>`
    if (i % 3 === 0) { const [tx, ty] = pt(i, R - 24); s += `<text x="${tx.toFixed(1)}" y="${(ty + 4).toFixed(1)}" text-anchor="middle" ${font} font-size="11" fill="${P.muted}">${f2(i)}</text>` }
  }
  s += arc(6, 20, R - 40, 1, P.line, 1)
  for (const ev of D.events) s += arc(ev.start, Math.max(ev.end, ev.start + 0.1), R - 40, 10, P.accent, 1)
  const deg = ((hrNow - 12) / 24) * 360
  const rs = R - 76, sc = 2 * Math.PI * rs
  s += `<circle cx="${c}" cy="${c}" r="${rs}" fill="none" stroke="${P.line}" stroke-width="3"/><circle cx="${c}" cy="${c}" r="${rs}" fill="none" stroke="${P.accent}" stroke-width="3" stroke-dasharray="${sc.toFixed(1)}" transform="rotate(-90 ${c} ${c})"><animate attributeName="stroke-dashoffset" from="${(sc * (1 - sec / 60)).toFixed(1)}" to="0" dur="${60 - sec}s" fill="freeze"/></circle>`
  const RW = R - 2, sA = -Math.PI / 2 - (2 * Math.PI) / 24
  s += `<g transform="rotate(${deg.toFixed(2)} ${c} ${c})"><path d="M${c} ${c}L${(c + RW * Math.cos(sA)).toFixed(1)} ${(c + RW * Math.sin(sA)).toFixed(1)}A${RW} ${RW} 0 0 1 ${c} ${c - RW}z" fill="url(#wg)"/><line x1="${c}" y1="${c - 92}" x2="${c}" y2="${c - R + 2}" stroke="${P.accent}" stroke-width="1.5" filter="url(#gl)"/><circle cx="${c}" cy="${c - R + 2}" r="3.5" fill="${P.accent}"/><animateTransform attributeName="transform" type="rotate" from="${deg.toFixed(2)} ${c} ${c}" to="${(deg + 360).toFixed(2)} ${c} ${c}" dur="86400s" repeatCount="indefinite"/></g>`
  const nx = D.events.find(ev => ev.end > hrNow)
  const later = D.events.filter(ev => ev.end > hrNow && ev !== nx)[0]
  const lab = nx ? (nx.start > hrNow ? hmLeft(nx.start - hrNow) : 'now') : '—'
  s += `<text x="${c}" y="${c - 24}" text-anchor="middle" ${font} font-size="11" fill="${P.muted}">${nx ? `T-MINUS · ${esc(nx.subject.slice(0, 16))} ${hm(nx.start)}` : 'NO MORE MEETINGS TODAY'}</text><text x="${c}" y="${c + 10}" text-anchor="middle" ${font} font-size="30" font-weight="700" fill="${P.ink}" filter="url(#gl)">${lab}</text>${later ? `<text x="${c}" y="${c + 34}" text-anchor="middle" ${font} font-size="11" fill="${P.muted}">then · ${esc(later.subject.slice(0, 20))} ${hm(later.start)}</text>` : ''}</svg>`
  return s
}

// deterministic card art in one colour; no figure is drawn from data
function artSvg(kind: string, w: number, hgt: number, seed: number, col: string, op: number) {
  let x = seed * 9301 + 49297
  const rnd = () => { x = (x * 9301 + 49297) % 233280; return x / 233280 }
  let o = ''
  if (kind === 'wave') for (let k = 0; k < 3; k++) { let d = `M0 ${hgt * 0.55 + k * 8}`; for (let xx = 0; xx <= w; xx += 8) d += ` L${xx} ${(hgt * 0.55 + k * 8 + Math.sin(xx / 30 + k * 1.3) * (10 - k * 2)).toFixed(1)}`; o += `<path d="${d}" fill="none" stroke="${col}" stroke-opacity="${(0.75 - k * 0.2) * op}" stroke-width="${1.6 - k * 0.3}"/>` }
  else if (kind === 'rings') for (let k = 0; k < 4; k++) o += `<circle cx="${w / 2}" cy="${hgt / 2}" r="${10 + k * 11}" fill="none" stroke="${col}" stroke-opacity="${(0.55 - k * 0.1) * op}" stroke-width="${k % 2 ? 4 : 1.5}" stroke-dasharray="${(rnd() * 90 + 20).toFixed(0)} ${(rnd() * 40 + 10).toFixed(0)}"/>`
  else if (kind === 'nodes') { const pts: [number, number][] = []; for (let i = 0; i < 14; i++) pts.push([10 + rnd() * (w - 20), 6 + rnd() * (hgt - 12)]); pts.forEach((p, i) => pts.forEach((q, j) => { if (j > i && Math.hypot(p[0] - q[0], p[1] - q[1]) < 46) o += `<line x1="${p[0].toFixed(1)}" y1="${p[1].toFixed(1)}" x2="${q[0].toFixed(1)}" y2="${q[1].toFixed(1)}" stroke="${col}" stroke-opacity="${0.4 * op}"/>` })); pts.forEach(p => { o += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.5" fill="${col}" fill-opacity="${0.85 * op}"/>` }) }
  else for (let i = 0; i < Math.floor(w / 9); i++) { const bh = 8 + rnd() * (hgt - 14); o += `<rect x="${4 + i * 9}" y="${(hgt - bh).toFixed(1)}" width="5" height="${bh.toFixed(1)}" fill="${col}" fill-opacity="${(0.15 + rnd() * 0.5) * op}"/>` }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}"><rect width="${w}" height="${hgt}" fill="${P.panel}"/>${o}</svg>`
}

// native Text cannot rotate, so a narrow card's title is drawn as SVG text
function vtitleSvg(text: string, col: string, op: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="140" viewBox="0 0 30 140"><rect width="30" height="140" fill="${P.panel}"/><text transform="translate(19 134) rotate(-90)" font-family="Segoe UI, system-ui, sans-serif" font-size="12" fill="${col}" opacity="${op}">${esc(text.length > 20 ? text.slice(0, 19) + '…' : text)}</text></svg>`
}

const CARDS: { name: string; line: string; legacy: boolean; wired: boolean; art: string }[] = [
  { name: 'Engineering overview', line: 'The old Engineering board, still in the legacy style.', legacy: true, wired: true, art: 'bars' },
  { name: 'ECR tracker', line: 'Engineering change requests, in the legacy view.', legacy: true, wired: true, art: 'nodes' },
  { name: 'Toyota CEP development (1792)', line: 'Project 1792 on the board.', legacy: false, wired: true, art: 'rings' },
  { name: 'Engineering workload', line: 'Team workload on the board.', legacy: false, wired: true, art: 'wave' },
  { name: 'AI Rollout', line: 'AI rollout tracker on the board.', legacy: false, wired: true, art: 'nodes' },
  { name: 'HyQube supply plan 2027', line: 'Supply plan on the board.', legacy: false, wired: true, art: 'bars' },
  { name: 'FCSL Systems', line: 'Systems register on the board.', legacy: false, wired: true, art: 'rings' },
  { name: 'Fleet (Grafana)', line: 'No source connected yet.', legacy: false, wired: false, art: 'wave' },
]
let monActive = 0
let brainQuery = ''
let vaultIndex: { rel: string; name: string; mtime: number }[] = []

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
    await loadCache($)
    updateStrip($)
    // once a minute, held while the person scrolls; data changes redraw on their own
    // redraw from what is cached; fetch only while the pane is open and a source is past its interval
    $.clock.every(60000, () => { if (scrollOffset === 0) $.ui.invalidate('ui.render'); updateStrip($); if (isOpen) void refreshAll($) })
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
    const bc = Number(e.props?.bodyColumns ?? 60)
    // three layouts by pane width in columns; each drawing changes size only at a breakpoint
    const layout: 'narrow' | 'medium' | 'wide' = bc > 150 ? 'wide' : bc >= 90 ? 'medium' : 'narrow'
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
    const toggle = (k: string, key: 'comms' | 'monitoring' | 'brain') => <Button key={`k-${k}`} label={open[key] ? `‹ ${k} Collapse` : `› ${k} Expand`} hotkey={k} onPress={() => { open[key] = !open[key]; $.ui.invalidate('ui.render') }} />

    // ---- masthead
    const masthead = (
      <Box key="mast" flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text color={P.accent} size="caption" weight="bold">BRIDGE</Text>
          <Text color={P.ink} size="footnote" tabular>{hhmm(now)}</Text>
          {layout !== 'narrow' ? <Text color={P.muted} size="footnote">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()]} {now.getDate()} {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][now.getMonth()]}</Text> : null}
        </Box>
        <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          {hk('m', '▶ Morning', () => { void runBrief($, 'morning', 'Morning brief') }, 'primary')}
          {hk('e', 'Evening', () => { void runBrief($, 'evening', 'Evening close') })}
          {hk('w', 'Week', () => { void runBrief($, 'weekly review', 'Week review') })}
          {hk('r', '↻ Refresh', () => { void refreshAll($, true) })}
          <Link href={BOARD} label="Board ↗" />
          {hk('c', '⟩ Collapse', () => { void closePane($) })}
        </Box>
      </Box>
    )

    // ---- timer
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

    // ---- next meeting (ring) or, on the wide layout, the day clock
    const nextInfo = (
      <Box flexDirection="column" flexGrow={1} gap={0}>
        <Text color={P.muted} size="caption" weight="semibold">{nx ? `NEXT · ${hm(nx.start)}` : D.eventsErr ? 'NEXT · NO DATA' : 'NEXT'}</Text>
        <Text color={P.ink} size="heading" weight="semibold">{nx ? nx.subject : D.eventsErr ? '—' : 'Nothing more today'}</Text>
        <Text color={P.muted} size="footnote">{nx ? (nx.start > hr ? `in ${hmLeft(nx.start - hr)}` : 'now') : ' '}</Text>
        <Text color={P.muted} size="footnote">{later ? `then · ${later.subject} ${hm(later.start)}` : ' '}</Text>
      </Box>
    )
    const next_ = (
      <Box key="next" flexDirection="column" borderStyle="single" borderColor={P.line} backgroundColor={P.panel} padding={1} gap={1}>
        <Box flexDirection="row" gap={2} alignItems="center">
          {Svg ? <Svg source={ringFor(now)} alt="Day ring with the countdown to the next meeting" isInteractive width={96} height={96} /> : null}
          {nextInfo}
        </Box>
        {D.eventsErr ? <Text color={P.amber} size="caption">Calendar: {D.eventsErr.slice(0, 140)}</Text> : null}
        {layout === 'narrow' ? timerRow : null}
      </Box>
    )
    const clockPx = 340
    const clock_ = panel('clock', 'DAY CLOCK', <Text color={P.muted} size="caption">{D.events.length} meetings today</Text>, (
      <Box flexDirection="column" alignItems="center" gap={1}>
        {Svg ? <Svg source={dayClockSvg(clockPx, now)} alt="Day clock with today's meetings and the countdown" isInteractive width={clockPx} height={clockPx} /> : null}
        {D.eventsErr ? <Text color={P.amber} size="caption">Calendar: {D.eventsErr.slice(0, 140)}</Text> : null}
      </Box>
    ))
    const tlW = Math.max(600, Math.floor((bc * 7.5 - 40) / 100) * 100)
    const timeline = panel('timeline', 'TIMELINE · 06:00–20:00', <Text color={P.muted} size="caption">{D.events.length} on the calendar</Text>, (
      Svg ? <Svg source={timelineSvg(tlW, now)} alt="Day timeline with today's meetings and a now marker" isInteractive width={tlW} height={56} /> : null
    ))

    // ---- focus
    const maxRows = layout === 'wide' ? 10 : layout === 'medium' ? 8 : 7
    const rows = D.tasks.slice(0, maxRows).map(t => {
      const sy = sync[t.id]
      const running = D.timer?.taskId === t.id
      const el = (D.trackedBy[t.id] ?? 0) + (running ? now.getTime() - D.timer!.start : 0)
      const due = t.due < dayStart() ? 'overdue' : 'today'
      const code = /\b(\d{4})\b/.exec(`${t.list} ${t.name}`)
      return (
        <Box key={t.id} flexDirection="row" gap={1} alignItems="center" {...(running ? { backgroundColor: P.asoft } : {})}>
          {Svg ? <Svg source={clockGlyph()} alt="Close needs approval" width={18} height={18} /> : null}
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text color={P.ink} size="body">{t.name}</Text>
            <Text color={due === 'overdue' ? P.amber : P.muted} size="caption">{t.list}{code ? ` · ${code[1]}` : ''} · {due}</Text>
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
      <Text color={P.muted} size="caption" tabular>{!D.tasksOkAt ? 'NO DATA' : `${D.tasks.length} due or overdue${D.tracked >= 0 ? ` · tracked ${mins(D.tracked + (D.timer ? now.getTime() - D.timer.start : 0))}` : ''}${D.tasksErr ? ' · saved' : ''}`}</Text>
    ), (
      <Box flexDirection="column" gap={1}>
        {D.tasksErr ? <Text color={P.amber} size="footnote">{D.tasksErr} · {D.tasksOkAt ? `showing saved copy from ${hhmm(new Date(D.tasksOkAt))}` : 'nothing saved yet'}</Text> : null}
        {!D.tasksErr && !D.tasksOkAt ? <Text color={P.muted} size="footnote">Loading ClickUp…</Text> : null}
        {!D.tasksErr && D.tasksOkAt && !D.tasks.length ? <Text color={P.muted} size="footnote">Nothing due or overdue (checked {hhmm(new Date(D.tasksOkAt))}).</Text> : null}
        {rows}
        {D.tasks.length > maxRows ? <Text color={P.muted} size="caption">+ {D.tasks.length - maxRows} more</Text> : null}
        {D.timeErr ? <Text color={P.amber} size="caption">Timers: {D.timeErr}</Text> : null}
      </Box>
    ))

    // ---- comms: one line on the narrow layout (key 4 expands), always open on the others
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
    const commsOpen = layout !== 'narrow' || open.comms
    const comms = panel('comms', 'COMMS', layout === 'narrow' ? toggle('4', 'comms') : <Text color={P.muted} size="caption">OUTLOOK · TEAMS</Text>, (
      commsOpen ? (
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
        {D.tasksErr && D.tasksOkAt ? <Text color={P.muted} size="caption">Overdue is from the saved copy.</Text> : null}
        {D.vaultErr ? <Text color={P.amber} size="caption">Vault: {D.vaultErr.slice(0, 140)}</Text> : null}
      </Box>
    ))

    // ---- monitoring: folded row on the narrow layout, a card strip on the others
    // the strips share one row: the active card takes what is left after seven 34 px strips
    const panelPx = Math.floor((layout === 'wide' ? (bc - 4) * 0.4 : (bc - 4) * 0.5) * 7.5) - 40
    const cardPx = Math.max(170, Math.min(300, panelPx - 7 * 34))
    const strip = (() => {
      const ac = CARDS[monActive]!
      const art = (c: typeof ac, i: number, w: number, hgt: number) => (Svg ? <Svg source={artSvg(c.art, w, hgt, i + 1, c.wired ? P.accent : P.muted, c.wired ? 1 : 0.55)} alt={`${c.name} art`} width={w} height={hgt} /> : null)
      const others = CARDS.map((c, i) => ({ c, i })).filter(x => x.i !== monActive)
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1} alignItems="stretch">
            <Box flexDirection="column" borderStyle="single" borderColor={P.accent} backgroundColor={P.panel} padding={1} gap={1} width={Math.floor(cardPx / 7.5)}>
              {art(ac, monActive, cardPx - 24, 70)}
              <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
                <Text color={ac.wired ? P.accent : P.muted} size="caption" weight="bold">{ac.wired ? 'ON THE BOARD' : 'NOT WIRED'}</Text>
                {ac.legacy ? <Text color={P.amber} size="caption" weight="bold">LEGACY VIEW</Text> : null}
              </Box>
              <Text color={P.ink} size="body" weight="semibold">{ac.name}</Text>
              <Text color={P.muted} size="footnote">{ac.line}</Text>
              <Text color={P.muted} size="footnote" tabular>Figures —</Text>
              {ac.wired ? <Link href={BOARD} label="Open on the board ↗" /> : <Text color={P.muted} size="caption">Dimmed until a source is connected.</Text>}
            </Box>
            <Box flexDirection="row" gap={1} flexGrow={1}>
              {others.map(({ c, i }) => Svg ? <Svg key={c.name} source={vtitleSvg(c.name, c.wired ? P.ink : P.muted, c.wired ? 1 : 0.55)} alt={c.name} width={30} height={140} /> : null)}
            </Box>
          </Box>
          <Box flexDirection="row" gap={1} alignItems="center">
            <Button key="k-a" label="‹ Prev" hotkey="a" onPress={() => { monActive = (monActive + CARDS.length - 1) % CARDS.length; $.ui.invalidate('ui.render') }} />
            <Button key="k-d" label="Next ›" hotkey="d" onPress={() => { monActive = (monActive + 1) % CARDS.length; $.ui.invalidate('ui.render') }} />
            <Text color={P.muted} size="caption">{monActive + 1} of {CARDS.length} · pages inside the board: {BOARD_PAGES.join(' · ')}</Text>
          </Box>
        </Box>
      )
    })()
    const mon = layout === 'narrow'
      ? panel('mon', 'MONITORING', toggle('6', 'monitoring'), open.monitoring ? (
        <Box flexDirection="column" gap={1}>
          {CARDS.map(a => (
            <Box key={a.name} flexDirection="row" justifyContent="space-between" gap={1}>
              <Text color={P.ink} size="footnote">{a.name}</Text>
              <Text color={P.muted} size="caption" weight="bold">{a.wired ? (a.legacy ? 'LEGACY VIEW' : '—') : 'NOT WIRED'}</Text>
            </Box>
          ))}
          <Text color={P.muted} size="caption">Pages inside the board: {BOARD_PAGES.join(' · ')}</Text>
          <Link href={BOARD} label="Open the Bridge board ↗" />
        </Box>
      ) : (
        <Box flexDirection="row" gap={2} alignItems="center" flexWrap="wrap">
          <Text color={P.ink} size="footnote">{CARDS.length} areas · no figures wired yet · Fleet NOT WIRED</Text>
          <Link href={BOARD} label="Bridge board ↗" />
        </Box>
      ))
      : panel('mon', 'MONITORING', <Text color={P.muted} size="caption">{CARDS.length} areas · not wired last</Text>, strip)

    // ---- second brain: folded row on the narrow layout, a vault panel on the others
    const q = brainQuery.trim().toLowerCase()
    const found = (q ? vaultIndex.filter(n => n.name.toLowerCase().includes(q) || n.rel.toLowerCase().includes(q)) : [...vaultIndex].sort((a, b) => b.mtime - a.mtime)).slice(0, 6)
    const brain = layout === 'narrow'
      ? panel('brain', 'SECOND BRAIN', toggle('7', 'brain'), open.brain ? (
        <Box flexDirection="column" gap={1}>
          <Text color={P.ink} size="footnote">Stale notes {dash(D.stale)} · 01-Inbox files {dash(D.inbox)}</Text>
          <Text color={P.muted} size="caption">Search and recent notes show on the wider layouts.</Text>
          <Link href={BOARD} label="Cortex on the Bridge board ↗" />
        </Box>
      ) : (
        <Box flexDirection="row" gap={2} alignItems="center" flexWrap="wrap">
          <Text color={P.ink} size="footnote">stale {dash(D.stale)} · inbox {dash(D.inbox)}</Text>
          <Link href={BOARD} label="Cortex ↗" />
        </Box>
      ))
      : panel('brain', 'SECOND BRAIN', <Link href={BOARD} label="Open second brain ↗" />, (
        <Box flexDirection="column" gap={1}>
          <Text color={P.ink} size="footnote" tabular>Stale notes {dash(D.stale)} · 01-Inbox files {dash(D.inbox)} · {vaultIndex.length} notes indexed</Text>
          {Input ? <Input key="brain-q" placeholder="Search notes" value={brainQuery} onInput={(t: string) => { brainQuery = t; $.ui.invalidate('ui.render') }} onSubmit={() => {}} submitLabel="Search" /> : null}
          <Text color={P.muted} size="caption">{q ? `${found.length} match${found.length === 1 ? '' : 'es'}` : 'RECENT NOTES'}</Text>
          {found.map(n => (
            <Box key={n.rel} flexDirection="column" gap={0}>
              <Text color={P.ink} size="footnote">{n.name.replace(/\.md$/, '')}</Text>
              <Text color={P.muted} size="caption">{n.rel}</Text>
            </Box>
          ))}
          {!found.length ? <Text color={P.muted} size="footnote">{vaultIndex.length ? 'No notes match.' : 'The vault index is not loaded yet.'}</Text> : null}
        </Box>
      ))

    // ---- capture
    const cap = panel('cap', 'CAPTURE → 01-INBOX', capNote ? <Text color={capNote.startsWith('Failed') ? P.amber : P.ok} size="caption">{capNote}</Text> : <Text color={P.muted} size="caption"> </Text>, (
      <Box flexDirection="row" gap={1} alignItems="center">
        {Input ? <Input key="cap" placeholder="Capture → 01-Inbox" value={capture} onInput={(t: string) => { capture = t }} onSubmit={() => { void fileCapture($) }} submitLabel="File" /> : null}
      </Box>
    ))

    // ---- log (medium and wide)
    const logPanel = panel('log', 'LOG', <Text color={P.muted} size="caption">{logLines.length} events</Text>, (
      <Box flexDirection="column" gap={0}>
        {!logLines.length ? <Text color={P.muted} size="footnote">Nothing yet this session.</Text> : null}
        {logLines.slice(-12).map((l, i, arr) => (
          <Box key={`${l.t}-${i}`} flexDirection="row" gap={1}>
            <Text color={P.muted} size="footnote" tabular>{l.t}</Text>
            <Text color={l.warn ? P.amber : i === arr.length - 1 ? P.ink : P.muted} size="footnote">{l.m}</Text>
          </Box>
        ))}
      </Box>
    ))

    const last = logLines[logLines.length - 1]
    const foot = (
      <Box key="foot" flexDirection="column" gap={0}>
        {layout === 'narrow' && last ? <Text color={last.warn ? P.amber : P.muted} size="caption">{last.t} · {last.m}</Text> : null}
        <Text color={P.muted} size="caption">ClickUp calls today from this pane: {D.cuCalls} · tasks {D.tasksOkAt ? hhmm(new Date(D.tasksOkAt)) : '—'} · timers {D.trackedOkAt ? hhmm(new Date(D.trackedOkAt)) : '—'} · polls: tasks 15 min, timer 2, entries 10 (R forces)</Text>
        {D.perm['clickup_get_time_entries'] ? <Text color={P.amber} size="caption">Add to permissions.allow: {D.perm['clickup_get_time_entries']}</Text> : null}
        <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          <Text color={P.muted} size="caption">M morning · E evening · W week · R refresh · C collapse · {layout === 'narrow' ? '4 comms · 6 monitoring · 7 brain' : 'A / D cards'} ·</Text>
          {hk('t', P === DAY ? 'Theme: daylight' : 'Theme: dark', () => { P = P === DAY ? DARK : DAY; ringCache.key = ''; void $.store.set('theme', P === DAY ? 'light' : 'dark') })}
        </Box>
      </Box>
    )

    // ---- assemble
    const colW = (share: number) => Math.max(24, Math.floor((bc - 4) * share) - 1)
    let body: any
    if (layout === 'wide') {
      body = (
        <Box flexDirection="column" gap={1}>
          {timeline}
          <Box flexDirection="row" gap={1} alignItems="flex-start">
            <Box flexDirection="column" gap={1} width={colW(0.3)}>{timerRow}{focus}{cap}{brain}</Box>
            <Box flexDirection="column" gap={1} width={colW(0.4)}>{clock_}{mon}</Box>
            <Box flexDirection="column" gap={1} width={colW(0.3)}>{comms}{radar}{logPanel}</Box>
          </Box>
        </Box>
      )
    } else if (layout === 'medium') {
      body = (
        <Box flexDirection="row" gap={1} alignItems="flex-start">
          <Box flexDirection="column" gap={1} width={colW(0.5)}>{next_}{timerRow}{focus}{cap}</Box>
          <Box flexDirection="column" gap={1} width={colW(0.5)}>{comms}{radar}{brain}{mon}{logPanel}</Box>
        </Box>
      )
    } else {
      body = (
        <Box flexDirection="column" gap={1}>
          {next_}{focus}{comms}{radar}{mon}{brain}{cap}
        </Box>
      )
    }
    return (
      <Box flexDirection="column" gap={1} padding={1} backgroundColor={P.field}>
        {masthead}
        {body}
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
        <Text color={P.muted}>{D.tasksOkAt ? D.tasks.length : '—'} open{D.timer ? ` · ▶ ${mins(Date.now() - D.timer.start)}` : ''} · inbox {D.unread >= 0 ? D.unread : '—'}</Text>
        <Button key="band-morning" label="▶ Morning brief" variant="primary" onPress={() => { void runBrief($, 'morning', 'Morning brief') }} />
        <Button key="band-open" label="⟨ Pane" hotkey="c" onPress={() => { void openPane($) }} />
      </Box>
    )
  })
}
