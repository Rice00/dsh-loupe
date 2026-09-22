/**
 * dsh-loupe — client half (M1: minimal runnable).
 *
 * Select text inside the conversation → a tiny bar appears under the selection
 * with two actions:
 *
 *   解释 — opens the floating window (single instance). The window shows the
 *          selected text as a quote strip, an input pre-filled with the default
 *          question, and the streamed answer below. Multi-turn: each send
 *          appends to the same window.
 *   设置 — opens the diagnosis panel. In M1 this panel IS the probe: it calls
 *          GET /plugins/dsh-loupe/probe and prints what the host resolved
 *          (model source, service availability, context file, inject sizes).
 *          M5 replaces it with real settings + the history browser.
 *
 * Deliberately plain DOM instead of React: this half only needs a floating
 * layer on top of the page, and every dependency not taken is a failure mode
 * not inherited. Markdown is rendered as pre-wrapped text in M1.
 *
 * Hand-written against the module-loader contract (no bundler step).
 */
window.__ModuleLoader__.load({
  id: 'dsh-loupe',
  factory: (require) => {
    // 模块加载器契约：factory 收到 require，必须返回 module.exports。下面两行不能省 ——
    // 本机 dsh-job-progress 的实测教训（2026-09-20）：漏了这两行，客户端半边一加载就抛
    // ReferenceError: exports is not defined，渲染层的插件图随之崩掉、界面起不来，
    // 而宿主半边照常挂载、日志里一条异常都没有。照抄这份契约。
    const module = { exports: {} }
    const exports = module.exports

    const ROUTE = '/plugins/dsh-loupe'
    const Z_BAR = 2147483000
    const Z_WIN = 2147483100

    // The host ships a shared markdown renderer (GFM + TeX + Shiki, with a
    // streaming mode). It owns link allowlisting, lazy images and incremental
    // fence highlighting; the only thing it asks of an owner is the chrome copy.
    // If it cannot be reached, answers fall back to pre-wrapped plain text.
    let React = null
    let ReactDOMClient = null
    let MarkdownText = null
    const MD_LABELS = {
      code: { copyLabel: '复制', copiedLabel: '已复制' },
      footnotes: '脚注',
    }
    try {
      React = require('react')
      ReactDOMClient = require('react-dom/client')
      MarkdownText = require('@deepseek-ai/dsh-client-ui-primitives').MarkdownText
    } catch (error) {
      React = null
      ReactDOMClient = null
      MarkdownText = null
      console.warn('[dsh-loupe] 宿主 markdown 组件不可用，回退纯文本：', error && error.message)
    }

    // ── styles ───────────────────────────────────────────────────────────────

    const CSS = `
    .loupe-bar{position:fixed;z-index:${Z_BAR};display:flex;gap:2px;padding:3px;border-radius:8px;
      background:#ffffff;border:1px solid rgba(8,31,92,.16);box-shadow:0 6px 20px rgba(8,31,92,.16);
      font:13px/1.4 "Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#081f5c}
    .loupe-bar button{all:unset;cursor:pointer;padding:4px 10px;border-radius:6px;white-space:nowrap}
    .loupe-bar button:hover{background:rgba(51,78,172,.10)}
    .loupe-bar button.on{color:#334eac;font-weight:600}
    .loupe-bar .sep{width:1px;margin:3px 2px;background:rgba(8,31,92,.14)}
    .loupe-win{position:fixed;z-index:${Z_WIN};width:420px;max-width:calc(100vw - 24px);display:flex;flex-direction:column;
      border-radius:10px;background:#f7f2eb;border:1px solid rgba(8,31,92,.16);
      box-shadow:0 18px 48px rgba(8,31,92,.24);font:14px/1.7 "Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#081f5c}
    .loupe-win.dark{background:#161a22;color:#e6e9f0;border-color:rgba(255,255,255,.14)}
    .loupe-head{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:move;touch-action:none;user-select:none;-webkit-user-select:none;
      border-bottom:1px solid rgba(8,31,92,.10)}
    .loupe-win.dark .loupe-head{border-bottom-color:rgba(255,255,255,.10)}
    .loupe-title{flex:1;font-size:12px;font-weight:600;letter-spacing:.08em;color:#334eac;opacity:.9}
    .loupe-win.dark .loupe-title{color:#9db2e8}
    .loupe-head button{all:unset;cursor:pointer;padding:2px 7px;border-radius:6px;font-size:13px}
    .loupe-head button:hover{background:rgba(51,78,172,.12)}
    .loupe-body{max-height:46vh;overflow:auto;padding:10px 12px}
    .loupe-quote{margin:0 10px;padding:6px 9px;border-left:2px solid #bad6eb;background:rgba(186,214,235,.22);
      border-radius:0 6px 6px 0;font-size:12.5px;color:#334eac;max-height:72px;overflow:auto;white-space:pre-wrap}
    .loupe-win.dark .loupe-quote{background:rgba(120,150,220,.14);color:#c3cde8;border-left-color:#4a6bab}
    .loupe-turn{margin-bottom:12px}
    .loupe-q{font-size:12.5px;color:#334eac;opacity:.85;margin-bottom:4px}
    .loupe-win.dark .loupe-q{color:#9db2e8}
    .loupe-a{word-break:break-word}
    .loupe-a.plain{white-space:pre-wrap}
    .loupe-note{font-size:11.5px;color:#7096d1;margin-top:6px}
    .loupe-err{color:#b03030;font-size:12.5px;white-space:pre-wrap}
    .loupe-foot{display:flex;gap:8px;align-items:flex-end;padding:8px 10px;border-top:1px solid rgba(8,31,92,.10)}
    .loupe-win.dark .loupe-foot{border-top-color:rgba(255,255,255,.10)}
    .loupe-input{flex:1;resize:none;min-height:34px;max-height:110px;padding:7px 9px;border-radius:7px;
      border:1px solid rgba(8,31,92,.18);background:#fff;color:inherit;font:13px/1.5 inherit;box-sizing:border-box}
    .loupe-win.dark .loupe-input{background:#0f131a;border-color:rgba(255,255,255,.16)}
    .loupe-send{all:unset;cursor:pointer;padding:7px 14px;border-radius:7px;background:#334eac;color:#fff;font-size:13px}
    .loupe-send[disabled]{opacity:.5;cursor:default}
    .loupe-send.settings{background:transparent;color:inherit;border:1px solid rgba(8,31,92,.2)}
    .loupe-probe{font:11.5px/1.6 Consolas,ui-monospace,monospace;white-space:pre-wrap;word-break:break-all}
    .loupe-spin{display:inline-block;width:8px;height:8px;border-radius:50%;background:#334eac;opacity:.6;margin-right:6px}
    .loupe-tabs{display:flex;gap:2px;padding:0 10px;border-bottom:1px solid rgba(8,31,92,.10)}
    .loupe-tab{all:unset;cursor:pointer;padding:6px 12px;font-size:12.5px;border-radius:6px 6px 0 0;color:#334eac;opacity:.72}
    .loupe-tab.on{opacity:1;font-weight:600;box-shadow:inset 0 -2px 0 #334eac}
    .loupe-win.dark .loupe-tabs{border-bottom-color:rgba(255,255,255,.10)}
    .loupe-hist{display:flex;flex-direction:column;gap:2px;margin-top:10px}
    .loupe-hist-item{padding:7px 9px;border-radius:7px;cursor:pointer;border:1px solid transparent}
    .loupe-hist-item:hover{background:rgba(51,78,172,.08);border-color:rgba(51,78,172,.18)}
    .loupe-hist-head{display:flex;gap:8px;align-items:baseline;font-size:11.5px;color:#7096d1}
    .loupe-hist-time{color:#7096d1;flex:none}
    .loupe-hist-sel{color:#334eac;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .loupe-hist-q{font-size:13.5px;color:#334eac;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .loupe-hist-meta{font-size:11.5px;color:#7096d1;margin-top:2px}
    .loupe-editor{width:100%;box-sizing:border-box;min-height:200px;margin-top:10px;padding:9px;border-radius:8px;border:1px solid rgba(8,31,92,.18);background:#fff;color:inherit;font:12.5px/1.7 Consolas,ui-monospace,monospace;resize:vertical}
    .loupe-win.dark .loupe-editor{background:#0f131a;border-color:rgba(255,255,255,.16)}
    .loupe-actions{display:flex;gap:10px;align-items:center;margin-top:8px}
    .loupe-param{padding:9px 0;border-bottom:1px solid rgba(8,31,92,.08)}
    .loupe-win.dark .loupe-param{border-bottom-color:rgba(255,255,255,.08)}
    .loupe-param-label{font-size:13.5px;font-weight:600;color:#334eac}
    .loupe-param-hint{font-size:11.5px;color:#7096d1;margin-top:3px}
    .loupe-select{margin-top:6px;padding:4px 8px;border-radius:6px;border:1px solid rgba(8,31,92,.18);background:#fff;color:inherit;font:13px inherit}
    .loupe-win.dark .loupe-select{background:#0f131a;border-color:rgba(255,255,255,.16)}
    `

    // ── state ────────────────────────────────────────────────────────────────

    let bar = null
    let win = null
    let currentSelection = null
    let sendSeq = 0
    // client 根上下文：保存时要经它拿 sessions 服务（ctx.get 探测，不抛）。
    let clientCtx = null
    let disposers = []

    function isDark() {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    }

    function el(tag, className, text) {
      const node = document.createElement(tag)
      if (className) node.className = className
      if (text !== undefined) node.textContent = text
      return node
    }

    // ── selection plumbing ───────────────────────────────────────────────────

    function readSelection() {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
      const text = sel.toString().trim()
      if (!text) return null
      const range = sel.getRangeAt(0)
      const anchor = range.commonAncestorContainer
      const node = anchor.nodeType === 1 ? anchor : anchor.parentElement
      if (!node) return null
      if (node.closest('[data-dsh-loupe]')) return null
      if (node.closest('input,textarea,[contenteditable="true"]')) return null
      const flow = node.closest('[data-chat-flow]')
      if (!flow) return null
      let rect
      try {
        rect = range.getBoundingClientRect()
      } catch {
        return null
      }
      if (!rect || (rect.width === 0 && rect.height === 0)) return null
      return { text, rect, flow, node }
    }

    /** Nearest element that is a direct child of the chat flow — the message box. */
    function locateMessage(node, flow) {
      let cur = node
      while (cur && cur.parentElement && cur.parentElement !== flow) cur = cur.parentElement
      if (!cur || cur === flow) return null
      return cur
    }

    function messageTextOf(selection) {
      if (!selection || !selection.node || !selection.flow) return ''
      const box = locateMessage(selection.node, selection.flow)
      if (!box) return ''
      const text = (box.innerText || '').trim()
      return text.length > 4000 ? text.slice(0, 4000) : text
    }

    // ── floating bar ─────────────────────────────────────────────────────────

    function hideBar() {
      if (bar) {
        bar.remove()
        bar = null
      }
    }

    function showBar(selection) {
      hideBar()
      bar = el('div', 'loupe-bar')
      bar.setAttribute('data-dsh-loupe', 'bar')

      const explain = el('button', 'on', '解释')
      explain.addEventListener('mousedown', (e) => e.preventDefault())
      explain.addEventListener('click', () => {
        openWindow(selection)
        hideBar()
      })

      const sep = el('span', 'sep')
      const settings = el('button', undefined, '设置')
      settings.title = 'loupe 设置与诊断'
      settings.addEventListener('mousedown', (e) => e.preventDefault())
      settings.addEventListener('click', () => {
        openSettings()
        hideBar()
      })

      bar.appendChild(explain)
      bar.appendChild(sep)
      bar.appendChild(settings)
      document.body.appendChild(bar)

      // Anchor under the selection, kept inside the viewport.
      const r = selection.rect
      const w = bar.offsetWidth || 120
      const h = bar.offsetHeight || 28
      let left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8)
      let top = r.bottom + 6
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6)
      bar.style.left = `${Math.round(left)}px`
      bar.style.top = `${Math.round(top)}px`
    }

    // ── floating window ──────────────────────────────────────────────────────

    function ensureWindow() {
      if (win) return win
      win = el('div', `loupe-win${isDark() ? ' dark' : ''}`)
      win.setAttribute('data-dsh-loupe', 'win')

      const head = el('div', 'loupe-head')
      // 从历史恢复的浮窗需要一个回程：'←' 关掉浮窗、回到设置面板（历史页）。
      // 正常划词进来的浮窗没有"来处"，这个键就不出现。
      const back = el('button', undefined, '←')
      back.title = '返回历史列表'
      back.style.display = 'none'
      back.addEventListener('click', () => {
        closeWindow()
        openSettings()
      })
      const title = el('div', 'loupe-title', 'LOUPE · 划词解释')
      const save = el('button', undefined, '保存')
      save.title = '把这段对话保存成左侧列表里的正式会话'
      save.addEventListener('click', () => saveCurrent())
      const close = el('button', undefined, '×')
      close.title = '关闭（历史会保留）'
      close.addEventListener('click', () => closeWindow())
      head.appendChild(back)
      head.appendChild(title)
      head.appendChild(save)
      head.appendChild(close)

      const quote = el('div', 'loupe-quote')
      quote.setAttribute('data-loupe', 'quote')

      const body = el('div', 'loupe-body')
      body.setAttribute('data-loupe', 'body')

      const foot = el('div', 'loupe-foot')
      const input = el('textarea', 'loupe-input')
      input.setAttribute('data-loupe', 'input')
      const send = el('button', 'loupe-send', '发送')
      foot.appendChild(input)
      foot.appendChild(send)

      win.appendChild(head)
      win.appendChild(quote)
      win.appendChild(body)
      win.appendChild(foot)
      document.body.appendChild(win)

      makeDraggable(win, head)
      restorePosition(win)

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          submit()
        }
      })
      send.addEventListener('click', () => submit())

      win.__loupe = { quote, body, input, send, save, back }
      return win
    }

    function closeWindow() {
      sendSeq += 1 // aborts any in-flight render target
      if (win) {
        win.remove()
        win = null
      }
      hideBar()
    }

    function openWindow(selection) {
      currentSelection = selection
      const w = ensureWindow()
      const parts = w.__loupe
      parts.back.style.display = 'none'
      parts.quote.textContent = selection.text
      parts.quote.style.display = selection.text ? '' : 'none'
      parts.input.value = '请解释下面这段内容。'
      placeNearWindow(w, selection.rect)
      parts.input.focus()
      parts.input.select()
      // 「选中就弹」的语义延伸到动作：点解释即开问。
      submit()
    }

    function placeNearWindow(w, rect) {
      if (w.dataset.positioned === '1' || rect === null || rect === undefined) return
      const width = 420
      let left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 12)
      let top = rect.bottom + 12
      if (top + 240 > window.innerHeight) top = Math.max(12, window.innerHeight - 300)
      w.style.left = `${Math.round(left)}px`
      w.style.top = `${Math.round(top)}px`
      w.dataset.positioned = '1'
    }

    /**
     * 头部拖拽。
     *
     * 用 Pointer Events + setPointerCapture：一旦捕获，pointermove / pointerup
     * 只会发给 handle —— 既不会被"指针移出窗口"打断，也不怕宿主页面别处
     * stopPropagation。原先的实现把 mousemove 挂在 document 上、还在冒泡阶段，
     * 任何一个祖先拦截事件就会让浮窗完全拖不动（2026-09-22 用户实测反馈）。
     *
     * 另：捕获失败时不回退 document 监听 —— 那正是原来失效的那条路；
     * 直接把监听放在 handle 上即可，指针不移出 handle 时它照样收得到。
     */
    /**
     * 头部拖拽（第二版，2026-09-22 用户实测反馈）。
     *
     * 第一版把 pointerdown 挂在 handle 上（冒泡阶段）。实测现象：光标变成移动
     * 形状、但按住拖动只会**选中文本** —— 说明 pointerdown 压根没到处理器
     * （到了就会 preventDefault，Web 标准下不会退化成选择文本）。最合理的解释
     * 是宿主在 **capture 阶段**消费/拦截了指针事件，冒泡阶段的监听永远等不到。
     *
     * 所以这一版：
     *   1. 监听挂在 **window 的 capture 阶段** —— 比任何内层拦截都早，再用
     *      handle.contains(target) 判断点击是否落在头部；
     *   2. 头部整体 user-select:none —— 即便事件链路再出意外，拖动最多是
     *      "不动"，不会退化成选择文本（CSS 兜底不依赖任何事件）；
     *   3. 留一组事件计数（window.__dshLoupeDrag），诊断页可见 —— 下次再出
     *      问题，看一眼计数就知道事件到底有没有到达，不用再猜。
     *
     * 回答区不加 user-select:none：那里的文字要能选中复制。
     */
    /**
     * 头部拖拽（第三版，2026-09-22）。
     *
     * 第二版把监听提到 window capture 后，解释浮窗能拖了；但用户随即发现
     * **设置面板拖不动** —— 原因是那个面板是另一套 DOM（openSettings 里自建），
     * 从来没调用过本函数。所以这一版把「位置键」做成参数，让两个面板各自记住
     * 自己的位置，并返回一个 dispose 供调用方在关闭时拆除监听（否则反复开关
     * 设置会不断累积 window 监听）。
     *
     * 事件层仍用 window capture：比任何内层拦截都早，且不受指针移出窗口影响。
     */
    function makeDraggable(node, handle, posKey) {
      let startX = 0
      let startY = 0
      let originX = 0
      let originY = 0
      let dragging = false

      const storageKey = posKey || 'dsh-loupe:win-pos'
      const stats = (window.__dshLoupeDrag = window.__dshLoupeDrag || { down: 0, move: 0, up: 0, lastTarget: '' })

      const describe = (el) => {
        if (el === null || el === undefined || typeof el.tagName !== 'string') return String(el)
        const cls = typeof el.className === 'string' && el.className.length > 0 ? '.' + el.className.split(' ')[0] : ''
        return el.tagName.toLowerCase() + cls
      }

      const onDown = (event) => {
        stats.down += 1
        stats.lastTarget = describe(event.target)
        if (!(event.target instanceof Node) || !handle.contains(event.target)) return
        if (typeof event.button === 'number' && event.button !== 0) return
        const target = event.target
        if (typeof target.closest === 'function' && target.closest('button') !== null) return
        dragging = true
        startX = event.clientX
        startY = event.clientY
        const rect = node.getBoundingClientRect()
        originX = rect.left
        originY = rect.top
        if (typeof handle.setPointerCapture === 'function' && event.pointerId !== undefined) {
          try {
            handle.setPointerCapture(event.pointerId)
          } catch {
            /* 捕获失败不影响：window 上的 capture 监听仍在 */
          }
        }
        event.preventDefault()
      }

      const onMove = (event) => {
        if (!dragging) return
        stats.move += 1
        const maxLeft = Math.max(0, window.innerWidth - 80)
        const maxTop = Math.max(0, window.innerHeight - 40)
        const left = Math.min(Math.max(0, originX + event.clientX - startX), maxLeft)
        const top = Math.min(Math.max(0, originY + event.clientY - startY), maxTop)
        node.style.left = Math.round(left) + 'px'
        node.style.top = Math.round(top) + 'px'
        event.preventDefault()
      }

      const onUp = () => {
        if (!dragging) return
        stats.up += 1
        dragging = false
        try {
          localStorage.setItem(storageKey, JSON.stringify({ left: node.style.left, top: node.style.top }))
        } catch {
          /* ignore */
        }
      }

      const dispose = () => {
        window.removeEventListener('pointerdown', onDown, true)
        window.removeEventListener('pointermove', onMove, true)
        window.removeEventListener('pointerup', onUp, true)
        window.removeEventListener('pointercancel', onUp, true)
      }

      window.addEventListener('pointerdown', onDown, true)
      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onUp, true)
      disposers.push(dispose)
      return dispose
    }

    function restorePosition(node, posKey) {
      try {
        const raw = localStorage.getItem(posKey || 'dsh-loupe:win-pos')
        if (!raw) return false
        const pos = JSON.parse(raw)
        if (pos && typeof pos.left === 'string' && typeof pos.top === 'string') {
          node.style.left = pos.left
          node.style.top = pos.top
          // 标记已定位：placeNearWindow 见到它就跳过，用户拖过的位置才留得住。
          node.dataset.positioned = '1'
          return true
        }
      } catch {
        /* ignore */
      }
      return false
    }

    /**
     * One answer surface. Prefers the host's shared MarkdownText (streaming mode
     * freezes finished blocks and incrementally highlights an open code fence);
     * falls back to pre-wrapped plain text when the primitives are unreachable.
     * Painting is rAF-throttled: one answer arrives as hundreds of deltas, and
     * re-rendering per delta would thrash React for no visible gain.
     */
    function createAnswerView(host) {
      if (MarkdownText !== null && React !== null && ReactDOMClient !== null) {
        const root = ReactDOMClient.createRoot(host)
        let text = ''
        let streaming = true
        let scheduled = false
        const paint = () => {
          if (scheduled) return
          scheduled = true
          window.requestAnimationFrame(() => {
            scheduled = false
            root.render(React.createElement(MarkdownText, { text, streaming, labels: MD_LABELS }))
          })
        }
        paint()
        return {
          mode: 'markdown',
          push(chunk) {
            text += chunk
            paint()
          },
          finish() {
            streaming = false
            paint()
          },
          dispose() {
            try {
              root.unmount()
            } catch {
              /* ignore */
            }
          },
        }
      }
      host.classList.add('plain')
      let text = ''
      return {
        mode: 'text',
        push(chunk) {
          text += chunk
          host.textContent = text
        },
        finish() {},
        dispose() {},
      }
    }

    /**
     * 「保存」：把浮窗里现有的问答打包成一段文本，交给 host 固定成正式会话。
     * 组装放在 client 侧：只有这里知道浮窗里到底有哪几轮、以及选中的原文。
     * 从 DOM 取文本（textContent）而非内部状态，是因为渲染可能已交给
     * MarkdownText，DOM 才是唯一权威的"用户看到的东西"。
     */
    function saveCurrent() {
      if (!win) return
      const parts = win.__loupe
      const questions = parts.body.querySelectorAll('.loupe-q')
      const answers = parts.body.querySelectorAll('.loupe-a')
      const count = Math.max(questions.length, answers.length)
      const turns = []
      for (let i = 0; i < count; i += 1) {
        turns.push({
          question: questions[i] ? (questions[i].textContent || '').trim() : '',
          answer: answers[i] ? (answers[i].textContent || '').trim() : '',
        })
      }
      if (turns.length === 0) {
        parts.body.appendChild(el('div', 'loupe-err', '没有可保存的对话'))
        return
      }
      const selectionText = currentSelection ? currentSelection.text || '' : ''
      const lines = ['【保存自 dsh-loupe 的划词对话】', '']
      if (selectionText) lines.push('选中文字：' + selectionText, '')
      for (const turn of turns) {
        if (turn.question) lines.push('问：' + turn.question, '')
        if (turn.answer) lines.push('答：', turn.answer, '')
      }
      lines.push('—— 以上是保存时的上下文，请在此基础上继续。')
      const title = '划词 · ' + (selectionText || turns[0].question || '').slice(0, 40)

      const btn = parts.save
      const originalLabel = btn.textContent
      btn.disabled = true
      btn.textContent = '保存中…'
      const transcript = lines.join('\n')
      const cwd = guessCwd()
      const succeed = (message) => {
        btn.textContent = '已保存'
        parts.body.appendChild(el('div', 'loupe-note', message))
        parts.body.scrollTop = parts.body.scrollHeight
      }
      const fail = (error) => {
        btn.textContent = originalLabel
        btn.disabled = false
        parts.body.appendChild(el('div', 'loupe-err', '保存失败：' + (error && error.message ? error.message : error)))
        parts.body.scrollTop = parts.body.scrollHeight
      }

      // 会话必须由**客户端**创建：只有 sessions.create 会同时把它登记进工作区的
      // 会话列表（内部 projectList），而 host 的 agents.create 只往磁盘写文件 ——
      // 那样建出来的会话在左侧列表里永远看不到。2026-09-22 实测：会话文件确实
      // 生成、日志内容正确，但 workspace.json 未收录 → 列表里查无此会话。
      const sessions = clientCtx && typeof clientCtx.get === 'function' ? clientCtx.get('sessions') : null
      const canCreate = sessions !== null && sessions !== undefined
        && typeof sessions.create === 'function' && typeof sessions.binding === 'function'

      if (!canCreate) {
        // 退化：仍走 host 的 /pin —— 会话能建出来，但可能不进列表。
        fetch(`${ROUTE}/pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: transcript, title, cwd }),
        })
          .then((r) => r.json())
          .then((payload) => {
            if (!payload || !payload.ok) throw new Error((payload && payload.error) || 'save failed')
            succeed('已创建会话 ' + String(payload.sessionId || '').slice(0, 22) + '…（客户端会话服务不可用，可能不出现在列表里）')
          })
          .catch(fail)
        return
      }

      sessions
        .create(cwd === undefined ? {} : { cwd })
        .then((sessionId) => {
          const bound = sessions.binding(sessionId)
          if (!bound || !bound.session || typeof bound.session.prompt !== 'function') {
            throw new Error('新会话尚不可寻址')
          }
          // 走 composer 同一条通路把这段对话送进去：历史、标题、列表状态全部由宿主维护。
          // content 必须是 ContentBlock[]：prompt 的实现里有
          // `content.some(part => part.type === 'file')`，传字符串会被直接拒绝
          // （实测报 `client api: session/prompt rejected "request"`）。
          return bound.session.prompt([{ type: 'text', text: transcript }], 'queue').then(() => sessionId)
        })
        .then((sessionId) => {
          succeed('已保存为新会话（' + String(sessionId).slice(0, 22) + '…）—— 它在左侧列表里，模型会先接一句。')
        })
        .catch(fail)
    }

    // ── the explain call ─────────────────────────────────────────────────────

    function submit() {
      if (!win || !currentSelection) return
      const parts = win.__loupe
      const question = parts.input.value.trim()
      if (!question) return
      parts.input.value = ''
      parts.send.disabled = true
      const seq = ++sendSeq

      const turn = el('div', 'loupe-turn')
      const q = el('div', 'loupe-q', question)
      const a = el('div', 'loupe-a')
      const view = createAnswerView(a)
      const note = el('div', 'loupe-note', '正在生成…')
      // 累积要用到完整答案：视图内部的状态拿不到，这里自己留一份。
      let answerText = ''
      note.prepend(el('span', 'loupe-spin'))
      turn.appendChild(q)
      turn.appendChild(a)
      turn.appendChild(note)
      parts.body.appendChild(turn)
      parts.body.scrollTop = parts.body.scrollHeight

      streamExplain({
        selection: currentSelection.text,
        question,
        messageText: messageTextOf(currentSelection),
        onThinking: () => {
          if (seq !== sendSeq) return
          note.textContent = '模型思考中…'
        },
        onMeta: (meta) => {
          if (seq !== sendSeq) return
          const injected = meta.injected || {}
          note.textContent = `${meta.model} · ${meta.reasoningEffort} · 注入 选区${injected.selectionChars}字 所在消息${injected.messageChars}字 插件上下文${injected.contextChars}字`
        },
        onDelta: (text) => {
          if (seq !== sendSeq) return
          answerText += text
          view.push(text)
          parts.body.scrollTop = parts.body.scrollHeight
        },
        onDone: (info) => {
          if (seq !== sendSeq) return
          view.finish()
          parts.send.disabled = false
          if (!info.chars) {
            // provider 偶发返回 0 字（实测撞到过一次）：不能只留一片空白，
            // 否则用户分不清"还在想"和"已经失败"。
            note.textContent = ''
            turn.appendChild(el('div', 'loupe-err', '模型这次没有返回内容（' + info.ms + 'ms）——按回车可重试。'))
          } else {
            note.textContent = `${info.chars} 字 · 首字 ${info.firstDeltaMs == null ? '—' : info.firstDeltaMs + 'ms'} · 共 ${info.ms}ms`
            accumulate(currentSelection ? currentSelection.text : '', answerText)
          }
        },
        onError: (message) => {
          if (seq !== sendSeq) return
          view.dispose()
          parts.send.disabled = false
          note.textContent = ''
          const err = el('div', 'loupe-err', message)
          turn.appendChild(err)
          parts.body.scrollTop = parts.body.scrollHeight
        },
      })
    }

    async function streamExplain({ selection, question, messageText, onMeta, onThinking, onDelta, onDone, onError }) {
      let response
      try {
        response = await fetch(`${ROUTE}/explain`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selection,
            question,
            messageText,
            neighborCount: settings().neighborCount === undefined ? 0 : settings().neighborCount,
            reasoningEffort: settings().reasoningEffort,
            contextChars: settings().contextChars,
          }),
        })
      } catch (error) {
        onError(`请求失败：${error && error.message ? error.message : error}`)
        return
      }

      if (!response.ok) {
        let detail = `${response.status} ${response.statusText}`
        try {
          const payload = await response.json()
          if (payload && payload.error) {
            detail = payload.error
            if (Array.isArray(payload.tried)) detail += `\n${payload.tried.join('\n')}`
          }
        } catch {
          /* ignore */
        }
        onError(detail)
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let cut
          while ((cut = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, cut)
            buffer = buffer.slice(cut + 2)
            dispatchFrame(frame, { onMeta, onThinking, onDelta, onDone, onError })
          }
        }
      } catch (error) {
        onError(`流中断：${error && error.message ? error.message : error}`)
      }
    }

    function dispatchFrame(frame, handlers) {
      let event = 'message'
      const dataLines = []
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (dataLines.length === 0) return
      let payload
      try {
        payload = JSON.parse(dataLines.join('\n'))
      } catch {
        return
      }
      if (event === 'meta') handlers.onMeta(payload)
      else if (event === 'thinking') handlers.onThinking(payload)
      else if (event === 'delta') handlers.onDelta(payload.text || '')
      else if (event === 'done') handlers.onDone(payload)
      else if (event === 'error') handlers.onError(payload.message || 'unknown error')
    }

    // ── settings / diagnosis panel (M1) ───────────────────────────────────────

    /** 设置面板：历史（M3）/ 上下文（M2）/ 诊断（M1 保留）。 */
    function openSettings() {
      if (win) closeWindow()
      const w = el('div', `loupe-win${isDark() ? ' dark' : ''}`)
      w.setAttribute('data-dsh-loupe', 'settings')
      w.style.width = '600px'

      const head = el('div', 'loupe-head')
      head.appendChild(el('div', 'loupe-title', 'LOUPE · 历史 / 上下文 / 诊断'))
      const close = el('button', undefined, '×')
      close.title = '关闭'
      close.addEventListener('click', () => w.remove())
      head.appendChild(close)

      const tabBar = el('div', 'loupe-tabs')
      const body = el('div', 'loupe-body')
      const pages = [
        ['历史', renderHistory],
        ['参数', renderParams],
        ['上下文', renderContext],
        ['诊断', renderProbe],
      ]
      for (const [label, render] of pages) {
        const btn = el('button', 'loupe-tab', label)
        btn.addEventListener('click', () => {
          for (const other of tabBar.querySelectorAll('button')) {
            other.classList.toggle('on', other === btn)
          }
          body.textContent = ''
          render(body)
        })
        tabBar.appendChild(btn)
      }

      w.appendChild(head)
      w.appendChild(tabBar)
      w.appendChild(body)
      document.body.appendChild(w)
      // 设置面板也是可拖的（用户反馈：解释浮窗能拖、这个拖不动 —— 它此前
      // 从没调用过 makeDraggable）。用独立的位置键，免得拖它把解释浮窗的位置覆盖掉。
      const settingsKey = 'dsh-loupe:settings-pos'
      if (!restorePosition(w, settingsKey)) {
        w.style.left = '24px'
        w.style.top = '80px'
        w.dataset.positioned = '1'
      }
      const stopDrag = makeDraggable(w, head, settingsKey)
      close.addEventListener('click', () => stopDrag())
      const first = tabBar.querySelector('button')
      if (first) first.click()
    }

    /** 诊断页：宿主能力一览（M1 起保留，排障第一入口）。 */
    function renderProbe(body) {
      const drag = window.__dshLoupeDrag || { down: 0, move: 0, up: 0, lastTarget: '' }
      const dragLine = el('div', 'loupe-note', '拖动事件计数：down=' + drag.down + ' move=' + drag.move + ' up=' + drag.up + ' · 最近一次按下的元素：' + (drag.lastTarget || '(无)'))
      body.appendChild(dragLine)
      const pre = el('div', 'loupe-probe', '正在读取宿主诊断…')
      body.appendChild(pre)
      fetch(`${ROUTE}/probe`)
        .then((r) => r.json())
        .then((payload) => {
          pre.textContent = JSON.stringify(payload, null, 2)
        })
        .catch((error) => {
          pre.textContent = `诊断请求失败：${error && error.message ? error.message : error}`
        })
    }

    /**
     * 参数（M5）：存在 localStorage —— 它们只影响本机这一份插件行为，没有
     * 跨设备同步的必要，也就不该为它引入一个 host 端配置面。
     */
    const PARAMS_KEY = 'dsh-loupe:params'

    function settings() {
      try {
        const raw = localStorage.getItem(PARAMS_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    function saveSetting(key, value) {
      try {
        const next = settings()
        next[key] = value
        localStorage.setItem(PARAMS_KEY, JSON.stringify(next))
      } catch {
        /* 隐私模式：参数缺失时各处都有默认值，不影响使用 */
      }
    }

    const AUTO_START = '<!-- dsh-loupe:auto:start -->'
    const AUTO_END = '<!-- dsh-loupe:auto:end -->'
    const AUTO_MAX_ITEMS = 60
    const AUTO_ANSWER_CHARS = 160
    const AUTO_SELECTION_CHARS = 40

    /**
     * 把一次解释的结论沉淀进 context.md 的受控区块。
     * 默认开启，设置页可关；任何一步失败都静默 —— 累积是锦上添花。
     */
    function accumulate(selection, answer) {
      if (settings().accumulate === false) return
      const sel = String(selection || '').replace(/\s+/g, ' ').trim().slice(0, AUTO_SELECTION_CHARS)
      const summary = String(answer || '').replace(/\s+/g, ' ').trim().slice(0, AUTO_ANSWER_CHARS)
      if (sel.length === 0 || summary.length === 0) return
      const entry = '- 「' + sel + '」→ ' + summary
      fetch(`${ROUTE}/context`)
        .then((r) => r.json())
        .then((payload) => {
          if (!payload || !payload.ok) return undefined
          const current = payload.text || ''
          let next
          if (current.includes(AUTO_START) && current.includes(AUTO_END)) {
            const from = current.indexOf(AUTO_START) + AUTO_START.length
            const to = current.indexOf(AUTO_END)
            const items = current
              .slice(from, to)
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line.startsWith('- ') && line !== entry)
            const merged = [entry, ...items].slice(0, AUTO_MAX_ITEMS)
            next = current.slice(0, from) + '\n' + merged.join('\n') + '\n' + current.slice(to)
          } else {
            next = current + '\n\n' + AUTO_START + '\n## 自动累积（最新在前，由 dsh-loupe 维护）\n' +
              '<!-- 以下条目来自历史解释，可能带有当时的对话上下文，仅供参考；与上方手写内容冲突时以手写内容为准。 -->\n' +
              entry + '\n' + AUTO_END + '\n'
          }
          return fetch(`${ROUTE}/context`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: next }),
          })
        })
        .catch(() => {
          /* 累积失败不影响解释本身 */
        })
    }

    /**
     * 尽力猜出当前会话的工作目录，供「保存」建会话时使用。
     *
     * 只能从 DOM 上找线索（宿主没有把 cwd 暴露给插件），所以做成多候选：
     * 每个候选都按「属性 → 正则抓 Windows 路径」两步走，全都落空就返回
     * undefined —— 那时会话会落到 _no-cwd，功能照常，只是分组不好看。
     */
    function guessCwd() {
      const probes = [
        ['button[aria-label*="工作目录"]', ['title', 'data-path', 'aria-label']],
        ['button[title*="工作目录"]', ['title', 'data-path']],
        ['[data-conversation-header-corner] [data-path]', ['data-path']],
        ['[data-path][aria-current="true"]', ['data-path']],
        ['[data-path][data-current]', ['data-path']],
      ]
      for (const [selector, attrs] of probes) {
        let node = null
        try {
          node = document.querySelector(selector)
        } catch {
          continue
        }
        if (node === null) continue
        for (const attr of attrs) {
          const raw = node.getAttribute(attr)
          if (typeof raw !== 'string' || raw.length === 0) continue
          const match = raw.match(/[A-Za-z]:\\[^"'<>\n]+/)
          if (match !== null) return match[0].replace(/[\\/]+$/, '')
        }
      }
      return undefined
    }

    /** 参数页。默认值刻意偏「快」：解释不需要高推理，也不需要把整段对话塞进去。 */
    function renderParams(body) {
      const current = settings()
      const rows = [
        {
          key: 'reasoningEffort',
          label: '推理档',
          hint: '实测同一问题：off 首字 544ms，low 2806ms（约 5 倍）。解释单段文字建议 off；觉得答得浅再调到 low。DeepSeek 只认 off / low / high / max。',
          values: ['off', 'low', 'high', 'max'],
          fallback: 'off',
          numeric: false,
        },
        {
          key: 'neighborCount',
          label: '邻域条数',
          hint: '选区前后各带几条对话进 prompt。0 = 只带选区所在的那条消息，最快最省；觉得答不准再往上调。',
          values: ['0', '1', '2', '4'],
          fallback: '0',
          numeric: true,
        },
        {
          key: 'accumulate',
          label: '自动累积',
          hint: '每次解释后把「选区 → 结论摘要」沉淀进 context.md，下次遇到同样的词更快更准。写入受控区块，不会碰你手写的内容。',
          values: ['on', 'off'],
          fallback: 'on',
          numeric: false,
        },
        {
          key: 'contextChars',
          label: '插件上下文上限（字符）',
          hint: 'context.md 注入的长度上限。它放在 prompt 的稳定前缀里，可命中宿主缓存。',
          values: ['800', '2200', '4000', '8000'],
          fallback: '2200',
          numeric: true,
        },
      ]
      const status = el('div', 'loupe-note', '改动即时生效，下一次解释就用新参数。')
      body.appendChild(status)
      for (const row of rows) {
        const wrap = el('div', 'loupe-param')
        wrap.appendChild(el('div', 'loupe-param-label', row.label))
        const select = document.createElement('select')
        select.className = 'loupe-select'
        const active = String(current[row.key] === undefined ? row.fallback : current[row.key])
        for (const value of row.values) {
          const option = document.createElement('option')
          option.value = value
          option.textContent = value
          if (value === active) option.selected = true
          select.appendChild(option)
        }
        select.addEventListener('change', () => {
          saveSetting(row.key, row.numeric ? Number(select.value) : select.value)
          status.textContent = row.label + ' 已设为 ' + select.value
        })
        wrap.appendChild(select)
        wrap.appendChild(el('div', 'loupe-param-hint', row.hint))
        body.appendChild(wrap)
      }
    }

    /** 历史页：所有问过的问题，点任意一条即可在浮窗里继续。 */
    function renderHistory(body) {
      const status = el('div', 'loupe-note', '正在读取历史…')
      body.appendChild(status)
      const list = el('div', 'loupe-hist')
      body.appendChild(list)
      fetch(`${ROUTE}/history?limit=200`)
        .then((r) => r.json())
        .then((payload) => {
          if (!payload.ok) throw new Error(payload.error || 'read failed')
          const items = payload.items || []
          status.textContent = items.length === 0
            ? '还没有历史记录——问过一次之后就会出现在这里。'
            : `共 ${payload.total} 条，显示最近 ${items.length} 条 · 点击任意一条可在浮窗里继续`
          for (const item of items) list.appendChild(historyRow(item))
        })
        .catch((error) => {
          status.textContent = `读取历史失败：${error && error.message ? error.message : error}`
        })
    }

    function historyRow(item) {
      const row = el('div', 'loupe-hist-item')
      const head = el('div', 'loupe-hist-head')
      if (item.at) {
        const when = new Date(item.at)
        const hh = String(when.getHours()).padStart(2, '0')
        const mm = String(when.getMinutes()).padStart(2, '0')
        head.appendChild(el('span', 'loupe-hist-time', `${when.getMonth() + 1}/${when.getDate()} ${hh}:${mm}`))
      }
      if (item.selection) head.appendChild(el('span', 'loupe-hist-sel', item.selection.slice(0, 48)))
      row.appendChild(head)
      if (item.question) row.appendChild(el('div', 'loupe-hist-q', item.question.slice(0, 90)))
      const meta = [
        item.answerChars ? item.answerChars + ' 字' : '',
        item.firstDeltaMs == null ? '' : '首字 ' + item.firstDeltaMs + 'ms',
        item.model || '',
        item.ok === false ? '失败' : '',
      ].filter(Boolean).join(' · ')
      if (meta) row.appendChild(el('div', 'loupe-hist-meta', meta))
      row.addEventListener('click', () => restoreFromHistory(item))
      return row
    }

    /**
     * 把一条历史恢复到浮窗：引用条 + 已有的一问一答，光标落回输入框，可继续追问。
     * 历史条目没有 live 选区，所以 currentSelection 用选区文字本身重建，
     * 且不带 node/flow —— 下游取「所在消息」时必须容忍这种形态。
     */
    function restoreFromHistory(item) {
      const settingsWin = document.querySelector('[data-dsh-loupe="settings"]')
      if (settingsWin) settingsWin.remove()
      currentSelection = {
        text: item.selection || '',
        rect: null,
        node: null,
        flow: null,
        restored: true,
      }
      const w = ensureWindow()
      const parts = w.__loupe
      parts.back.style.display = ''
      parts.quote.textContent = currentSelection.text
      parts.quote.style.display = currentSelection.text ? '' : 'none'
      parts.body.textContent = ''
      const turn = el('div', 'loupe-turn')
      if (item.question) turn.appendChild(el('div', 'loupe-q', item.question))
      const a = el('div', 'loupe-a')
      const view = createAnswerView(a)
      view.push(item.answer || '')
      view.finish()
      turn.appendChild(a)
      if (item.ok === false && item.error) turn.appendChild(el('div', 'loupe-err', item.error))
      parts.body.appendChild(turn)
      parts.input.value = ''
      parts.input.focus()
      if (!w.style.left) {
        w.style.left = '24px'
        w.style.top = '80px'
      }
    }

    /**
     * 上下文页（M2）：编辑 `<DSH home>/loupe/context.md`。
     * 这段文字会被注入每一次解释请求，且放在 prompt 的稳定前缀里（吃宿主缓存），
     * 所以它既影响准确度也影响速度——上限 64 KB 由 host 侧把关。
     */
    function renderContext(body) {
      const status = el('div', 'loupe-note', '正在读取插件上下文…')
      body.appendChild(status)
      const editor = el('textarea', 'loupe-editor')
      editor.setAttribute('data-loupe', 'context')
      editor.placeholder = '例如：\n- 术语：本项目里「挂件」= 侧边栏小组件\n- 风格：先给结论，再给理由，不要客套\n- 一律用中文回答，代码与专有名词保留原文'
      body.appendChild(editor)
      const actions = el('div', 'loupe-actions')
      const saveBtn = el('button', 'loupe-send', '保存')
      saveBtn.disabled = true
      const hint = el('span', 'loupe-note', '')
      actions.appendChild(saveBtn)
      actions.appendChild(hint)
      body.appendChild(actions)
      const help = el('div', 'loupe-note',
        '这段文字作为「参考」注入每次解释（放在稳定前缀里，可命中宿主 prompt 缓存）。写术语表、风格要求，或你希望一律遵守的约定。留空也能正常用。')
      body.appendChild(help)

      fetch(`${ROUTE}/context`)
        .then((r) => r.json())
        .then((payload) => {
          if (!payload.ok) throw new Error(payload.error || 'read failed')
          editor.value = payload.text || ''
          status.textContent = payload.exists
            ? `已加载 ${payload.chars} 字 · ${payload.file}`
            : '还没有上下文文件——写点什么再保存，它会被创建。'
          saveBtn.disabled = false
        })
        .catch((error) => {
          status.textContent = `读取失败：${error && error.message ? error.message : error}`
        })

      saveBtn.addEventListener('click', () => {
        saveBtn.disabled = true
        hint.textContent = '正在保存…'
        fetch(`${ROUTE}/context`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: editor.value }),
        })
          .then((r) => r.json())
          .then((payload) => {
            if (!payload.ok) throw new Error(payload.error || 'write failed')
            hint.textContent = payload.truncated
              ? `已保存（超出上限，截断到 ${payload.chars} 字）`
              : `已保存 ${payload.chars} 字`
            saveBtn.disabled = false
          })
          .catch((error) => {
            hint.textContent = `保存失败：${error && error.message ? error.message : error}`
            saveBtn.disabled = false
          })
      })
    }

    // ── wiring ───────────────────────────────────────────────────────────────

    function onMouseUp() {
      // Let the browser finish updating the selection first.
      setTimeout(() => {
        if (bar && bar.contains(document.activeElement)) return
        const selection = readSelection()
        if (!selection) {
          hideBar()
          return
        }
        showBar(selection)
      }, 0)
    }

    function onMouseDown(e) {
      if (bar && bar.contains(e.target)) return
      if (win && win.contains(e.target)) return
      hideBar()
    }

    function onScroll() {
      hideBar()
    }

    function apply(ctx) {
      clientCtx = ctx
      const style = document.createElement('style')
      style.setAttribute('data-dsh-loupe', 'style')
      style.textContent = CSS
      document.head.appendChild(style)

      document.addEventListener('mouseup', onMouseUp, true)
      document.addEventListener('mousedown', onMouseDown, true)
      window.addEventListener('scroll', onScroll, true)
      window.addEventListener('resize', hideBar)

      disposers.push(() => {
        document.removeEventListener('mouseup', onMouseUp, true)
        document.removeEventListener('mousedown', onMouseDown, true)
        window.removeEventListener('scroll', onScroll, true)
        window.removeEventListener('resize', hideBar)
      })

      const cleanup = () => {
        for (const fn of disposers.splice(0)) {
          try {
            fn()
          } catch {
            /* ignore */
          }
        }
        hideBar()
        closeWindow()
        style.remove()
      }

      if (ctx && typeof ctx.effect === 'function') ctx.effect(() => cleanup)
    }

    exports.apply = apply
    return module.exports
  },
})
