import type { Register } from 'claude-code'

const VERSION = '0.2.2'
const PANE = 'bridge-test'
const BOARD = 'https://claude.ai/artifact/GN2tcQ42UgaNPiYshjgd26'
const VAULT = 'C:/vault'
const DIAG = '/tmp/bridge-test-diag.log'

// hud-* tokens from the Bridge design system (tokens.json), dark and daylight.
const DARK = { field: '#060a12', panel: '#0a1120', line: '#1b3550', ink: '#dcebf5', muted: '#7fa3bf', accent: '#5fd3ff', asoft: '#0f2236', seg: '#9fd9ff', ok: '#4fe3b0', amber: '#ffb347', red: '#ff5e5e' }
const DAY = { field: '#e6ecf2', panel: '#f7f9fb', line: '#b7c7d6', ink: '#0f1c2b', muted: '#4f6578', accent: '#0b74a8', asoft: '#dbe8f1', seg: '#3a9fd0', ok: '#0f7f5a', amber: '#a35a00', red: '#b8372b' }
let P = DARK

type Status = 'PASS' | 'FAIL' | 'PARTIAL' | 'WAIT' | 'RUN' | 'OBSERVE'
type Res = { s: Status; d: string }
const res: Record<string, Res> = {}
const viaOf: Record<string, string> = { t1b: 'clickup_filter_tasks', t1c: 'outlook_calendar_search', t1d: 'read_resource' }
const set = ($: any, id: string, s: Status, d: string) => { const v = viaOf[id] && lastVia[viaOf[id]!]; if (v && s === 'PASS') d += ` [via ${v}]`; res[id] = { s, d }; void note($, `${id} ${s} ${d}`); $.ui.invalidate('ui.render') }

let log = ''
const note = async ($: any, msg: string) => { log += `${new Date().toISOString()} ${msg}\n`; try { await $.fs.write(DIAG, log) } catch {} }

let isOpen = false
let wantCols = 60
let opens = 0
let prevOpens = 0
let loadedAt = ''
let themeRaw = '?'
let lastStatus = ''
let collapses = 0
let reopens = 0
let trySlash = false
let resizing = false
let paused = false
let byButton = false
const lastVia: Record<string, string> = {}
let lastOpen = '(none yet)'
const keys: Record<string, number> = { b: 0, c: 0, m: 0, e: 0, slash: 0 }
let capture = ''
let servers: Record<string, string[]> = {}
let events: { subject: string; start: number; end: number; allDay: boolean }[] = []
let gauges = { stale: -1, overdue: -1 }
let morningAt = 0
let cpu = '—'
const stats = { renders: 0, sumMs: 0, maxMs: 0, maxGap: 0, last: 0, since: Date.now() }

const f2 = (n: number) => String(n).padStart(2, '0')
const clock = () => { const d = new Date(); return `${f2(d.getHours())}:${f2(d.getMinutes())}:${f2(d.getSeconds())}` }
const ymd = (d: Date) => `${d.getFullYear()}-${f2(d.getMonth() + 1)}-${f2(d.getDate())}`
const hrs = (d: Date) => d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
const hm = (h: number) => `${f2(Math.floor(h))}:${f2(Math.floor((h % 1) * 60))}`
const err = (e: any) => String(e?.message ?? e)

const textOf = (r: any) => (r?.content ?? []).map((c: any) => c.text ?? '').join('\n')
const parseBlocks = (r: any): any[] => {
  const t = textOf(r).trim()
  if (!t) return []
  try { const v = JSON.parse(t); return Array.isArray(v) ? v : [v] } catch {}
  try { return JSON.parse('[' + t.replace(/}\s*{/g, '},{') + ']') } catch {}
  return []
}

async function discover($: any) {
  const tools: any[] = await $.tool.list()
  servers = {}
  for (const t of tools) {
    if (!t.mcp) continue
    const m = /^mcp__(.+?)__(.+)$/.exec(t.name)
    if (m) (servers[m[1]!] ??= []).push(m[2]!)
  }
  return tools
}
const serverOf = (tool: string) => Object.keys(servers).find(s => servers[s]!.includes(tool))
const call = async ($: any, tool: string, args: Record<string, unknown>) => {
  const srv = serverOf(tool)
  if (!srv) throw new Error(`no connected server exposes ${tool}`)
  let r: any
  let via = 'mcp.call'
  try { r = await $.mcp.call(srv, tool, args) } catch (e) {
    // auto mode's classifier can answer "no verdict" and says to issue the call once more as-is
    if (!/classifier/i.test(err(e))) throw e
    await note($, `retrying ${tool} after: ${err(e).slice(0, 120)}`)
    await $.clock.sleep(800)
    try { r = await $.mcp.call(srv, tool, args); via = 'mcp.call retry' } catch (e2) {
      if (!/classifier/i.test(err(e2))) throw e2
      // the other route: the model's own tool path, with its permission check
      await note($, `falling back to $.tool.call for ${tool}`)
      const t: any = await $.tool.call({ tool: `mcp__${srv}__${tool}`, ...args })
      r = { content: [{ type: 'text', text: t?.text ?? JSON.stringify(t) }], isError: t?.isError }
      via = 'tool.call'
    }
  }
  lastVia[tool] = via
  if (r?.isError) throw new Error(`${tool}: ${textOf(r).slice(0, 300)}`)
  return r
}

// ---- tests -----------------------------------------------------------------

async function t1($: any) {
  for (const k of ['t1', 't1a', 't1b', 't1c', 't1d', 't1e']) set($, k, 'RUN', 'running')
  let tools: any[] = []
  try { tools = await discover($) } catch (e) { set($, 't1a', 'FAIL', `$.tool.list threw: ${err(e)}`) }
  const names = Object.keys(servers)
  if (names.length) set($, 't1a', 'PASS', `${names.length} MCP servers, ${tools.filter(t => t.mcp).length} tools · ` + names.map(n => `${n.slice(0, 12)}…(${servers[n]!.length})`).join(' '))
  else set($, 't1a', 'FAIL', `no MCP tools visible (${tools.length} tools in all)`)

  try {
    const today = ymd(new Date())
    const r = await call($, 'clickup_filter_tasks', { assignees: ['80462914'], due_date_to: today, order_by: 'due_date', fields: ['due_date', 'list', 'status'] })
    const body = parseBlocks(r)[0] ?? {}
    const dead = /^(not required|shipped|closed|complete|completed|done|cancelled|canceled|rejected)$/i
    const open = (body.tasks ?? []).filter((t: any) => !dead.test(String(t.status ?? '')))
    gauges.overdue = open.length
    const top = open.slice(0, 5).map((t: any) => `${t.name} (${t.list?.name ?? '?'}, due ${ymd(new Date(Number(t.due_date)))})`)
    set($, 't1b', open.length || body.tasks ? 'PASS' : 'PARTIAL', `${open.length} open due today or overdue${body.has_more ? ' (first page only)' : ''}. Top 5: ${top.join(' | ') || 'none'}`)
  } catch (e) { set($, 't1b', 'FAIL', err(e)) }

  try {
    const d = new Date(); const next = new Date(d.getTime() + 864e5)
    const r = await call($, 'outlook_calendar_search', { query: '*', afterDateTime: `${ymd(d)}T00:00:00`, beforeDateTime: `${ymd(next)}T00:00:00`, limit: 25, order: 'oldest' })
    events = parseBlocks(r).filter((x: any) => x.subject).map((x: any) => ({ subject: x.subject, start: hrs(new Date(String(x.start?.dateTime).slice(0, 19))), end: hrs(new Date(String(x.end?.dateTime).slice(0, 19))), allDay: !!x.isAllDay })).filter(x => !x.allDay)
    const now = hrs(new Date())
    const nx = events.find(e => e.end > now)
    set($, 't1c', 'PASS', `${events.length} timed events today. Next: ${nx ? `${nx.subject} at ${hm(nx.start)}` : 'none left today'}`)
  } catch (e) { set($, 't1c', 'FAIL', err(e)) }

  try {
    const r = await call($, 'read_resource', { uri: 'mail:///folders/' })
    const folders = parseBlocks(r)
    const un = (re: RegExp) => { const f = folders.find((x: any) => re.test(String(x.name))); return f ? `${f.name} ${f.unreadCount}` : `no folder matching ${re}` }
    const inbox = folders.find((x: any) => x.name === 'Inbox')
    const miss = ![/follow up/i, /waiting/i].every(re => folders.some((x: any) => re.test(String(x.name))))
    set($, 't1d', miss ? 'PARTIAL' : 'PASS', `Inbox unread ${inbox?.unreadCount ?? '?'} · ${un(/follow up/i)} · ${un(/waiting/i)} (mail:///folders/ lists ${folders.length} folders, names have no [nn] prefix)`)
  } catch (e) { set($, 't1d', 'FAIL', err(e)) }

  const teams = Object.entries(servers).flatMap(([s, ts]) => ts.filter(t => /^teams_/.test(t)))
  const unread = teams.filter(t => /unread|mention|notification/i.test(t))
  set($, 't1e', unread.length ? 'PARTIAL' : 'FAIL', unread.length ? `candidate tools: ${unread.join(', ')}` : `no unread/mention tool among ${teams.length} Teams tools (${teams.slice(0, 6).join(', ')}…); teams_list_chats has no unread field`)
  const subs = ['t1a', 't1b', 't1c', 't1d', 't1e'].map(k => res[k]!.s)
  set($, 't1', subs.every(s => s === 'PASS') ? 'PASS' : subs.some(s => s === 'FAIL') && !subs.some(s => s === 'PASS') ? 'FAIL' : 'PARTIAL', 'sub-results below')
}

async function t2($: any) {
  try {
    const cmds: any[] = await $.command.list()
    const want = ['day-planner-brief', 'vault-evening', 'vault-weekly-review', 'morning']
    const seen = want.map(w => `${w}: ${cmds.some(c => c.name === w || String(c.name).endsWith(`:${w}`)) ? 'listed' : 'not listed'}`)
    const mcpTools = Object.keys(servers).length
    set($, 't2', 'OBSERVE', `mod's view of slash commands (${cmds.length}): ${seen.join(', ')} · MCP servers visible ${mcpTools}. Claude's own view is in the chat report.`)
  } catch (e) { set($, 't2', 'FAIL', err(e)) }
}

async function scan($: any, dir: string, state: { files: number; stale: number; capped: boolean }) {
  let ents: any[] = []
  try { ents = await $.fs.list(dir) } catch { return }
  for (const en of ents) {
    if (state.files >= 800) { state.capped = true; return }
    if (en.kind === 'dir') { if (!/^(\.|_attachments$|Claude outputs$)/.test(en.name)) await scan($, `${dir}/${en.name}`, state); continue }
    if (!en.name.endsWith('.md')) continue
    state.files++
    try { if (/review:\s*stale/i.test(String(await $.fs.read(`${dir}/${en.name}`)))) state.stale++ } catch {}
  }
}
async function t3($: any) {
  set($, 't3', 'RUN', 'running')
  try {
    const ctx = String(await $.fs.read(`${VAULT}/00-Meta/Context.md`)).split(/\r?\n/)
    const first = ctx[0]
    const body = ctx.find((l, i) => i > 0 && l.trim() && l.trim() !== '---' && !/^\w+:/.test(l)) ?? ''
    const inbox = (await $.fs.list(`${VAULT}/01-Inbox`)).filter((e: any) => e.kind === 'file').length
    const st = { files: 0, stale: 0, capped: false }
    await scan($, VAULT, st)
    gauges.stale = st.stale
    set($, 't3', 'PASS', `Context.md line 1: "${first}"${first === '---' ? ` (frontmatter; first body line: "${body.slice(0, 80)}")` : ''} · 01-Inbox files: ${inbox} · notes with "review: stale": ${st.stale} of ${st.files} scanned${st.capped ? ' (capped at 800)' : ''}`)
  } catch (e) { set($, 't3', 'FAIL', err(e)) }
}
async function fileCapture($: any) {
  const d = new Date()
  const path = `${VAULT}/01-Inbox/${ymd(d)} ${f2(d.getHours())}${f2(d.getMinutes())} capture.md`
  if (!capture.trim()) { set($, 't3c', 'FAIL', 'nothing to file: type in the box first'); return }
  try {
    await $.fs.write(path, `---\ncreated: ${d.toISOString()}\nsource: bridge-test\n---\n\n${capture.trim()}\n`)
    set($, 't3c', 'PASS', `wrote ${path}`)
    capture = ''
  } catch (e) { set($, 't3c', 'FAIL', `write ${path}: ${err(e)}`) }
}

async function t7($: any) {
  try {
    const row: any = (await $.config.list()).find((r: any) => r.key === 'theme')
    themeRaw = row ? String(row.value) : 'no theme row'
    P = /light|day/i.test(themeRaw) ? DAY : DARK
    const isAuto = /auto/i.test(themeRaw)
    set($, 't7', row && !isAuto ? 'PASS' : 'PARTIAL', `$.config.list theme = "${themeRaw}" → ${P === DAY ? 'daylight' : 'dark'} palette${isAuto ? ' (value is "auto": it names a setting, not the resolved light or dark, so the mod cannot tell which the app shows)' : ''}. The render event has no theme field (only surface, viewport, props). Colors given as theme keys follow the app's theme.`)
  } catch (e) { set($, 't7', 'FAIL', err(e)) }
}

async function runMorning($: any) {
  morningAt = Date.now()
  try {
    const r = await $.prompt.submit({ text: 'morning' })
    set($, 't8', 'PARTIAL', `submit resolved: ${JSON.stringify(r) ?? 'undefined'}. Checking the transcript in 30 s…`)
    $.clock.after(30000, async () => {
      try {
        const msgs: any[] = await $.session.messages()
        const recent = msgs.slice(-12)
        const tu = recent.flatMap(m => m.toolUses ?? [])
        const skill = tu.find((u: any) => /skill/i.test(JSON.stringify(u)) && /morning|day-planner/i.test(JSON.stringify(u)))
        const sent = recent.some(m => m.role === 'user' && /morning/i.test(String(m.text ?? '')))
        set($, 't8', skill ? 'PASS' : sent ? 'PARTIAL' : 'FAIL', `${sent ? 'a user turn containing "morning" is in the transcript' : 'no user turn containing "morning" in the last 12 messages'}; ${skill ? 'Skill tool use for the morning brief seen' : `no Skill tool use for morning among ${tu.length} recent tool uses`}. (The model may need longer than 30 s; press Run morning and read the transcript.) Shape of a tool use: ${JSON.stringify(tu[0] ?? {}).slice(0, 120)}`)
      } catch (e) { set($, 't8', 'PARTIAL', `submitted; could not read transcript: ${err(e)}`) }
    })
  } catch (e) { set($, 't8', 'FAIL', `$.prompt.submit threw: ${err(e)}`) }
}

async function sampleCpu($: any) {
  cpu = 'sampling 10 s…'; $.ui.invalidate('ui.render')
  const ps = ['powershell', '-NoProfile', '-Command', '(Get-Process claude*,Claude* -ErrorAction SilentlyContinue | Measure-Object CPU -Sum).Sum']
  try {
    const a = parseFloat((await $.process.run(ps)).stdout)
    await $.clock.sleep(10000)
    const b = parseFloat((await $.process.run(ps)).stdout)
    cpu = Number.isFinite(a) && Number.isFinite(b) ? `${(((b - a) / 10) * 100).toFixed(1)}% of one core (all claude processes, 10 s)` : `could not read (${String(a)} → ${String(b)})`
  } catch (e) { cpu = `failed: ${err(e)}` }
  set($, 't11c', 'OBSERVE', cpu)
}

async function runAll($: any) {
  await t7($); await t1($); await t2($); await t3($)
}

// ---- pane lifecycle ---------------------------------------------------------

async function openPane($: any, focus = false) {
  opens++
  trySlash = false
  await $.store.set('width', wantCols)
  let r: any
  try { r = await $.ui.open({ id: PANE, title: 'Bridge (test)', columns: wantCols, ...(focus ? { focus: true } : {}) }) } catch (e) { await note($, `open threw ${err(e)}`); throw e }
  isOpen = true
  lastOpen = `asked ${wantCols}, ${JSON.stringify(r)}`
  lastStatus = `Bridge test v${VERSION} · pane ${r?.isPlaced ? 'placed' : 'not placed'} · /bridge toggles`
  $.ui.status(lastStatus)
  $.ui.invalidate('ui.render')
  return r
}
// ui.open on an open id only retitles it, so a new width needs a close first.
async function resizePane($: any, cols: number) {
  wantCols = Math.max(24, cols)
  resizing = true
  try { await $.ui.close({ id: PANE }); await $.clock.sleep(150) } finally { resizing = false }
  return openPane($)
}
async function closePane($: any) {
  await $.ui.close({ id: PANE })
  isOpen = false
  lastStatus = `Bridge test · pane closed (collapsed ${collapses}×) · /bridge reopens`
  $.ui.status(lastStatus)
  $.ui.invalidate('ui.render')
}

// ---- SVG --------------------------------------------------------------------

// anim: the hand turns and the seconds ring sweeps by SMIL, so the source holds still for a minute.
// not anim: redrawn by the second, as v0.2.0 did (which drew nothing in the interactive frame).
function ringSvg(now: Date, anim: boolean) {
  const c = 50, R = 43
  const ang = (h: number) => ((h - 12) / 24) * 2 * Math.PI - Math.PI / 2
  const pt = (h: number, r: number): [number, number] => [c + r * Math.cos(ang(h)), c + r * Math.sin(ang(h))]
  const arc = (a: number, b: number, r: number, w: number, col: string, op: number) => {
    const [x1, y1] = pt(a, r), [x2, y2] = pt(b, r)
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}A${r} ${r} 0 ${b - a > 12 ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${w}" opacity="${op}"/>`
  }
  const h = hrs(now), sec = now.getSeconds()
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="${P.panel}"/><circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="${P.line}"/>`
  s += arc(6, 20, R + 2, 1.5, P.muted, 0.35)
  for (let i = 0; i < 24; i++) { const [x1, y1] = pt(i, R), [x2, y2] = pt(i, R - (i % 6 ? 3 : 6)); s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${P.muted}" stroke-width="${i % 6 ? 0.6 : 1}"/>` }
  for (const e of events) s += arc(e.start, Math.max(e.end, e.start + 0.1), R - 8, 5, P.accent, 1)
  const [tx, ty] = pt(12, R - 1), [bx, by] = pt(12, 22)
  const hand = `<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}" stroke="${P.accent}" stroke-width="1.5"/><circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="2.5" fill="${P.accent}"><animate attributeName="r" values="2.5;4;2.5" dur="2.4s" repeatCount="indefinite"/></circle>`
  const deg = ((h - 12) / 24) * 360
  s += anim
    ? `<g transform="rotate(${deg.toFixed(2)} 50 50)"><animateTransform attributeName="transform" type="rotate" from="${deg.toFixed(2)} 50 50" to="${(deg + 360).toFixed(2)} 50 50" dur="86400s" repeatCount="indefinite"/>${hand}</g>`
    : `<g transform="rotate(${deg.toFixed(2)} 50 50)">${hand}</g>`
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * 2 * Math.PI - Math.PI / 2, r1 = R - 22, r2 = R - 25
    const xy = `x1="${(c + r1 * Math.cos(a)).toFixed(1)}" y1="${(c + r1 * Math.sin(a)).toFixed(1)}" x2="${(c + r2 * Math.cos(a)).toFixed(1)}" y2="${(c + r2 * Math.sin(a)).toFixed(1)}"`
    s += anim
      ? `<line ${xy} stroke="${P.line}" stroke-width="1.5"><animate attributeName="stroke" calcMode="discrete" values="${P.line};${P.accent}" keyTimes="0;${((i + 1) / 60).toFixed(4)}" dur="60s" begin="-${sec}s" repeatCount="indefinite"/></line>`
      : `<line ${xy} stroke="${i <= sec ? P.accent : P.line}" stroke-width="1.5"/>`
  }
  s += `</svg>`
  return s
}

let ringCache = { key: '', src: '' }
const ringAnim = (now: Date) => {
  const key = `${P === DAY}:${events.length}:${Math.floor(now.getTime() / 60000)}`
  if (ringCache.key !== key) ringCache = { key, src: ringSvg(now, true) }
  return ringCache.src
}

function gaugeSvg(n: number, max: number, band: string) {
  const r = 40, c = 50, a0 = -225, sweep = 270
  const pt = (d: number, rr: number): [number, number] => [c + rr * Math.cos((d * Math.PI) / 180), c + rr * Math.sin((d * Math.PI) / 180)]
  const fr = Math.max(0, Math.min(n / max, 1))
  const [sx, sy] = pt(a0, r), [ex, ey] = pt(a0 + sweep * fr, r), [fx, fy] = pt(45, r)
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="92" height="84" viewBox="0 0 100 92"><rect width="100" height="92" fill="${P.panel}"/><path d="M${sx} ${sy}A${r} ${r} 0 1 1 ${fx.toFixed(1)} ${fy.toFixed(1)}" fill="none" stroke="${P.line}" stroke-width="6"/>`
  for (let i = 0; i <= 18; i++) { const d = a0 + i * 15, [x1, y1] = pt(d, r + 7), [x2, y2] = pt(d, r + (i % 6 ? 9 : 12)); s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${P.muted}" stroke-width="${i % 6 ? 0.6 : 1}"/>` }
  if (fr > 0) s += `<path d="M${sx} ${sy}A${r} ${r} 0 ${sweep * fr > 180 ? 1 : 0} 1 ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="${band}" stroke-width="6"/>`
  s += `<text x="50" y="56" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-size="24" font-weight="600" fill="${P.ink}">${n < 0 ? '—' : n}</text></svg>`
  return s
}

// One swatch per SVG feature; the person reports which are blank.
const probeSvg = () => {
  const cell = (i: number, label: string, inner: string) => `<g transform="translate(${i * 56 + 4} 4)"><rect width="50" height="40" fill="${P.field}" stroke="${P.line}"/>${inner}<text x="25" y="52" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="8" fill="${P.muted}">${label}</text></g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="64" viewBox="0 0 400 64"><defs>
<linearGradient id="g1" x1="0" x2="1"><stop offset="0" stop-color="${P.accent}"/><stop offset="1" stop-color="${P.ok}"/></linearGradient>
<filter id="f1"><feGaussianBlur stdDeviation="2"/></filter>
<pattern id="p1" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 8L8 0" stroke="${P.accent}" stroke-width="1"/></pattern>
<clipPath id="cp"><circle cx="25" cy="20" r="14"/></clipPath>
<style>.h:hover{fill:${P.amber}}</style></defs>
${cell(0, 'gradient', `<rect x="5" y="8" width="40" height="24" fill="url(#g1)"/>`)}
${cell(1, 'blur', `<circle cx="25" cy="20" r="10" fill="${P.accent}" filter="url(#f1)"/>`)}
${cell(2, 'pattern', `<rect x="5" y="8" width="40" height="24" fill="url(#p1)"/>`)}
${cell(3, 'clip', `<rect width="50" height="40" fill="${P.accent}" clip-path="url(#cp)"/>`)}
${cell(4, 'smil', `<circle cx="25" cy="20" r="6" fill="${P.ok}"><animate attributeName="cx" values="12;38;12" dur="2s" repeatCount="indefinite"/></circle>`)}
${cell(5, 'css hover', `<rect class="h" x="10" y="10" width="30" height="20" fill="${P.accent}"/>`)}
${cell(6, 'title tip', `<rect x="10" y="10" width="30" height="20" fill="${P.seg}"><title>tooltip works</title></rect>`)}
</svg>`
}

// ---- module -----------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e: any, next) => {
    loadedAt = clock()
    const storedWidth = await $.store.get('width')
    prevOpens = Number((await $.store.get('opens')) ?? 0)
    await $.store.set('opens', prevOpens + 1)
    if (typeof storedWidth === 'number') wantCols = storedWidth
    set($, 't4', prevOpens > 0 ? 'PASS' : 'PARTIAL', prevOpens > 0 ? `store survived: opens counter was ${prevOpens} before this start (now ${prevOpens + 1}); width restored to ${wantCols} cols` : `first run: counter now 1, width ${wantCols} saved. Restart the session (or hot reload) to confirm it persists.`)
    await $.command.register({ name: 'bridge', description: 'Bridge test: open or close the pane' })
    await $.command.register({ name: 'bridge-width', description: 'Bridge test: request a pane width in columns, e.g. /bridge-width 90', argumentHint: '<columns>' })
    await $.command.register({ name: 'bridge-run', description: 'Bridge test: re-run the connector, vault and theme tests' })
    $.ui.status(`Bridge test v${VERSION} loaded · /bridge opens the pane`)
    $.clock.every(1000, () => { if (!paused) $.ui.invalidate('ui.render') })
    const r = await next(e)
    void (async () => {
      const opened = await openPane($)
      set($, 't4a', opened?.isPlaced ? 'PASS' : 'PARTIAL', `auto-open on session start: isPlaced=${opened?.isPlaced} ${JSON.stringify(opened)}`)
      await runAll($)
    })()
    return r
  })

  on('prompt.submit', async ($, e: any, next) => {
    const t = String(e.text ?? '').trim().toLowerCase()
    if (t === 'bridge' || t === '/bridge') {
      if (isOpen) await closePane($); else await openPane($)
      return { drop: isOpen ? 'Bridge test pane opened' : 'Bridge test pane closed' }
    }
    const m = t.match(/^\/?bridge[- ]width\s+(\d+)$/)
    if (m) { wantCols = Math.max(24, parseInt(m[1]!, 10)); await openPane($); return { drop: `Bridge test: requested ${wantCols} columns` } }
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
  on('command.run', { command: 'bridge-run' }, async $ => { void runAll($); return { text: 'Re-running the bridge-test tests; watch the pane.' } })

  on('ui.close', async ($, e: any, next) => {
    if (e?.id === PANE) {
      isOpen = false
      if (!resizing && !byButton) collapses++
      lastStatus = `Bridge test · pane closed (collapsed ${collapses}×) · /bridge reopens`
      $.ui.status(lastStatus)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e: any) => {
    const t0 = Date.now()
    if (stats.last) stats.maxGap = Math.max(stats.maxGap, t0 - stats.last)
    stats.last = t0
    const { Box, Text, Button, Link, Svg, Input } = $.ui.resolve(e) as any
    const p = e.props ?? {}
    const v = e.viewport ?? {}
    const now = new Date()
    const bandOf = (n: number, calm: number, amber: number) => (n <= calm ? P.ok : n <= amber ? P.amber : P.red)
    const statusColor = (s: Status) => (s === 'PASS' ? P.ok : s === 'FAIL' ? P.red : s === 'PARTIAL' ? P.amber : P.accent)
    const row = (k: string, val: string, col = P.ink) => (
      <Box flexDirection="row" gap={1}>
        <Box width={14}><Text color={P.muted} size="caption">{k}</Text></Box>
        <Text color={col} tabular size="footnote">{val}</Text>
      </Box>
    )
    const sec = (id: string, title: string, children?: any) => {
      const r = res[id] ?? { s: 'WAIT' as Status, d: 'not run yet' }
      return (
        <Box key={id} flexDirection="column" borderStyle="single" borderColor={P.line} backgroundColor={P.panel} padding={1} gap={1}>
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Text color={P.accent} size="caption" weight="semibold">{title}</Text>
            <Text color={statusColor(r.s)} size="caption" weight="bold">{r.s}</Text>
          </Box>
          <Text color={P.ink} size="footnote">{r.d}</Text>
          {children}
        </Box>
      )
    }
    const sub = (id: string, label: string) => {
      const r = res[id] ?? { s: 'WAIT' as Status, d: '…' }
      return (
        <Box key={id} flexDirection="row" gap={1}>
          <Box width={9}><Text color={statusColor(r.s)} size="caption" weight="bold">{r.s}</Text></Box>
          <Text color={P.muted} size="footnote">{label}: <Text color={P.ink}>{r.d}</Text></Text>
        </Box>
      )
    }
    const hk = (k: string, label: string, fn: () => void) => <Button key={`hk-${k}`} label={label} hotkey={k} onPress={() => { keys[k] = (keys[k] ?? 0) + 1; fn(); $.ui.invalidate('ui.render') }} />

    const nx = events.find(ev => ev.end > hrs(now))
    // statuses the pane can work out itself; the rest wait for what the person sees
    res.t5 = { s: collapses > 0 && reopens > 0 ? 'PASS' : 'OBSERVE', d: `collapse closed the pane ${collapses}×, band Reopen pressed ${reopens}×; the status strip text is shown below (check it also appears under the prompt).` }
    const pressed = Object.entries(keys).filter(([, n]) => n > 0).map(([k]) => k)
    res.t6 = { s: pressed.length ? 'PARTIAL' : 'OBSERVE', d: `keys counted so far: ${pressed.join(', ') || 'none'}. Each Button draws its key as a chip; press each key with the pane focused and without the mouse.` }
    res.t9 = { s: 'OBSERVE', d: 'Visual check. Ring A uses SMIL in the interactive frame and holds still for a minute; ring B is redrawn every second as an image. Tell me which of A and B draw.' }
    res.t10 = { s: 'OBSERVE', d: 'Click the link and tell me where it opened.' }
    res.t11 = { s: stats.renders > 600 && stats.maxMs < 20 ? 'PASS' : 'OBSERVE', d: `${stats.renders} renders, avg ${stats.renders ? (stats.sumMs / stats.renders).toFixed(1) : 0} ms, max ${stats.maxMs} ms. Gaps over 1 s happen when the window is hidden or busy; leave it open 10 minutes and tell me about flicker.` }
    res.t12 = { s: 'OBSERVE', d: 'Installed from the marketplace cache, so the plugin root below shows the version folder in use. Tell me what you did to get this version.' }
    const out = (
      <Box flexDirection="column" gap={1} padding={1} backgroundColor={P.field}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text color={P.accent} weight="bold" size="heading">BRIDGE</Text>
            <Text color={P.muted} size="footnote">test v{VERSION}</Text>
          </Box>
          <Text color={P.ink} tabular size="heading">{clock()}</Text>
        </Box>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="runall" label="Run all tests" variant="primary" onPress={() => { void runAll($) }} />
          {hk('c', 'Collapse (C)', () => { byButton = true; collapses++; void closePane($).finally(() => { byButton = false }) })}
          {hk('m', 'Run morning (M)', () => { void runMorning($) })}
          {hk('b', 'Board key (B)', () => {})}
          {hk('e', 'Evening key (E, counts only)', () => {})}
          <Button key="slash" label={trySlash ? "'/' hotkey armed" : "Arm '/' hotkey"} onPress={() => { trySlash = true; void note($, "arming '/' hotkey: if the pane goes blank run /bridge twice to reset"); $.ui.invalidate('ui.render') }} />
          {trySlash ? <Button key="hk-slash" label="Slash (/)" hotkey="/" onPress={() => { keys.slash = (keys.slash ?? 0) + 1; $.ui.invalidate('ui.render') }} /> : null}
        </Box>

        {sec('t1', '1 · CONNECTORS FROM THE MOD')}
        <Box flexDirection="column" gap={1}>
          {sub('t1a', 'MCP servers and tools')}
          {sub('t1b', 'ClickUp, open tasks due today or overdue')}
          {sub('t1c', 'Calendar, next event today')}
          {sub('t1d', 'Outlook unread and favourites')}
          {sub('t1e', 'Teams unread and mentions')}
        </Box>
        {sec('t2', '2 · SKILLS AND CONNECTORS (MOD VIEW)')}
        {sec('t3', '3 · VAULT')}
        {sec('t3c', '3b · CAPTURE TO 01-INBOX', (
          <Box flexDirection="row" gap={1} alignItems="center">
            {Input ? <Input key="cap" placeholder="Capture to 01-Inbox" value={capture} onInput={(t: string) => { capture = t }} onSubmit={() => { void fileCapture($) }} submitLabel="file" /> : <Text color={P.amber}>No Input element on this surface</Text>}
            <Button key="file" label="File" variant="primary" onPress={() => { void fileCapture($) }} />
          </Box>
        ))}
        {sec('t4', '4 · PERSISTENCE ($.store)', (
          <Box flexDirection="column">
            {row('Opens (store)', String(prevOpens + 1))}
            {row('Width stored', `${wantCols} cols`)}
            {sub('t4a', 'auto-open at start')}
          </Box>
        ))}
        {sec('t5', '5 · COLLAPSE, BAND, STATUS STRIP', (
          <Box flexDirection="column">
            {row('Collapses', String(collapses))}
            {row('Band reopens', String(reopens))}
            {row('Status strip', lastStatus || '(none yet)')}
          </Box>
        ))}
        {sec('t6', '6 · HOTKEYS (press the key with the pane focused)', (
          <Box flexDirection="column">
            {row('B / C / M / E', `${keys.b} / ${keys.c} / ${keys.m} / ${keys.e}`)}
            {row("'/'", trySlash ? `armed, presses ${keys.slash ?? 0}` : "not armed. API docs say hotkey is one digit or lowercase letter, so '/' is refused")}
            <Text color={P.muted} size="footnote">Counters also move on a mouse click; press the key only. Focus: {p.isFocused ? 'pane has it' : 'pane does not (click it or use the focus chord)'}</Text>
          </Box>
        ))}
        {sec('t7', '7 · THEME', row('Palette now', P === DAY ? 'daylight' : 'dark'))}
        {sec('t8', '8 · PANE TO CHAT ($.prompt.submit)')}
        {sec('t9', '9 · RICH SVG', (
          <Box flexDirection="column" gap={1}>
            <Text color={P.muted} size="footnote">Day clock: 60-segment seconds ring, now hand, {events.length} meeting arcs{nx ? `, next ${nx.subject} ${hm(nx.start)}` : ''}. Then a 270° gauge for stale notes ({gauges.stale}) and overdue ClickUp ({gauges.overdue}).</Text>
            <Box flexDirection="row" gap={2} alignItems="center">
              {Svg ? <Box flexDirection="column" alignItems="center"><Svg source={ringAnim(now)} alt="Day clock ring, SMIL" isInteractive width={100} height={100} /><Text color={P.muted} size="caption">A · SMIL, interactive</Text></Box> : <Text color={P.amber}>No Svg element</Text>}
              {Svg ? <Box flexDirection="column" alignItems="center"><Svg source={ringSvg(now, false)} alt="Day clock ring, redrawn each second" width={100} height={100} /><Text color={P.muted} size="caption">B · per second, image</Text></Box> : null}
              {Svg ? <Svg source={gaugeSvg(gauges.stale, 60, bandOf(gauges.stale, 20, 40))} alt="Stale notes gauge" isInteractive width={92} height={84} /> : null}
              {Svg ? <Svg source={gaugeSvg(gauges.overdue, 10, bandOf(gauges.overdue, 2, 9))} alt="Overdue gauge" isInteractive width={92} height={84} /> : null}
            </Box>
            <Text color={P.muted} size="footnote">Feature probe, left to right: gradient, blur, pattern, clip, smil, css hover, title tooltip. Tell me which swatches are blank.</Text>
            {Svg ? <Svg source={probeSvg()} alt="SVG feature probe" isInteractive width={400} height={64} /> : null}
          </Box>
        ),
        )}
        {sec('t10', '10 · LINKS', (
          <Box flexDirection="column" gap={1}>
            <Link href={BOARD} label="Open board ↗" />
            <Text color={P.muted} size="footnote">Click it and tell me where it opened: browser, side panel, or beside the pane.</Text>
          </Box>
        ))}
        {sec('t11', '11 · REDRAW COST (1 s redraw)', (
          <Box flexDirection="column">
            {row('Renders', `${stats.renders} in ${Math.round((Date.now() - stats.since) / 1000)} s`)}
            {row('Render time', `avg ${stats.renders ? (stats.sumMs / stats.renders).toFixed(1) : '0'} ms · max ${stats.maxMs} ms`)}
            {row('Longest gap', `${stats.maxGap} ms (1000 expected)`)}
            {sub('t11c', 'CPU')}
            <Box flexDirection="row" gap={1}>
              <Button key="cpu" label="Sample CPU" onPress={() => { void sampleCpu($) }} />
              <Button key="pause" label={paused ? 'Resume 1 s redraw' : 'Pause 1 s redraw'} onPress={() => { paused = !paused; $.ui.invalidate('ui.render') }} />
              <Button key="reset" label="Reset stats" onPress={() => { Object.assign(stats, { renders: 0, sumMs: 0, maxMs: 0, maxGap: 0, last: 0, since: Date.now() }) }} />
            </Box>
          </Box>
        ))}
        {sec('t12', '12 · UPDATE FLOW', (
          <Box flexDirection="column">
            {row('Version', VERSION)}
            {row('Loaded at', loadedAt)}
            {row('Plugin root', String($.plugin.root))}
          </Box>
        ))}
        <Box flexDirection="column" borderStyle="single" borderColor={P.line} backgroundColor={P.panel} padding={1}>
          <Text color={P.accent} size="caption" weight="semibold">PLACEMENT</Text>
          {row('Surface', String(e.surface))}
          {row('Placement', String(p.placement ?? '?'), p.placement === 'dock' ? P.ok : P.amber)}
          {row('Width asked', `${wantCols} cols`)}
          {row('Width got', `${p.bodyColumns ?? '?'} cols`)}
          {row('Last open', lastOpen)}
          {row('Viewport', `${v.columns ?? '?'} × ${v.rows ?? '?'}`)}
          <Box flexDirection="row" gap={1}>
            <Button key="narrow" label="Narrower" onPress={() => { void resizePane($, wantCols - 20) }} />
            <Button key="wide" label="Wider" onPress={() => { void resizePane($, wantCols + 20) }} />
          </Box>
        </Box>
      </Box>
    )
    const ms = Date.now() - t0
    stats.renders++; stats.sumMs += ms; stats.maxMs = Math.max(stats.maxMs, ms)
    return out
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e: any, next) => {
    if (isOpen) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e) as any
    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text color={P.accent} weight="semibold">BRIDGE</Text>
        <Text color={P.muted}>{clock()} · pane collapsed ({collapses}×)</Text>
        <Button key="reopen" label="Reopen" onPress={() => { reopens++; void openPane($) }} />
      </Box>
    )
  })
}
