/**
 * backdrop-picker — custom images for the chat backdrop.
 *
 * The core app renders one hardcoded statue (ds-assets/filler-bg0.jpg) inside an
 * absolutely-positioned div at 2.5% opacity with mix-blend-difference + invert.
 * This plugin never touches React: it injects ONE <style> tag that
 *   - hides that <img>, and
 *   - paints the chosen image as the background of its parent div,
 *     with our own opacity / blend.
 * Because it's pure CSS keyed on the img src, it survives re-renders, theme
 * switches and hot reloads with zero DOM patching.
 *
 * Images live in IndexedDB (blobs; localStorage is too small), downscaled on
 * import to <= 2560px so a 12MP phone photo doesn't sit in memory at full size.
 * GIFs are stored untouched so they keep animating.
 *
 * ⌘K: "Backdrop: Choose image…", "Backdrop: Next image", "Backdrop: Use default statue".
 *
 * Uncompiled ESM. Allowed imports: '@hermes/plugin-sdk', 'react', 'react/jsx-runtime'.
 */
import { host, PALETTE_AREA } from '@hermes/plugin-sdk'

const ID = 'backdrop-picker'
const DB_NAME = 'hermes-backdrop-picker'
const STORE = 'images'
const PREFS_KEY = 'hermes.plugin.backdrop-picker.prefs.v1'
const STYLE_ID = 'backdrop-picker-style'
const PANEL_ID = 'backdrop-picker-panel'
const MAX_EDGE = 2560

const ROTATIONS = [
  ['off', 'Off', 0],
  ['15m', '15 min', 15 * 60e3],
  ['1h', 'Hourly', 60 * 60e3],
  ['1d', 'Daily', 24 * 60 * 60e3]
]

// ---------------------------------------------------------------------------
// Prefs (small, sync → localStorage)
// ---------------------------------------------------------------------------

const DEFAULT_PREFS = { activeId: null, opacity: 18, blend: false, fit: 'cover', rotation: 'off', rotatedAt: 0 }

export function readPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

function writePrefs(patch) {
  const next = { ...readPrefs(), ...patch }
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)) } catch {}
  return next
}

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------

let dbPromise = null
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

async function tx(mode, fn) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode)
    const out = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined)
    t.onerror = () => reject(t.error)
  })
}

const listImages = async () =>
  ((await tx('readonly', s => s.getAll())) || []).sort((a, b) => a.added - b.added)
const putImage = rec => tx('readwrite', s => s.put(rec))
const deleteImage = id => tx('readwrite', s => s.delete(id))
const getImage = id => tx('readonly', s => s.get(id))

// ---------------------------------------------------------------------------
// Import: downscale big stills, keep GIFs as-is
// ---------------------------------------------------------------------------

async function normalize(file) {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height))
    if (scale === 1 && file.size < 3e6) { bmp.close?.(); return file }
    const w = Math.round(bmp.width * scale)
    const h = Math.round(bmp.height * scale)
    const canvas = new OffscreenCanvas(w, h)
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h)
    bmp.close?.()
    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 })
  } catch {
    return file
  }
}

async function importFiles(files) {
  const added = []
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue
    const blob = await normalize(file)
    const rec = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name: file.name, blob, added: Date.now() }
    await putImage(rec)
    added.push(rec)
  }
  return added
}

// ---------------------------------------------------------------------------
// Apply: one style tag, keyed on the core statue img
// ---------------------------------------------------------------------------

let currentUrl = null

export function buildCss(url, prefs) {
  if (!url) return ''
  const op = Math.max(1, Math.min(100, Number(prefs.opacity) || 18)) / 100
  const size = prefs.fit === 'contain' ? 'contain' : 'cover'
  const blend = prefs.blend ? 'difference' : 'normal'
  const sel = 'div:has(> img[src*="filler-bg0"])'
  return `
${sel} {
  opacity: ${op} !important;
  mix-blend-mode: ${blend} !important;
  background-image: url("${url}") !important;
  background-size: ${size} !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
}
${sel} > img[src*="filler-bg0"] { visibility: hidden !important; }
`
}

async function apply() {
  const prefs = readPrefs()
  let style = document.getElementById(STYLE_ID)
  const rec = prefs.activeId ? await getImage(prefs.activeId).catch(() => null) : null
  if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null }
  if (!rec) {
    style?.remove()
    return
  }
  currentUrl = URL.createObjectURL(rec.blob)
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = buildCss(currentUrl, prefs)
  // The core layer only mounts while "Chat Backdrop" is on — flip it on for the user.
  try {
    if (host.settings && host.settings.get('backdrop.v1') === false) host.settings.set('backdrop.v1', true)
  } catch {}
}

async function setActive(id) {
  writePrefs({ activeId: id, rotatedAt: Date.now() })
  await apply()
}

async function nextImage() {
  const imgs = await listImages()
  if (!imgs.length) return host.notify?.({ kind: 'info', message: 'No custom backdrops yet — add one first.' })
  const i = imgs.findIndex(x => x.id === readPrefs().activeId)
  await setActive(imgs[(i + 1) % imgs.length].id)
}

// ---------------------------------------------------------------------------
// Picker panel (plain DOM, theme vars only)
// ---------------------------------------------------------------------------

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') Object.assign(n.style, v)
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v)
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v)
  }
  for (const c of kids.flat()) if (c != null) n.append(c)
  return n
}

const thumbUrls = []
function closePanel() {
  document.getElementById(PANEL_ID)?.remove()
  thumbUrls.splice(0).forEach(u => URL.revokeObjectURL(u))
}

const S = {
  scrim: { position: 'fixed', inset: '0', zIndex: '9999', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(2px)' },
  card: { width: 'min(560px, 92vw)', maxHeight: '80vh', overflow: 'auto', padding: '18px', borderRadius: '14px', background: 'var(--popover, var(--card, var(--background)))', color: 'var(--foreground)', border: '1px solid var(--ui-stroke-secondary, var(--border))', boxShadow: '0 20px 60px rgba(0,0,0,.45)', fontSize: '13px' },
  row: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px' },
  label: { width: '72px', color: 'var(--ui-text-secondary, var(--muted-foreground))' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: '8px', marginTop: '12px' },
  btn: { padding: '6px 11px', borderRadius: '8px', border: '1px solid var(--ui-stroke-secondary, var(--border))', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '12px' },
  on: { background: 'var(--ui-accent, var(--accent))', color: 'var(--background)', borderColor: 'transparent' }
}

function seg(options, value, onPick) {
  return el('div', { style: { display: 'flex', gap: '4px' } },
    options.map(([v, label]) =>
      el('button', { type: 'button', style: { ...S.btn, ...(v === value ? S.on : {}) }, onClick: () => onPick(v) }, label)))
}

async function openPanel() {
  closePanel()
  const prefs = readPrefs()
  const imgs = await listImages()

  const input = el('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } })
  input.addEventListener('change', async () => {
    const added = await importFiles([...input.files])
    if (added.length) await setActive(added[added.length - 1].id)
    openPanel()
  })

  const tile = (content, active, onClick, onDelete) =>
    el('div', { style: { position: 'relative', aspectRatio: '16/10', borderRadius: '9px', overflow: 'hidden', cursor: 'pointer', outline: active ? '2px solid var(--ui-accent, var(--accent))' : '1px solid var(--ui-stroke-secondary, var(--border))', outlineOffset: active ? '1px' : '0' }, onClick },
      content,
      onDelete && el('button', { type: 'button', title: 'Remove', style: { position: 'absolute', top: '4px', right: '4px', width: '20px', height: '20px', borderRadius: '10px', border: 'none', background: 'rgba(0,0,0,.6)', color: '#fff', cursor: 'pointer', lineHeight: '20px', padding: '0' }, onClick: async e => { e.stopPropagation(); await onDelete() } }, '×'))

  const tiles = [
    tile(el('div', { style: { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ui-text-secondary, var(--muted-foreground))' } }, 'Default statue'),
      !prefs.activeId, async () => { await setActive(null); openPanel() }),
    ...imgs.map(rec => {
      const u = URL.createObjectURL(rec.blob); thumbUrls.push(u)
      return tile(el('img', { src: u, alt: rec.name, style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } }),
        rec.id === prefs.activeId,
        async () => { await setActive(rec.id); openPanel() },
        async () => {
          await deleteImage(rec.id)
          if (readPrefs().activeId === rec.id) await setActive(null)
          openPanel()
        })
    }),
    tile(el('div', { style: { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', color: 'var(--ui-text-secondary, var(--muted-foreground))' } }, '+'),
      false, () => input.click())
  ]

  const opVal = el('span', { style: { width: '38px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, `${prefs.opacity}%`)
  const slider = el('input', { type: 'range', min: '1', max: '100', value: String(prefs.opacity), style: { flex: '1', accentColor: 'var(--ui-accent, var(--accent))' } })
  slider.addEventListener('input', () => { opVal.textContent = `${slider.value}%`; writePrefs({ opacity: Number(slider.value) }); apply() })

  const set = patch => { writePrefs(patch); apply(); openPanel() }

  const card = el('div', { style: S.card, onClick: e => e.stopPropagation() },
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      el('div', { style: { fontSize: '15px', fontWeight: '600' } }, 'Chat Backdrop'),
      el('button', { type: 'button', style: S.btn, onClick: closePanel }, 'Done')),
    el('div', { style: { marginTop: '4px', color: 'var(--ui-text-secondary, var(--muted-foreground))' } }, 'Click an image to use it. Drop files anywhere on this panel to add them.'),
    el('div', { style: S.grid }, tiles),
    el('div', { style: S.row }, el('span', { style: S.label }, 'Opacity'), slider, opVal),
    el('div', { style: S.row }, el('span', { style: S.label }, 'Fit'), seg([['cover', 'Fill'], ['contain', 'Fit']], prefs.fit, v => set({ fit: v }))),
    el('div', { style: S.row }, el('span', { style: S.label }, 'Blend'), seg([[false, 'Normal'], [true, 'Invert (like statue)']], prefs.blend, v => set({ blend: v }))),
    el('div', { style: S.row }, el('span', { style: S.label }, 'Rotate'), seg(ROTATIONS.map(([v, l]) => [v, l]), prefs.rotation, v => set({ rotation: v, rotatedAt: Date.now() }))),
    input)

  const scrim = el('div', { id: PANEL_ID, style: S.scrim, onClick: closePanel }, card)
  scrim.addEventListener('dragover', e => e.preventDefault())
  scrim.addEventListener('drop', async e => {
    e.preventDefault()
    const added = await importFiles([...(e.dataTransfer?.files || [])])
    if (added.length) await setActive(added[added.length - 1].id)
    openPanel()
  })
  document.body.appendChild(scrim)
}

// ---------------------------------------------------------------------------
// Rotation tick
// ---------------------------------------------------------------------------

async function rotateIfDue() {
  const p = readPrefs()
  const ms = ROTATIONS.find(r => r[0] === p.rotation)?.[2] || 0
  if (!ms || !p.activeId) return
  if (Date.now() - (p.rotatedAt || 0) >= ms) await nextImage()
}

// ---------------------------------------------------------------------------

export default {
  id: ID,
  name: 'Backdrop Picker',
  register(ctx) {
    const palette = (id, label, keywords, run) =>
      ctx.register({ id: `palette-${id}`, area: PALETTE_AREA, data: { id: `${ID}.${id}`, label, keywords, run } })

    palette('open', 'Backdrop: Choose image…', ['backdrop', 'background', 'wallpaper', 'image', 'statue', 'chat'], () => openPanel())
    palette('next', 'Backdrop: Next image', ['backdrop', 'background', 'wallpaper', 'next', 'shuffle'], () => nextImage())
    palette('reset', 'Backdrop: Use default statue', ['backdrop', 'background', 'statue', 'reset', 'default'], () => setActive(null))

    const onKey = e => { if (e.key === 'Escape') closePanel() }
    window.addEventListener('keydown', onKey)

    apply()
    const timer = setInterval(rotateIfDue, 60e3)

    ctx.onDispose?.(() => {
      clearInterval(timer)
      window.removeEventListener('keydown', onKey)
      closePanel()
      document.getElementById(STYLE_ID)?.remove()
      if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null }
    })
  }
}
