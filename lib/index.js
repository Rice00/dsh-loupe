/**
 * dsh-loupe — host half (M1: minimal runnable).
 *
 * Two routes on the harness webServer, both under `/plugins/dsh-loupe`:
 *
 *   GET  /plugins/dsh-loupe/probe    — capability diagnosis. Answers, in one
 *        request: is the `llm` service reachable, which provider/model did we
 *        resolve and from where, does context.md exist, how big is it, and when
 *        does it NOT exist where would we have looked. This exists because the
 *        host half only reloads on a DSH restart — a probe route turns one
 *        restart into a full diagnosis instead of a guessing game.
 *
 *   POST /plugins/dsh-loupe/explain  — the explain call, streamed as SSE.
 *
 * Design constraints carried over from PLAN.md:
 *   - NO session is created, no session log is written, no tool is registered.
 *     The explain call is a single `llm.stream`, nothing else. That is what
 *     keeps it fast, cheap and non-polluting.
 *   - The prompt is assembled in the cache-friendly order: stable parts first
 *     (system + plugin context), volatile parts last (message, selection,
 *     question). The harness caches on prefix.
 *   - The `llm` call is NOT going through the main session's queue, so a long
 *     main turn must not block an explanation.
 *
 * Written as hand-authored ESM against the module-loader contract (no bundler
 * step), the same way the locally-installed dsh-job-progress does it.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** Plugin identity for cordis rows. */
export const name = 'dsh-loupe'

/** The webServer is the only hard requirement; everything else degrades. */
export const inject = ['webServer']

const ROUTE_PREFIX = '/plugins/dsh-loupe'

/** Character budget for the plugin context document (≈1500 tokens for CJK). */
const DEFAULT_CONTEXT_CHARS = 2200

/** Hard caps so a pathological selection cannot blow up a request. */
const MAX_SELECTION_CHARS = 2000
const MAX_QUESTION_CHARS = 2000
const MAX_MESSAGE_CHARS = 2000
const MAX_BODY_BYTES = 512 * 1024

// ── paths ────────────────────────────────────────────────────────────────────

/**
 * DSH home directory. Deliberately dependency-free: `@deepseek-ai/dsh-home-paths`
 * is NOT resolvable from an installed plugin directory by plain Node resolution
 * (verified 2026-09-22: ERR_MODULE_NOT_FOUND from this very folder — the package
 * only exists under `plugins/.vendor/node_modules`, which is not on Node's lookup
 * path), so importing it risks the whole host half failing to mount.
 * `DSH_HOME` wins when set, otherwise the conventional `~/.dsh`.
 */
function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  return path.join(os.homedir(), '.dsh')
}

/** `<DSH home>/loupe` — the plugin context document and history live here. */
function loupeDir() {
  return path.join(dshHome(), 'loupe')
}

/**
 * 插件自己的版本号，直接从隔壁的 package.json 读 —— 写死在 probe 里必然过期
 * （发布 0.1.1 时它还在报 0.1.0）。读不到就如实说读不到。
 */
function pluginVersion() {
  try {
    const raw = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    const parsed = JSON.parse(raw)
    return typeof parsed.version === 'string' ? parsed.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Candidate settings.yaml locations, most authoritative first. */
function settingsCandidates() {
  return [path.join(dshHome(), 'settings.yaml')]
}

/**
 * 宿主界面语言偏好（settings.yaml → locale.preference，取值 zh / en）。
 * 宿主自己的 locale 插件在**没有偏好**时委托给浏览器语言 —— 所以这里如实返回
 * undefined，由界面半端退到 navigator.language。
 * 注意不要拿 `<html lang>` 当依据：宿主前端把它写死成 "en"。
 */
function hostLocalePreference() {
  for (const file of settingsCandidates()) {
    try {
      const raw = fs.readFileSync(file, 'utf8')
      const block = raw.match(/^locale:[ \t]*\n((?:[ \t]+[^\n]*\n?)+)/m)
      if (!block) continue
      const value = (block[1].match(/^[ \t]*preference:[ \t]*(\S+)/m) || [])[1]
      if (value) return { preference: value, source: file }
    } catch {
      /* 读不到就按「没有偏好」处理 */
    }
  }
  return { preference: undefined, source: undefined }
}

// ── plugin context document ──────────────────────────────────────────────────

function readContextDoc() {
  const file = path.join(loupeDir(), 'context.md')
  try {
    const raw = fs.readFileSync(file, 'utf8')
    return { file, raw, exists: true, bytes: Buffer.byteLength(raw, 'utf8') }
  } catch {
    return { file, raw: '', exists: false, bytes: 0 }
  }
}

/** Truncate to a character budget, marking the cut instead of dropping silently. */
function clamp(text, budget) {
  if (typeof text !== 'string') return { text: '', truncated: false }
  if (text.length <= budget) return { text, truncated: false }
  return { text: text.slice(0, budget), truncated: true, droppedChars: text.length - budget }
}

// ── model resolution ─────────────────────────────────────────────────────────

/**
 * Resolve provider/model, in this order:
 *   1. plugin config (explicit user override)
 *   2. the `agentDefaultModel` service, if present
 *   3. `settings.yaml` → `agent-default-model:` block (dependency-free parse)
 * Every step is tried and reported separately: `probe` shows which one won, so
 * a wrong guess here is visible instead of silent.
 */
function resolveModel(ctx, cfg) {
  const tried = []
  if (cfg.provider && cfg.model) {
    return { provider: cfg.provider, model: cfg.model, source: 'config', tried }
  }
  tried.push('config: not set')

  // 2. service
  try {
    const svc = ctx.get('agentDefaultModel')
    if (svc === undefined || svc === null) {
      tried.push('service agentDefaultModel: absent')
    } else {
      const candidates = []
      for (const key of ['snapshot', 'current', 'get', 'value', 'read']) {
        if (typeof svc[key] === 'function') {
          try {
            candidates.push({ key, value: svc[key]() })
          } catch (error) {
            tried.push(`service .${key}() threw: ${error?.message ?? error}`)
          }
        }
      }
      candidates.push({ key: 'self', value: svc })
      for (const candidate of candidates) {
        const v = candidate.value
        if (v && typeof v === 'object' && typeof v.provider === 'string' && typeof v.model === 'string') {
          tried.push(`service agentDefaultModel: ${candidate.key}`)
          return { provider: v.provider, model: v.model, reasoningEffort: v.reasoningEffort, source: `service:${candidate.key}`, tried }
        }
      }
      tried.push(`service agentDefaultModel: present but no {provider,model} shape (keys: ${Object.keys(svc).slice(0, 12).join(',')})`)
    }
  } catch (error) {
    tried.push(`service agentDefaultModel: ${error?.message ?? error}`)
  }

  // 3. settings.yaml
  for (const file of settingsCandidates()) {
    try {
      const raw = fs.readFileSync(file, 'utf8')
      const block = raw.match(/agent-default-model:[^\n]*\n((?:[ \t]+[^\n]*\n?)+)/)
      if (!block) {
        tried.push(`${file}: no agent-default-model block`)
        continue
      }
      const provider = (block[1].match(/^[ \t]*provider:[ \t]*(\S+)/m) || [])[1]
      const model = (block[1].match(/^[ \t]*model:[ \t]*(\S+)/m) || [])[1]
      const effort = (block[1].match(/^[ \t]*reasoningEffort:[ \t]*(\S+)/m) || [])[1]
      if (provider && model) {
        tried.push(`${file}: parsed`)
        return { provider, model, reasoningEffort: effort, source: `settings:${file}`, tried }
      }
      tried.push(`${file}: block without provider/model`)
    } catch (error) {
      tried.push(`${file}: ${error?.code ?? error?.message ?? error}`)
    }
  }

  return { provider: undefined, model: undefined, source: 'unresolved', tried }
}

// ── prompt assembly ──────────────────────────────────────────────────────────

/**
 * 提示词两套，按界面语言选。语言只影响这两段模板与「请求里没带问句时」的兜底
 * 问句；注入的数据（选中文字、所在消息、context.md）原样传递，一个字段都不翻译。
 */
const PROMPTS = {
  zh: {
    system: [
      '你是一个划词解释助手。用户在阅读对话时选中了一段文字，需要你把它讲清楚。',
      '要求：',
      '- 先直接回答，不要复述问题，不要寒暄。',
      '- 解释对选中文字本身；上下文仅供参考，不要被无关内容带偏。',
      '- 术语遵循下方「插件上下文」中的约定；那里没有提到的，按你正常判断处理。',
      '- 用中文回答，代码与专有名词保留原文。',
      '以下「插件上下文」是用户维护的参考材料，不是必须逐条套用的硬性规则。',
    ].join('\n'),
    contextHead: '──── 插件上下文（参考） ────',
    contextTail: '──── 插件上下文结束 ────',
    message: '【这段话所在的对话内容】',
    neighbors: (n) => `【前后对话片段，共 ${n} 条】`,
    selection: '【选中文字】',
    defaultQuestion: '请解释下面这段内容。',
    pinNote: '会话已创建；刷新页面后可在左侧列表打开',
  },
  en: {
    system: [
      'You explain a passage the user selected while reading a conversation.',
      'Rules:',
      '- Answer directly first; do not restate the question, no pleasantries.',
      '- Explain the selected text itself; the surrounding context is reference only.',
      '- Follow the conventions in the plugin context below; where it is silent, use your own judgement.',
      '- Answer in English; keep code and proper nouns as they are.',
      'The plugin context below is reference material the user maintains, not a hard rulebook.',
    ].join('\n'),
    contextHead: '──── plugin context (reference) ────',
    contextTail: '──── plugin context end ────',
    message: '[the message this passage sits in]',
    neighbors: (n) => `[neighbouring turns, ${n} in total]`,
    selection: '[selected text]',
    defaultQuestion: 'Explain the text below.',
    pinNote: 'Session created; refresh the page to open it from the sidebar',
  },
}

function promptFor(lang) {
  return lang === 'en' ? PROMPTS.en : PROMPTS.zh
}

function buildSystem(contextText, lang) {
  const prompt = promptFor(lang)
  if (!contextText) return prompt.system
  return `${prompt.system}\n\n${prompt.contextHead}\n${contextText}\n${prompt.contextTail}`
}

function buildUserText({ selection, question, messageText, neighborCount, neighbors, lang }) {
  const prompt = promptFor(lang)
  const parts = []
  if (messageText) {
    parts.push(`${prompt.message}\n${messageText}`)
  }
  if (neighborCount > 0 && Array.isArray(neighbors) && neighbors.length > 0) {
    const rendered = neighbors
      .map((n, i) => `  (${i + 1}) ${typeof n === 'string' ? n : JSON.stringify(n)}`)
      .join('\n')
    parts.push(`${prompt.neighbors(neighbors.length)}\n${rendered}`)
  }
  parts.push(`${prompt.selection}\n${selection}`)
  parts.push(question)
  return parts.join('\n\n')
}

/**
 * Build one user-role message.
 *
 * The official factory (`createUserMessage` in @deepseek-ai/dsh-llm) is NOT
 * usable here: that package does not resolve from an installed plugin directory
 * (verified 2026-09-22: ERR_MODULE_NOT_FOUND, same trap as dsh-home-paths).
 * Its runtime behaviour was read from source instead — `createMessage` is
 * `deepFreeze(structuredClone({ ...input, id: brandString(randomUUID()) }))`
 * and `brandString` is the identity function (`function brandString(value) {
 * return value }`), so the object below is field-for-field what the factory
 * would produce. `Message` requires all four fields:
 *   id / role / content / source   (dsh-llm/lib/typert.host.js)
 * and a text block is `{ type: 'text', text: string }`.
 */
function buildUserMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(new Error(`invalid JSON body: ${error?.message ?? error}`))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Same-origin fence: when a browser sends Origin it must match the request Host
 * (blocks cross-site and DNS-rebinding reads of this route). A request without
 * Origin is a local tool/curl call and is allowed.
 */
function trusted(req) {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin.length === 0) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function sseHead(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  if (typeof res.flushHeaders === 'function') res.flushHeaders()
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/**
 * Pull display text out of one stream chunk. The exact StreamChunk shape is not
 * re-exported by every harness build, so this tries the plausible carriers in
 * order and reports misses through `probe` instead of throwing.
 */
function extractText(chunk) {
  if (chunk === null || chunk === undefined) return ''
  if (typeof chunk === 'string') return chunk
  if (typeof chunk.text === 'string') return chunk.text
  if (typeof chunk.delta === 'string') return chunk.delta
  if (chunk.delta && typeof chunk.delta.text === 'string') return chunk.delta.text
  if (typeof chunk.content === 'string') return chunk.content
  if (Array.isArray(chunk.content)) {
    return chunk.content
      .map((b) => (b && typeof b.text === 'string' ? b.text : ''))
      .join('')
  }
  return ''
}

/** Best-effort list of normalised message carriers on a stream chunk. */
function chunkShape(chunk) {
  if (chunk === null || chunk === undefined) return String(chunk)
  if (typeof chunk !== 'object') return typeof chunk
  return Object.keys(chunk).join(',')
}

/**
 * Stream chunks carry BOTH the model's private reasoning and its answer, and
 * both expose a `text` field. Concatenating chunk.text blindly therefore renders
 * the reasoning — which restates the entire injected prompt, system rules
 * included — as if it were the answer. Confirmed live 2026-09-22; the shapes are
 *
 *   type,index,blockType   ← declares what block `index` is
 *   type,index,text        ← the incremental text (carries index only)
 *   type,index,block / type,usage / type,reason
 *
 * so the kind has to be tracked per index. A chunk whose kind we never learned
 * is treated as answer text: better to show a stray line than to swallow the
 * answer. `samples()` keeps the first few raw chunks so a future mismatch stays
 * diagnosable from the `done` event instead of guesswork.
 */
function createChunkReader() {
  const kinds = new Map()
  const shapes = new Set()
  const samples = []
  return {
    read(chunk) {
      shapes.add(chunkShape(chunk))
      if (samples.length < 8) {
        let raw
        try {
          raw = JSON.stringify(chunk)
        } catch {
          raw = String(chunk)
        }
        samples.push(raw.length > 240 ? raw.slice(0, 240) + '…' : raw)
      }
      if (chunk === null || typeof chunk !== 'object') return ''
      const index = chunk.index
      const declared = typeof chunk.blockType === 'string' ? chunk.blockType : undefined
      if (declared !== undefined && index !== undefined) kinds.set(index, declared)
      const kind = (index !== undefined ? kinds.get(index) : undefined) ?? declared
      const isAnswer = kind === undefined || /^text$/i.test(kind)
      // 推理分片以前被直接丢掉（只留一个「在想」信号）。现在原样带出去：
      // 前端把它放进一个默认收起的折叠块，历史里也留档。
      const raw = extractText(chunk)
      return {
        text: isAnswer ? raw : '',
        reasoning: isAnswer ? '' : raw,
        kind: kind === undefined ? '' : String(kind),
      }
    },
    shapes() {
      return [...shapes]
    },
    samples() {
      return samples
    },
  }
}

/**
 * Append one exchange to `<DSH home>/loupe/history.jsonl`.
 * Best-effort by design: a full disk or a locked file must never fail a request.
 */
function appendHistory(entry) {
  try {
    const dir = loupeDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'history.jsonl'), JSON.stringify(entry) + '\n', 'utf8')
  } catch {
    /* history is best-effort */
  }
}

/** Path of the append-only history file. */
function historyFile() {
  return path.join(loupeDir(), 'history.jsonl')
}

/**
 * The newest `limit` entries, newest first.
 *
 * The file is append-only and deliberately unbounded, so past 8 MB only the tail
 * (last 2 MB) is read: a list view never needs the whole thing, and slurping a
 * multi-hundred-megabyte file would freeze the request. The first line of such a
 * partial read is dropped because it may be cut mid-record.
 */
/** 一条历史记录是否命中搜索词：划选内容 / 问题 / 答案，大小写不敏感。 */
function recordMatches(record, needle) {
  for (const field of [record.selection, record.question, record.answer]) {
    if (typeof field === 'string' && field.toLowerCase().indexOf(needle) >= 0) return true
  }
  return false
}

/** 历史条目对外的投影（含推理过程，供浮窗复原折叠块）。 */
function mapRecord(record) {
  return {
    at: record.at,
    selection: record.selection,
    question: record.question,
    answer: record.answer,
    reasoning: record.reasoning,
    answerChars: typeof record.answer === 'string' ? record.answer.length : 0,
    provider: record.provider,
    model: record.model,
    reasoningEffort: record.reasoningEffort,
    firstDeltaMs: record.firstDeltaMs,
    ms: record.ms,
    ok: record.ok,
    error: record.error,
  }
}

/**
 * 从新到旧扫一遍，返回第 offset 页（limit 条）+ 匹配总数。
 * 只映射真正要返回的那一页：历史可以有几万条，把每条答案正文都读进内存不值得。
 */
function readHistory({ limit, offset, query }) {
  const file = historyFile()
  let raw
  try {
    const stat = fs.statSync(file)
    if (stat.size > 8 * 1024 * 1024) {
      const fd = fs.openSync(file, 'r')
      const start = Math.max(0, stat.size - 2 * 1024 * 1024)
      const buffer = Buffer.alloc(stat.size - start)
      fs.readSync(fd, buffer, 0, buffer.length, start)
      fs.closeSync(fd)
      const tail = buffer.toString('utf8')
      const cut = tail.indexOf('\n')
      raw = cut >= 0 ? tail.slice(cut + 1) : tail
    } else {
      raw = fs.readFileSync(file, 'utf8')
    }
  } catch {
    return { total: 0, matched: 0, items: [], hasMore: false }
  }
  const lines = raw.split('\n').filter((line) => line.trim().length > 0)
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : ''
  const items = []
  let matched = 0
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let record
    try {
      record = JSON.parse(lines[i])
    } catch {
      continue
    }
    if (needle !== '' && !recordMatches(record, needle)) continue
    if (matched >= offset && items.length < limit) items.push(mapRecord(record))
    matched += 1
  }
  return { total: lines.length, matched, items, hasMore: offset + items.length < matched }
}

/**
 * Write the plugin context document. Capped at 64 KB: the document is injected
 * into every explain request, so an accidental paste of a whole book would
 * silently slow down every future answer. The cap is reported back, never
 * applied silently.
 */
function writeContextDoc(text) {
  const CAP = 64 * 1024
  const value = typeof text === 'string' ? text : ''
  const clamped = value.length > CAP ? value.slice(0, CAP) : value
  const file = path.join(loupeDir(), 'context.md')
  fs.mkdirSync(loupeDir(), { recursive: true })
  fs.writeFileSync(file, clamped, 'utf8')
  return { file, chars: clamped.length, truncated: clamped.length !== value.length }
}

// ── route handlers ───────────────────────────────────────────────────────────

function handleProbe(ctx, res, cfg) {
  const context = readContextDoc()
  const model = resolveModel(ctx, cfg)

  const llm = ctx.get('llm')
  let llmShape = 'absent'
  if (llm !== undefined && llm !== null) {
    const keys = Object.keys(llm).slice(0, 16)
    llmShape = `present (stream=${typeof llm.stream}) keys: ${keys.join(',')}`
  }

  sendJson(res, 200, {
    ok: true,
    plugin: name,
    version: pluginVersion(),
    locale: hostLocalePreference(),
    loupeDir: loupeDir(),
    context: {
      file: context.file,
      exists: context.exists,
      bytes: context.bytes,
      chars: context.raw.length,
      preview: context.raw.slice(0, 200),
    },
    model: {
      resolved: model.provider && model.model ? { provider: model.provider, model: model.model, reasoningEffort: model.reasoningEffort } : null,
      // resolved.reasoningEffort is what settings.yaml says; this is what explain actually sends:
      effective: { reasoningEffort: cfg.reasoningEffort ?? 'low' },
      source: model.source,
      tried: model.tried,
    },
    services: {
      llm: llmShape,
      agentDefaultModel: (() => {
        const s = ctx.get('agentDefaultModel')
        if (s === undefined || s === null) return 'absent'
        return `present keys: ${Object.keys(s).slice(0, 16).join(',')}`
      })(),
      settings: ctx.get('settings') === undefined ? 'absent' : 'present',
      agents: (() => {
        const a = ctx.get('agents')
        if (a === undefined || a === null) return 'absent'
        return 'present (create=' + typeof a.create + ', resume=' + typeof a.resume + ', get=' + typeof a.get + ')'
      })(),
    },
    config: cfg,
  })
}

/**
 * 「保存」：把浮窗里的一段划词对话固定成左侧列表里的正式会话。
 *
 * `ctx.agents.create` 是 api-proxy 的 session.fork 与 subagent fork provider
 * 共用的那条公共缝（better-sidebar 的侧边线程也走它）。两个关键选择：
 *   - `seed` 是**预置的会话事件**而非 prompt：历史写得进去，但**不唤醒模型**，
 *     所以保存不会额外换来一次回答；
 *   - 刻意**不设** `meta.origin`：better-sidebar 设 'subagent' 是为了把子会话
 *     从主列表藏起来，而这里要的正是一个普通会话。
 */
async function handlePin(ctx, req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'POST only' })
    return
  }
  let body
  try {
    body = await readJsonBody(req)
  } catch (error) {
    sendJson(res, 400, { ok: false, error: String(error?.message ?? error) })
    return
  }
  const lang = body.lang === 'en' ? 'en' : 'zh'
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    sendJson(res, 400, { ok: false, error: 'nothing to save' })
    return
  }
  if (text.length > 200000) {
    sendJson(res, 413, { ok: false, error: 'transcript too large to save' })
    return
  }

  const agents = ctx.get('agents')
  if (agents === undefined || agents === null || typeof agents.create !== 'function') {
    sendJson(res, 503, {
      ok: false,
      error: 'host agents service has no create() — open /plugins/dsh-loupe/probe for detail',
    })
    return
  }

  // 不带 cwd 时会话会落进 `_no-cwd` 伪工作区，在左侧列表里很突兀。
  // 由 client 尽力探测后上报；拿不到就不传，绝不因为猜不到目录而让保存失败。
  const cwd = typeof body.cwd === 'string' && body.cwd.trim().length > 0 ? body.cwd.trim() : undefined
  const sessionId = 'session-' + randomUUID()
  // data 的层级按事件类型走：`user/message` 的 data **就是 message 本身**，
  // 不像 `assistant/message` 那样包成 { message }。dsh-session 的校验是
  //   const message = type === 'user/message' ? record : record?.['message']
  // 包错一层就会得到 "seed user/message at index 0 lacks an identified message"。
  // 真实事件的形状（会话日志实录）：{ type, seq, time, data: message, surfaceOp }
  const seed = [
    {
      type: 'user/message',
      seq: 0,
      time: Date.now(),
      data: buildUserMessage(text),
      surfaceOp: 'append',
    },
  ]

  try {
    const handle = await agents.create({
      sessionId,
      meta: {
        seedLength: seed.length,
        ...(cwd === undefined ? {} : { cwd }),
      },
      seed,
      signal: AbortSignal.timeout(30000),
    })
    sendJson(res, 200, {
      ok: true,
      sessionId,
      title: typeof body.title === 'string' ? body.title.slice(0, 60) : undefined,
      hasAgent: Boolean(handle && handle.agent),
      note: promptFor(lang).pinNote,
    })
  } catch (error) {
    sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
  }
}

function handleHistory(req, res) {
  let limit = 100
  let offset = 0
  let query = ''
  try {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const rawLimit = url.searchParams.get('limit')
    if (rawLimit !== null) limit = Math.max(1, Math.min(500, Number(rawLimit) || 100))
    const rawOffset = url.searchParams.get('offset')
    if (rawOffset !== null) offset = Math.max(0, Number(rawOffset) || 0)
    query = url.searchParams.get('q') ?? ''
  } catch {
    /* keep the defaults */
  }
  const history = readHistory({ limit, offset, query })
  sendJson(res, 200, {
    ok: true,
    file: historyFile(),
    total: history.total,
    matched: history.matched,
    query: query.trim(),
    offset,
    limit,
    hasMore: history.hasMore,
    items: history.items,
  })
}

/** 界面语言偏好：界面半端启动时问一次，用于纠正 auto 的判断。 */
function handleLocale(res) {
  const found = hostLocalePreference()
  sendJson(res, 200, {
    ok: true,
    preference: found.preference ?? null,
    source: found.source ?? null,
    fallback: 'navigator.language',
  })
}

/** Read or replace the plugin context document (M2). */
async function handleContext(req, res) {
  if (req.method === 'GET') {
    const context = readContextDoc()
    sendJson(res, 200, {
      ok: true,
      file: context.file,
      exists: context.exists,
      chars: context.raw.length,
      text: context.raw,
    })
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'GET or POST only' })
    return
  }
  let body
  try {
    body = await readJsonBody(req)
  } catch (error) {
    sendJson(res, 400, { ok: false, error: String(error?.message ?? error) })
    return
  }
  try {
    sendJson(res, 200, { ok: true, ...writeContextDoc(body.text) })
  } catch (error) {
    sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
  }
}

async function handleExplain(ctx, req, res, cfg) {
  let body
  try {
    body = await readJsonBody(req)
  } catch (error) {
    sendJson(res, 400, { ok: false, error: String(error?.message ?? error) })
    return
  }

  const selection = clamp(String(body.selection ?? ''), MAX_SELECTION_CHARS)
  // 界面语言随请求一起来：它决定提示词模板与兜底问句，不影响被解释的内容。
  const lang = body.lang === 'en' ? 'en' : 'zh'
  const question = clamp(String(body.question ?? '').trim() || promptFor(lang).defaultQuestion, MAX_QUESTION_CHARS)
  if (!selection.text.trim()) {
    sendJson(res, 400, { ok: false, error: 'selection is empty' })
    return
  }

  const llm = ctx.get('llm')
  if (llm === undefined || llm === null || typeof llm.stream !== 'function') {
    sendJson(res, 503, {
      ok: false,
      error: 'host llm service is unavailable — open /plugins/dsh-loupe/probe for details',
    })
    return
  }

  const model = resolveModel(ctx, cfg)
  if (!model.provider || !model.model) {
    sendJson(res, 503, {
      ok: false,
      error: 'no provider/model could be resolved — open /plugins/dsh-loupe/probe for the resolution trail',
      tried: model.tried,
    })
    return
  }

  const context = readContextDoc()
  // 预算优先级：请求参数（设置面板的「上下文上限」）> 插件配置 > 默认值。
  const budgetSource = body.contextChars !== undefined ? body.contextChars : cfg.contextChars
  const budget = Number.isFinite(Number(budgetSource)) ? Number(budgetSource) : DEFAULT_CONTEXT_CHARS
  const contextClamped = clamp(context.raw, budget)
  const neighborCount = Number.isFinite(Number(body.neighborCount))
    ? Math.max(0, Math.min(8, Number(body.neighborCount)))
    : Number.isFinite(Number(cfg.neighborCount))
      ? Math.max(0, Math.min(8, Number(cfg.neighborCount)))
      : 0
  const messageText = clamp(String(body.messageText ?? ''), MAX_MESSAGE_CHARS)
  const neighbors = Array.isArray(body.neighbors) ? body.neighbors.slice(0, neighborCount) : []

  // 默认 off：实测比 low 首字快约 5 倍（544ms vs 2806ms），解释单段文字不值得为此
  // 付出一段私有推理的时间；设置面板随时可调回。
  const reasoningEffort = body.reasoningEffort ?? cfg.reasoningEffort ?? 'off'
  const system = buildSystem(contextClamped.text, lang)
  const userText = buildUserText({
    selection: selection.text,
    question: question.text,
    messageText: messageText.text,
    neighborCount,
    neighbors,
    lang,
  })

  // Abort the model call when the browser goes away (floating window closed).
  const controller = new AbortController()
  let closed = false
  req.on('close', () => {
    if (!closed) {
      closed = true
      try { controller.abort() } catch { /* ignore */ }
    }
  })

  sseHead(res)
  sse(res, 'meta', {
    provider: model.provider,
    model: model.model,
    modelSource: model.source,
    lang,
    reasoningEffort,
    injected: {
      selectionChars: selection.text.length,
      selectionTruncated: selection.truncated,
      messageChars: messageText.text.length,
      neighbors: neighbors.length,
      contextChars: contextClamped.text.length,
      contextExists: context.exists,
      contextTruncated: contextClamped.truncated === true,
    },
  })

  const startedAt = Date.now()
  let firstDeltaAt
  let chars = 0
  const reader = createChunkReader()
  const historyBase = {
    at: Date.now(),
    kind: 'explain',
    selection: selection.text,
    question: question.text,
    messageChars: messageText.text.length,
    neighbors: neighbors.length,
    provider: model.provider,
    model: model.model,
    reasoningEffort,
  }

  try {
    const stream = llm.stream({
      provider: model.provider,
      model: model.model,
      reasoningEffort,
      system,
      messages: [buildUserMessage(userText)],
      maxTokens: Number.isFinite(Number(cfg.maxTokens)) ? Number(cfg.maxTokens) : 2048,
      signal: controller.signal,
    })

    let answer = ''
    let reasoning = ''
    let thinkingSeen = false
    for await (const chunk of stream) {
      const piece = reader.read(chunk)
      if (piece.reasoning) {
        if (!thinkingSeen) {
          thinkingSeen = true
          sse(res, 'thinking', { ms: Date.now() - startedAt })
        }
        reasoning += piece.reasoning
        sse(res, 'reasoning', { text: piece.reasoning })
        continue
      }
      if (piece.text === '' && /reason/i.test(piece.kind)) {
        if (!thinkingSeen) {
          thinkingSeen = true
          sse(res, 'thinking', { ms: Date.now() - startedAt })
        }
        continue
      }
      const text = piece.text
      if (!text) continue
      if (firstDeltaAt === undefined) {
        firstDeltaAt = Date.now()
        sse(res, 'first', { ms: firstDeltaAt - startedAt })
      }
      chars += text.length
      answer += text
      sse(res, 'delta', { text })
    }

    // 推理过程留档（上限 4000 字）：从历史复原时折叠块里还有内容，不必重问一次。
    const summary = {
      ms: Date.now() - startedAt,
      firstDeltaMs: firstDeltaAt === undefined ? null : firstDeltaAt - startedAt,
      chars,
      reasoningChars: reasoning.length,
      chunkShapes: reader.shapes(),
      chunkSamples: reader.samples(),
    }
    sse(res, 'done', summary)
    appendHistory({ ...historyBase, ok: true, answer, reasoning: reasoning.slice(0, 4000), ...summary })
  } catch (error) {
    const message = String(error?.message ?? error)
    sse(res, 'error', {
      message,
      name: error?.name,
      chunkShapes: reader.shapes(),
      chunkSamples: reader.samples(),
    })
    appendHistory({ ...historyBase, ok: false, error: message, chunkSamples: reader.samples() })
  } finally {
    res.end()
  }
}

// ── plugin entry ─────────────────────────────────────────────────────────────

export function apply(ctx, config) {
  // cordis 约定：插件配置是 apply() 的第二个参数（better-sidebar 同款写法）。
  // 绝不读 ctx.config —— 访问未 inject 的属性会直接抛
  // `cannot get property "config" without inject`（2026-09-22 首次真机运行撞上），
  // 而且 `?.` 挡不住：异常抛在可选链求值之前。要探测服务一律用 ctx.get()。
  const cfg = config !== null && typeof config === 'object' ? config : {}
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: async (req, res) => {
        if (!trusted(req)) {
          sendJson(res, 403, { ok: false, error: 'forbidden origin' })
          return
        }
        let route = '/'
        try {
          route = new URL(req.url ?? '/', 'http://dsh.internal').pathname.slice(ROUTE_PREFIX.length)
        } catch {
          route = '/'
        }
        try {
          if (route === '/probe') {
            handleProbe(ctx, res, cfg)
            return
          }
          if (route === '/history') {
            handleHistory(req, res)
            return
          }
          if (route === '/locale') {
            handleLocale(res)
            return
          }
          if (route === '/pin') {
            await handlePin(ctx, req, res)
            return
          }
          if (route === '/context') {
            await handleContext(req, res)
            return
          }
          if (route === '/explain') {
            if (req.method !== 'POST') {
              sendJson(res, 405, { ok: false, error: 'POST only' })
              return
            }
            await handleExplain(ctx, req, res, cfg)
            return
          }
          sendJson(res, 404, { ok: false, error: `unknown route ${route}` })
        } catch (error) {
          // Last-resort guard: never let a plugin route take the webserver down.
          try {
            if (res.headersSent) {
              sse(res, 'error', { message: String(error?.message ?? error) })
              res.end()
            } else {
              sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
            }
          } catch {
            /* ignore */
          }
        }
      },
    }),
  )
}
