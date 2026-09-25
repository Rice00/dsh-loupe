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
    /** Markdown chrome copy for the host renderer — localized per render. */
    function mdLabels() {
      return { code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }
    }

    // ── i18n ─────────────────────────────────────────────────────────────────
    /**
     * 界面语言：auto / zh / en，与其它参数同一个 localStorage。
     *
     * auto 的解析顺序是「宿主页面声明的 lang → 浏览器语言」，解析结果与来源
     * 会原样显示在诊断页 —— 不猜，让用户看得见它选中了什么。
     * 语言只覆盖界面文案与提示词；命令、路径、路由名、参数值一律不翻译。
     */
    const MESSAGES = {
      zh: {
        copy: '复制', copied: '已复制', footnotes: '脚注',
        explain: '解释', settings: '设置', settingsTip: 'loupe 设置与诊断',
        backTip: '返回历史列表', winTitle: 'LOUPE · 划词解释', save: '保存',
        saveTip: '把这段对话保存成左侧列表里的正式会话', closeTip: '关闭（历史会保留）',
        send: '发送', defaultQuestion: '请解释下面这段内容。',
        noTurns: '没有可保存的对话', transcriptHead: '【保存自 dsh-loupe 的划词对话】',
        transcriptSel: '选中文字：', transcriptQ: '问：', transcriptA: '答：',
        transcriptTail: '—— 以上是保存时的上下文，请在此基础上继续。', titlePrefix: '划词 · ',
        pickerTitle: '保存到哪个工作区？', pickerNone: '不指定（未分组）',
        pickerNoWs: '（宿主没有报告任何工作区）', confirm: '确定', cancel: '取消',
        saveEmpty: '保存失败：没有可保存的内容（内部错误）', saving: '保存中…', saved: '已保存',
        saveFailed: '保存失败：', notAddressable: '新会话尚不可寻址', ungrouped: '未分组',
        savedFallback: (v) => '已创建会话 ' + v.id + '…（客户端会话服务不可用）',
        savedTo: (v) => '已保存到「' + v.where + '」（' + v.id + '…），模型会先接一句。',
        renamed: (v) => '会话标题已设为「' + v.title + '」',
        generating: '正在生成…', thinking: '模型思考中…', thinkingTitle: '推理过程',
        inject: (v) => v.model + ' · ' + v.effort + ' · 注入 选区' + v.sel + '字 所在消息' + v.msg + '字 插件上下文' + v.ctx + '字',
        emptyAnswer: (v) => '模型这次没有返回内容（' + v.ms + 'ms）——按回车可重试。',
        doneLine: (v) => v.chars + ' 字 · 首字 ' + v.first + ' · 共 ' + v.ms + 'ms',
        requestFailed: '请求失败：', streamBroken: '流中断：',
        settingsTitle: 'LOUPE · 历史 / 参数 / 上下文 / 诊断',
        tabHistory: '历史', tabParams: '参数', tabContext: '上下文', tabProbe: '诊断', close: '关闭',
        probeWs: '工作区探测：', probeDrag: '拖动事件计数：', probeDragTip: ' · 最近一次按下的元素：',
        probeNone: '(无)', probeLoading: '正在读取宿主诊断…', probeFailed: '诊断请求失败：',
        probeTheme: '主题：', probeTokens: '宿主设计令牌：', probeLang: '界面语言：',
        probeHtmlLang: (v) => '宿主页面 lang="' + v + '"（模板固定值，不参与判断）',
        probeTokensYes: '可用', probeTokensNo: '不可用（按系统深浅兜底）',
        paramsNote: '改动即时生效，下一次解释就用新参数。',
        paramSet: (v) => v.label + ' 已设为 ' + v.value,
        pEffort: '推理档',
        pEffortHint: '实测同一问题：off 首字 544ms，low 2806ms（约 5 倍）。解释单段文字建议 off；觉得答得浅再调到 low。DeepSeek 只认 off / low / high / max。',
        pNeighbor: '邻域条数',
        pNeighborHint: '选区前后各带几条对话进 prompt。0 = 只带选区所在的那条消息，最快最省；觉得答不准再往上调。',
        pGlass: '玻璃质感',
        pGlassHint: '浮窗与浮标的半透明 + 背景模糊。关掉即用实底（拖动时更跟手）。仅在浏览器支持 color-mix 时生效。',
        pAccumulate: '自动累积',
        pAccumulateHint: '每次解释后把「选区 → 结论摘要」沉淀进 context.md，下次遇到同样的词更快更准。写入受控区块，不会碰你手写的内容。',
        pContextChars: '插件上下文上限（字符）',
        pContextCharsHint: 'context.md 注入的长度上限。它放在 prompt 的稳定前缀里，可命中宿主缓存。',
        pLang: '界面语言',
        pLangHint: 'auto 先跟随宿主界面语言，再退到浏览器语言。只翻译界面与提示词；命令、路径、参数值不翻译。',
        pTheme: '主题',
        pThemeHint: '界面跟随宿主的深浅主题与皮肤；宿主没提供设计令牌时按系统深浅兜底。',
        langAuto: '自动（跟随宿主 / 浏览器）',
        themeLight: '浅色', themeDark: '深色',
        histLoading: '正在读取历史…', histEmpty: '还没有历史记录——问过一次之后就会出现在这里。',
        histCount: (v) => '共 ' + v.total + ' 条，显示 ' + v.shown + ' 条' + (v.matched === null ? '' : '，匹配 ' + v.matched + ' 条') + ' · 点击任意一条可在浮窗里继续',
        histSearch: '搜索划选内容、问题或答案', histMore: '加载更多', histNoMatch: '没有匹配的记录',
        histFailed: '读取历史失败：', histFail: '失败',
        histChars: (v) => v.n + ' 字', histFirst: (v) => '首字 ' + v.ms + 'ms',
        ctxLoading: '正在读取插件上下文…',
        ctxPlaceholder: '例如：\n- 术语：本项目里「挂件」= 侧边栏小组件\n- 风格：先给结论，再给理由，不要客套\n- 一律用中文回答，代码与专有名词保留原文',
        ctxHelp: '这段文字作为「参考」注入每次解释（放在稳定前缀里，可命中宿主 prompt 缓存）。写术语表、风格要求，或你希望一律遵守的约定。留空也能正常用。',
        ctxLoaded: (v) => '已加载 ' + v.chars + ' 字 · ' + v.file,
        ctxMissing: '还没有上下文文件——写点什么再保存，它会被创建。',
        ctxReadFailed: '读取失败：', ctxSaving: '正在保存…',
        ctxSavedTrunc: (v) => '已保存（超出上限，截断到 ' + v.chars + ' 字）',
        ctxSaved: (v) => '已保存 ' + v.chars + ' 字', ctxSaveFailed: '保存失败：',
        autoHeading: '## 自动累积（最新在前，由 dsh-loupe 维护）',
        autoNote: '<!-- 以下条目来自历史解释，可能带有当时的对话上下文，仅供参考；与上方手写内容冲突时以手写内容为准。 -->',
        autoEntry: (v) => '- 「' + v.sel + '」→ ' + v.summary,
        probeNever: '尚未探测',
        probeNoService: 'workspaces 服务不可用',
        probeWorkspaces: (v) => v.n + ' 个工作区（来源 ' + v.source + '）',
        probeNoSnapshot: '服务在，但 getSnapshot 拿不到 items',
        probeError: (v) => '探测异常：' + v.msg,
      },
      en: {
        copy: 'Copy', copied: 'Copied', footnotes: 'Footnotes',
        explain: 'Explain', settings: 'Settings', settingsTip: 'loupe settings & diagnostics',
        backTip: 'Back to history', winTitle: 'LOUPE · selection explain', save: 'Save',
        saveTip: 'Save this conversation as a real session in the sidebar', closeTip: 'Close (history is kept)',
        send: 'Send', defaultQuestion: 'Explain the text below.',
        noTurns: 'Nothing to save', transcriptHead: '[Selection conversation saved from dsh-loupe]',
        transcriptSel: 'Selected text: ', transcriptQ: 'Q: ', transcriptA: 'A: ',
        transcriptTail: '— The above is the context at save time; please continue from here.', titlePrefix: 'Selection · ',
        pickerTitle: 'Save to which workspace?', pickerNone: 'No workspace (ungrouped)',
        pickerNoWs: '(the host reported no workspaces)', confirm: 'OK', cancel: 'Cancel',
        saveEmpty: 'Save failed: nothing to save (internal error)', saving: 'Saving…', saved: 'Saved',
        saveFailed: 'Save failed: ', notAddressable: 'The new session is not addressable yet', ungrouped: 'Ungrouped',
        savedFallback: (v) => 'Created session ' + v.id + '… (client session service unavailable)',
        savedTo: (v) => 'Saved to "' + v.where + '" (' + v.id + '…); the model will take it from there.',
        renamed: (v) => 'Session title set to "' + v.title + '"',
        generating: 'Generating…', thinking: 'Model is thinking…', thinkingTitle: 'Reasoning',
        inject: (v) => v.model + ' · ' + v.effort + ' · injected: selection ' + v.sel + ' ch, message ' + v.msg + ' ch, context ' + v.ctx + ' ch',
        emptyAnswer: (v) => 'The model returned nothing (' + v.ms + 'ms) — press Enter to retry.',
        doneLine: (v) => v.chars + ' chars · first ' + v.first + ' · total ' + v.ms + 'ms',
        requestFailed: 'Request failed: ', streamBroken: 'Stream interrupted: ',
        settingsTitle: 'LOUPE · history / params / context / diagnostics',
        tabHistory: 'History', tabParams: 'Params', tabContext: 'Context', tabProbe: 'Diagnostics', close: 'Close',
        probeWs: 'Workspace probe: ', probeDrag: 'Drag events: ', probeDragTip: ' · last pointerdown target: ',
        probeNone: '(none)', probeLoading: 'Reading host diagnostics…', probeFailed: 'Diagnostics request failed: ',
        probeTheme: 'Theme: ', probeTokens: 'Host design tokens: ', probeLang: 'Language: ',
        probeHtmlLang: (v) => 'host page lang="' + v + '" (static template value, never used for detection)',
        probeTokensYes: 'available', probeTokensNo: 'unavailable (falling back to the OS preference)',
        paramsNote: 'Changes apply immediately — the next explanation uses them.',
        paramSet: (v) => v.label + ' set to ' + v.value,
        pEffort: 'Reasoning effort',
        pEffortHint: 'Measured on the same question: off 544ms to first token, low 2806ms (≈5x). off is recommended for a single passage; raise it if answers feel shallow. DeepSeek accepts off / low / high / max only.',
        pNeighbor: 'Neighbour turns',
        pNeighborHint: 'How many turns before and after the selection go into the prompt. 0 = only the message holding the selection (fastest, cheapest).',
        pGlass: 'Glass effect',
        pGlassHint: 'Translucent + blurred floating surfaces. Off switches to solid (dragging feels more direct). Only applies when the browser supports color-mix.',
        pAccumulate: 'Auto-accumulate',
        pAccumulateHint: 'After each explanation, distil "selection → conclusion" into context.md so the same term is answered better next time. Written to a fenced block; your hand-written text is never touched.',
        pContextChars: 'Plugin context limit (chars)',
        pContextCharsHint: 'How much of context.md is injected. It sits in the stable prefix, so it can hit the host prompt cache.',
        pLang: 'Language',
        pLangHint: 'auto follows the host interface language, then the browser language. Only the interface and the prompt are translated; commands, paths and parameter values are not.',
        pTheme: 'Theme',
        pThemeHint: 'The interface follows the host light/dark theme and skin; when the host provides no design tokens it falls back to the OS preference.',
        langAuto: 'Auto (host / browser)',
        themeLight: 'light', themeDark: 'dark',
        histLoading: 'Loading history…', histEmpty: 'No history yet — your first question will show up here.',
        histCount: (v) => v.total + ' total, showing ' + v.shown + (v.matched === null ? '' : ', ' + v.matched + ' matched') + ' · click any row to continue in the floating window',
        histSearch: 'Search selection, question or answer', histMore: 'Load more', histNoMatch: 'No matching records',
        histFailed: 'Failed to read history: ', histFail: 'failed',
        histChars: (v) => v.n + ' chars', histFirst: (v) => 'first ' + v.ms + 'ms',
        ctxLoading: 'Loading plugin context…',
        ctxPlaceholder: 'e.g.\n- Terms: in this project "widget" = the sidebar component\n- Style: conclusion first, then reasons, no pleasantries\n- Answer in English; keep code and proper nouns as-is',
        ctxHelp: 'Injected as reference into every explanation (in the stable prefix, so it can hit the host prompt cache). Use it for a glossary, style requirements, or any convention you want followed. Empty works fine.',
        ctxLoaded: (v) => 'Loaded ' + v.chars + ' chars · ' + v.file,
        ctxMissing: 'No context file yet — write something and save; it will be created.',
        ctxReadFailed: 'Read failed: ', ctxSaving: 'Saving…',
        ctxSavedTrunc: (v) => 'Saved (over the limit, truncated to ' + v.chars + ' chars)',
        ctxSaved: (v) => 'Saved ' + v.chars + ' chars', ctxSaveFailed: 'Save failed: ',
        autoHeading: '## Auto-accumulated (newest first, maintained by dsh-loupe)',
        autoNote: '<!-- Entries below come from past explanations and may carry the conversation context of that time; treat them as reference only. Hand-written text above wins on conflict. -->',
        autoEntry: (v) => '- "' + v.sel + '" → ' + v.summary,
        probeNever: 'not probed yet',
        probeNoService: 'workspaces service unavailable',
        probeWorkspaces: (v) => v.n + ' workspaces (source ' + v.source + ')',
        probeNoSnapshot: 'service present, but getSnapshot returned no items',
        probeError: (v) => 'probe failed: ' + v.msg,
      },
    }

    let LANG = 'zh'

    // 宿主自己的界面语言偏好（宿主 settings 的 locale.preference）。
    // 宿主没有这个偏好时，它自己的界面语言也委托给浏览器语言 —— 本插件照做。
    let hostLocalePreference = null

    /**
     * **不要读 `document.documentElement.lang`**：宿主前端的 index.html 把它
     * 写死成 "en"（@deepseek-ai/dsh-web-frontend/dist/index.html 第 2 行），
     * 与用户实际看到的界面语言无关。2026-09-25 我正是踩了这个坑 —— 插件在
     * 中文宿主上显示成了英文。判断语言只认下面三级。
     */
    function langProbe(value) {
      const probe = String(value || '').trim().toLowerCase()
      if (probe.indexOf('zh') === 0) return 'zh'
      if (probe.indexOf('en') === 0) return 'en'
      return ''
    }

    /** 显式设置 → 宿主 locale.preference → 浏览器语言 → zh。 */
    function detectLang() {
      const pref = settings().lang
      if (pref === 'zh' || pref === 'en') return pref
      const fromHost = langProbe(hostLocalePreference)
      if (fromHost) return fromHost
      return langProbe(navigator.language) || 'zh'
    }

    /** 诊断页用：当前语言到底是谁定的，`auto` 不该是黑盒。 */
    function langSource() {
      const pref = settings().lang
      if (pref === 'zh' || pref === 'en') return 'setting=' + pref
      if (langProbe(hostLocalePreference)) return 'host locale.preference=' + hostLocalePreference
      return 'navigator.language=' + ((navigator.language || '').trim() || '?')
    }

    /**
     * 向宿主问一次语言偏好（`/locale`）。宿主没有偏好就保持浏览器语言判断。
     * 拿到不同结果时才重绘，所以启动期不会闪 —— 而且这是**纠正**：宿主说了算。
     */
    function syncHostLocale() {
      fetch(`${ROUTE}/locale`)
        .then((r) => r.json())
        .then((payload) => {
          if (!payload || !payload.ok) return
          hostLocalePreference = langProbe(payload.preference) || null
          const before = LANG
          refreshLang()
          if (LANG === before) return
          applyScheme()
          refreshWindowLabels()
          const panel = document.querySelector('[data-dsh-loupe="settings"]')
          if (panel) reopenSettings(panel.getAttribute('data-loupe-active') || 'history')
        })
        .catch(() => {
          /* 宿主不可达：保持浏览器语言判断 */
        })
    }

    function refreshLang() {
      LANG = detectLang()
      return LANG
    }

    /** Look one key up in the active language, falling back to zh, then the key. */
    function t(key, arg) {
      const table = MESSAGES[LANG] || MESSAGES.zh
      let entry = table[key]
      if (entry === undefined) entry = MESSAGES.zh[key]
      if (typeof entry === 'function') return entry(arg)
      return entry === undefined ? key : entry
    }

    // ── theme ────────────────────────────────────────────────────────────────
    /**
     * 深浅：先读宿主在根元素上声明的 color-scheme（宿主自己的主题决定），
     * 宿主没声明时才跟随系统偏好。结果写成 data-loupe-scheme 属性，CSS 的
     * 适配层据此挑兜底色 —— 宿主给了设计令牌时令牌永远胜出，这个属性只保证
     * 「没有令牌」的环境不出现白底黑字压在深色页面上。
     */
    function themeScheme() {
      try {
        const declared = String(getComputedStyle(document.documentElement).colorScheme || '').toLowerCase()
        const hasDark = declared.indexOf('dark') >= 0
        const hasLight = declared.indexOf('light') >= 0
        if (hasDark && !hasLight) return 'dark'
        if (hasLight && !hasDark) return 'light'
      } catch {
        /* 读不到就当宿主没声明 */
      }
      return isDark() ? 'dark' : 'light'
    }

    /** 是否拿到了宿主的设计令牌（诊断页展示，主题适配是否生效一看便知）。 */
    function hostTokensAvailable() {
      try {
        const value = getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-bg-base')
        return typeof value === 'string' && value.trim().length > 0
      } catch {
        return false
      }
    }

    function applyScheme() {
      const scheme = themeScheme()
      for (const node of document.querySelectorAll('[data-dsh-loupe]')) {
        if (node.getAttribute('data-dsh-loupe') === 'style') continue
        node.setAttribute('data-loupe-scheme', scheme)
      }
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
    /* 视觉：玻璃浮层（方案 C）。
       全部走 DSH 设计令牌 —— 于是自动跟随深浅主题与皮肤，不再需要 .dark 覆盖，
       也不再写死任何品牌色。每个 var() 都带兜底值：令牌缺失时至少还是可读的中性灰。 */
    /* ── 主题适配层 ─────────────────────────────────────────────────────────
       每个表面都经 --loupe-* 中转，而不是直接写死令牌+兜底值：
         取值优先宿主设计令牌（--dsw-*），令牌缺失时才用兜底；
         兜底分深浅两套，由 data-loupe-scheme 属性选择（JS 解析：宿主声明的
         color-scheme 优先，宿主没声明时才跟随系统偏好）。
       于是三种情况都成立：
         浅色宿主 + 深色系统 → 用宿主的令牌，仍是浅色（令牌永远胜出）；
         深色宿主 + 浅色系统 → 同上，仍是深色；
         宿主没给令牌（旧宿主/独立承载）→ 按深浅兜底，不会白底黑字糊在深色页上。
       color-scheme 一并带上，让 select / textarea / 滚动条这些原生控件也跟随。 */
    .loupe-bar,.loupe-win{
      --loupe-surface:var(--dsw-alias-bg-base,#fff);
      --loupe-menu:var(--dsw-specific-menu,var(--dsw-alias-bg-base,#fff));
      --loupe-input:var(--dsw-specific-input-major,#fff);
      --loupe-layer:var(--dsw-alias-bg-layer-1,rgba(20,28,48,.03));
      --loupe-line:var(--dsw-alias-border-l2,rgba(20,28,48,.10));
      --loupe-line-strong:var(--dsw-alias-border-l2,rgba(20,28,48,.14));
      --loupe-line1:var(--dsw-alias-border-l1,rgba(20,28,48,.07));
      --loupe-hover:var(--dsw-alias-interactive-bg-hover,rgba(20,28,48,.06));
      --loupe-fg:var(--dsw-alias-label-primary,#1b1f27);
      --loupe-fg2:var(--dsw-alias-label-secondary,#4b5566);
      --loupe-fg3:var(--dsw-alias-label-tertiary,#8a93a3);
      --loupe-fg4:var(--dsw-alias-label-caption,#8a93a3);
      --loupe-accent:var(--dsw-alias-button-info-fill,#3b6fd4);
      --loupe-accent-soft:var(--dsw-alias-button-info-fill,rgba(59,111,212,.4));
      --loupe-accent-hover:var(--dsw-alias-button-info-hover,var(--dsw-alias-button-info-fill,#3b6fd4));
      --loupe-on-accent:var(--dsw-alias-label-primary-inverted,#fff);
      --loupe-error:var(--dsw-alias-state-error-primary,#c0392b);
      --loupe-shadow:var(--dsw-elevation-prominent,0 10px 28px rgba(20,28,48,.16));
      --loupe-shadow-panel:var(--dsw-elevation-panel,0 22px 56px rgba(20,28,48,.20));
      --loupe-font:var(--dsw-font-family,"Segoe UI","Microsoft YaHei",system-ui,sans-serif);
      color-scheme:light}
    .loupe-bar[data-loupe-scheme="dark"],.loupe-win[data-loupe-scheme="dark"]{
      --loupe-surface:var(--dsw-alias-bg-base,#1a1b1f);
      --loupe-menu:var(--dsw-specific-menu,var(--dsw-alias-bg-base,#232429));
      --loupe-input:var(--dsw-specific-input-major,#232429);
      --loupe-layer:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.05));
      --loupe-line:var(--dsw-alias-border-l2,rgba(255,255,255,.14));
      --loupe-line-strong:var(--dsw-alias-border-l2,rgba(255,255,255,.20));
      --loupe-line1:var(--dsw-alias-border-l1,rgba(255,255,255,.09));
      --loupe-hover:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));
      --loupe-fg:var(--dsw-alias-label-primary,#e8eaee);
      --loupe-fg2:var(--dsw-alias-label-secondary,#b3b9c4);
      --loupe-fg3:var(--dsw-alias-label-tertiary,#8b929e);
      --loupe-fg4:var(--dsw-alias-label-caption,#8b929e);
      --loupe-accent:var(--dsw-alias-button-info-fill,#5b8bdd);
      --loupe-accent-soft:var(--dsw-alias-button-info-fill,rgba(91,139,221,.45));
      --loupe-accent-hover:var(--dsw-alias-button-info-hover,var(--dsw-alias-button-info-fill,#6f9ae5));
      --loupe-error:var(--dsw-alias-state-error-primary,#ff6b5e);
      --loupe-shadow:var(--dsw-elevation-prominent,0 10px 28px rgba(0,0,0,.45));
      --loupe-shadow-panel:var(--dsw-elevation-panel,0 22px 56px rgba(0,0,0,.55));
      color-scheme:dark}
    .loupe-bar{position:fixed;z-index:${Z_BAR};display:flex;gap:2px;padding:4px;border-radius:999px;
      background:var(--loupe-menu);
      border:1px solid var(--loupe-line);
      box-shadow:var(--loupe-shadow);
      font:13px/1.4 var(--loupe-font);
      color:var(--loupe-fg)}
    .loupe-bar button{all:unset;cursor:pointer;padding:4px 12px;border-radius:999px;white-space:nowrap;
      color:var(--loupe-fg2)}
    .loupe-bar button:hover{background:var(--loupe-hover)}
    .loupe-bar button.on{color:var(--loupe-accent);font-weight:600}
    .loupe-bar .sep{width:1px;margin:3px 2px;background:var(--loupe-line)}
    .loupe-win{position:fixed;z-index:${Z_WIN};width:420px;max-width:calc(100vw - 24px);display:flex;flex-direction:column;
      border-radius:14px;overflow:hidden;
      background:var(--loupe-surface);
      color:var(--loupe-fg);
      border:1px solid var(--loupe-line);
      box-shadow:var(--loupe-shadow-panel);
      font:14px/1.7 var(--loupe-font)}
    .loupe-head{display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:move;touch-action:none;
      user-select:none;-webkit-user-select:none;
      border-bottom:1px solid var(--loupe-line)}
    .loupe-title{flex:1;font-size:12px;font-weight:600;letter-spacing:.16em;
      color:var(--loupe-fg2)}
    .loupe-head button{all:unset;cursor:pointer;padding:2px 8px;border-radius:8px;font-size:13px;
      color:var(--loupe-fg3)}
    .loupe-head button:hover{background:var(--loupe-hover)}
    .loupe-body{max-height:46vh;overflow:auto;padding:13px 14px}
    .loupe-quote{margin:13px 14px 0;padding:8px 11px;font-size:13px;max-height:72px;overflow:auto;white-space:pre-wrap;
      border-left:2px solid var(--loupe-accent);
      background:var(--loupe-layer);
      border-radius:0 8px 8px 0;color:var(--loupe-fg2)}
    .loupe-turn{margin-bottom:14px}
    .loupe-q{font-size:13px;color:var(--loupe-fg3);margin-bottom:5px}
    .loupe-a{word-break:break-word;font-size:15px;line-height:1.8}
    .loupe-a.plain{white-space:pre-wrap}
    .loupe-note{font-size:11.5px;color:var(--loupe-fg4);margin-top:6px}
    .loupe-err{color:var(--loupe-error);font-size:12.5px;white-space:pre-wrap}
    .loupe-foot{display:flex;gap:10px;align-items:flex-end;padding:12px 14px;
      border-top:1px solid var(--loupe-line)}
    .loupe-input{flex:1;resize:none;min-height:34px;max-height:110px;padding:8px 10px;border-radius:10px;box-sizing:border-box;
      border:1px solid var(--loupe-line);
      background:var(--loupe-input);
      color:var(--loupe-fg);
      font:13px/1.5 inherit}
    .loupe-send{all:unset;cursor:pointer;padding:8px 16px;border-radius:10px;font-size:13px;
      background:var(--loupe-accent);
      color:var(--loupe-on-accent)}
    .loupe-send:hover{background:var(--loupe-accent-hover)}
    .loupe-send[disabled]{opacity:.5;cursor:default}
    .loupe-send.settings{background:transparent;color:inherit;box-shadow:inset 0 0 0 1px var(--loupe-line-strong)}
    .loupe-ghost{background:transparent;color:var(--loupe-fg2);
      box-shadow:inset 0 0 0 1px var(--loupe-line-strong)}
    .loupe-probe{font:11.5px/1.6 Consolas,ui-monospace,monospace;
      white-space:pre-wrap;word-break:break-all;color:var(--loupe-fg2)}
    .loupe-spin{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;
      background:var(--loupe-accent);opacity:.6}
    .loupe-tabs{display:flex;gap:2px;padding:0 12px;
      border-bottom:1px solid var(--loupe-line)}
    .loupe-tab{all:unset;cursor:pointer;padding:9px 11px;font-size:13px;border-radius:8px 8px 0 0;
      color:var(--loupe-fg3)}
    .loupe-tab.on{color:var(--loupe-accent);font-weight:600;
      box-shadow:inset 0 -2px 0 var(--loupe-accent)}
    .loupe-hist{display:flex;flex-direction:column;gap:2px;margin-top:10px}
    .loupe-hist-item{padding:9px 10px;border-radius:10px;cursor:pointer;border:1px solid transparent}
    .loupe-hist-item:hover{background:var(--loupe-hover);
      border-color:var(--loupe-line)}
    .loupe-hist-head{display:flex;gap:8px;align-items:center;font-size:11.5px;
      color:var(--loupe-fg4)}
    .loupe-hist-time{flex:none;font-size:11.5px;font-weight:600;letter-spacing:.02em;padding:2px 8px;border-radius:999px;
      background:var(--loupe-hover);
      color:var(--loupe-fg2)}
    .loupe-hist-sel{font-size:14px;font-weight:600;margin-top:3px;color:var(--loupe-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .loupe-hist-meta{font-size:11.5px;margin-top:3px;color:var(--loupe-fg4)}
    .loupe-editor{width:100%;box-sizing:border-box;min-height:200px;margin-top:10px;padding:10px;border-radius:10px;resize:vertical;
      border:1px solid var(--loupe-line);
      background:var(--loupe-input);
      color:var(--loupe-fg);
      font:12.5px/1.7 Consolas,ui-monospace,monospace}
    .loupe-actions{display:flex;gap:10px;align-items:center;margin-top:10px}
    .loupe-param{padding:11px 0;border-bottom:1px solid var(--loupe-line1)}
    .loupe-param-label{font-size:13.5px;font-weight:600;color:var(--loupe-fg)}
    .loupe-param-hint{font-size:11.5px;margin-top:4px;color:var(--loupe-fg4)}
    .loupe-select{margin-top:7px;padding:5px 9px;border-radius:8px;font:13px inherit;
      border:1px solid var(--loupe-line);
      background:var(--loupe-input);color:var(--loupe-fg)}
    .loupe-ws{margin-top:10px;padding:11px;border-radius:10px;
      border:1px solid var(--loupe-line);
      background:var(--loupe-layer)}
    .loupe-ws-title{font-size:12.5px;font-weight:600;margin-bottom:7px;color:var(--loupe-fg2)}
    .loupe-ws-item{all:unset;display:block;width:100%;box-sizing:border-box;cursor:pointer;padding:7px 9px;border-radius:8px;
      font-size:12.5px;margin-bottom:2px;word-break:break-all;
      color:var(--loupe-fg2)}
    .loupe-ws-item:hover{background:var(--loupe-hover)}
    .loupe-ws-item.none{color:var(--loupe-fg3)}
    .loupe-ws-item.on{font-weight:600;color:var(--loupe-accent);
      box-shadow:inset 0 0 0 1px var(--loupe-accent-soft)}
    /* 历史页：搜索框 + 分页工具行 */
    .loupe-search{width:100%;box-sizing:border-box;margin-top:9px;padding:7px 10px;border-radius:9px;
      border:1px solid var(--loupe-line);background:var(--loupe-input);color:var(--loupe-fg);font:13px/1.5 inherit}
    .loupe-hist-tools{display:flex;gap:10px;align-items:center;margin-top:9px}
    /* 推理过程：默认折叠，展开后是一个等宽滚动块 */
    .loupe-think{margin:3px 0 7px}
    .loupe-think summary{cursor:pointer;font-size:12px;color:var(--loupe-fg3);outline:none}
    .loupe-think[open] summary{margin-bottom:5px}
    .loupe-think pre{margin:0;padding:8px 10px;border-radius:8px;background:var(--loupe-layer);
      color:var(--loupe-fg2);font:11.5px/1.65 Consolas,ui-monospace,monospace;
      white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto}

    /* ── 玻璃质感（追加层）──────────────────────────────────────────────────
       半透明底 + backdrop-filter 模糊 + 高光描边。整块包在 @supports 里：
       不支持 color-mix 的环境保持上面的实底 —— 「半透明但没模糊」会让正文直接
       糊在宿主内容上，比不玻璃更糟。容器内的输入框 / 引用条同样降透明度，
       否则玻璃壳里嵌着几块实色会露馅。
       （backdrop-filter 在 VCP 卡片里被禁是因为流式渲染期会抖；这里是真实
       DSH 页面里的常驻浮窗，不受那条约束。） */
    @supports (background:color-mix(in srgb,red 50%,transparent)){
      .loupe-win.glass{
        background:color-mix(in srgb,var(--loupe-surface) 82%,transparent);
        backdrop-filter:blur(20px) saturate(1.3);
        -webkit-backdrop-filter:blur(20px) saturate(1.3)}
      .loupe-bar.glass{
        background:color-mix(in srgb,var(--loupe-menu) 78%,transparent);
        backdrop-filter:blur(16px) saturate(1.3);
        -webkit-backdrop-filter:blur(16px) saturate(1.3)}
      .loupe-win.glass .loupe-input,.loupe-win.glass .loupe-editor,.loupe-win.glass .loupe-select{
        background:color-mix(in srgb,var(--loupe-input) 58%,transparent)}
      .loupe-win.glass .loupe-quote,.loupe-win.glass .loupe-ws{
        background:color-mix(in srgb,var(--loupe-layer) 65%,transparent)}
      .loupe-win.glass .loupe-search{
        background:color-mix(in srgb,var(--loupe-input) 58%,transparent)}
    }
    `

    // ── state ────────────────────────────────────────────────────────────────

    let bar = null
    let win = null
    let currentSelection = null
    let sendSeq = 0
    // client 根上下文：保存时要经它拿 sessions 服务（ctx.get 探测，不抛）。
    let clientCtx = null
    // 最近一次工作区探测的结论（诊断页展示）。
    let lastWorkspaceProbe = null
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

      const explain = el('button', 'on', t('explain'))
      explain.addEventListener('mousedown', (e) => e.preventDefault())
      explain.addEventListener('click', () => {
        openWindow(selection)
        hideBar()
      })

      const sep = el('span', 'sep')
      const settings = el('button', undefined, t('settings'))
      settings.title = t('settingsTip')
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
      if (glassEnabled()) bar.classList.add(GLASS_CLASS)
      applyScheme()
    }

    // ── floating window ──────────────────────────────────────────────────────

    function ensureWindow() {
      if (win) return win
      win = el('div', `loupe-win`)
      win.setAttribute('data-dsh-loupe', 'win')

      const head = el('div', 'loupe-head')
      // 从历史恢复的浮窗需要一个回程：'←' 关掉浮窗、回到设置面板（历史页）。
      // 正常划词进来的浮窗没有"来处"，这个键就不出现。
      const back = el('button', undefined, '←')
      back.title = t('backTip')
      back.style.display = 'none'
      back.addEventListener('click', () => {
        closeWindow()
        openSettings()
      })
      const title = el('div', 'loupe-title', t('winTitle'))
      const save = el('button', undefined, t('save'))
      save.title = t('saveTip')
      save.addEventListener('click', () => saveCurrent())
      const close = el('button', undefined, '×')
      close.title = t('closeTip')
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
      const send = el('button', 'loupe-send', t('send'))
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

      win.__loupe = { quote, body, input, send, save, back, title, close }
      if (glassEnabled()) win.classList.add(GLASS_CLASS)
      applyScheme()
      return win
    }

    /** 语言变化后刷新浮窗上的静态文案（标题 / 按钮 / 提示）。 */
    function refreshWindowLabels() {
      if (!win) return
      const parts = win.__loupe
      if (!parts || !parts.title) return
      parts.title.textContent = t('winTitle')
      parts.save.textContent = t('save')
      parts.save.title = t('saveTip')
      parts.back.title = t('backTip')
      parts.close.title = t('closeTip')
      parts.send.textContent = t('send')
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
      parts.input.value = t('defaultQuestion')
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
            root.render(React.createElement(MarkdownText, { text, streaming, labels: mdLabels() }))
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
        parts.body.appendChild(el('div', 'loupe-err', t('noTurns')))
        return
      }
      const selectionText = currentSelection ? currentSelection.text || '' : ''
      const lines = [t('transcriptHead'), '']
      if (selectionText) lines.push(t('transcriptSel') + selectionText, '')
      for (const turn of turns) {
        if (turn.question) lines.push(t('transcriptQ') + turn.question, '')
        if (turn.answer) lines.push(t('transcriptA'), turn.answer, '')
      }
      lines.push(t('transcriptTail'))
      const title = t('titlePrefix') + (selectionText || turns[0].question || '').slice(0, 40)

      const transcript = lines.join('\n')
      // 不再推测工作区：列出 WebUI 上真实的工作区（名字与顺序都取自宿主投影），
      // 由用户选中后按「确定」。选择器只做选择，落库在 commitSave 里。
      renderWorkspacePicker(
        parts,
        workspaceChoices(clientCtx),
        (choice) => commitSave(parts, transcript, title, choice),
      )
    }

    /**
     * 工作区候选：直接读宿主的工作区投影。
     * items 的顺序就是 WebUI 的显示顺序，title 就是侧栏上那个名字。
     */
    /**
     * 工作区候选：读宿主的工作区投影。
     *
     * 服务对象是 WorkspaceController —— 构造函数为
     * `super(ctx, 'workspaces'); this.list = model`，即**快照读取面在
     * service.list 上**，service 本身只有命令方法。所以两个位置都试，
     * 谁有 getSnapshot 就用谁；结果记进 lastWorkspaceProbe 供诊断页展示。
     */
    function workspaceChoices(ctx) {
      try {
        const workspaces = ctx && typeof ctx.get === 'function' ? ctx.get('workspaces') : null
        if (workspaces === null || workspaces === undefined) {
          lastWorkspaceProbe = t('probeNoService')
          return []
        }
        const sources = [
          { name: 'workspaces.list', value: workspaces.list },
          { name: 'workspaces', value: workspaces },
        ]
        for (const source of sources) {
          if (source.value === null || source.value === undefined) continue
          if (typeof source.value.getSnapshot !== 'function') continue
          const snapshot = source.value.getSnapshot()
          const items = snapshot && Array.isArray(snapshot.items) ? snapshot.items : []
          if (items.length === 0) continue
          lastWorkspaceProbe = t('probeWorkspaces', { n: items.length, source: source.name })
          return items.map((item) => ({
            id: item.workspaceId,
            title: typeof item.title === 'string' && item.title.length > 0
              ? item.title
              : (typeof item.path === 'string' && item.path.length > 0 ? item.path : String(item.workspaceId)),
            path: typeof item.path === 'string' ? item.path : '',
          }))
        }
        lastWorkspaceProbe = t('probeNoSnapshot')
        return []
      } catch (error) {
        lastWorkspaceProbe = t('probeError', { msg: error && error.message ? error.message : error })
        return []
      }
    }

    /** 保存目标选择器：点行选中，「确定」才落库。 */
    function renderWorkspacePicker(parts, choices, onConfirm) {
      const previous = parts.body.querySelector('[data-loupe="ws"]')
      if (previous) previous.remove()
      const box = el('div', 'loupe-ws')
      box.setAttribute('data-loupe', 'ws')
      box.appendChild(el('div', 'loupe-ws-title', t('pickerTitle')))

      let selected = choices.length > 0 ? choices[0] : null
      const rows = []
      const repaint = () => {
        for (const row of rows) row.node.classList.toggle('on', row.choice === selected)
      }
      const addRow = (label, choice, extraClass) => {
        const node = el('button', extraClass ? 'loupe-ws-item ' + extraClass : 'loupe-ws-item')
        node.textContent = label
        if (choice && choice.path) node.title = choice.path
        node.addEventListener('click', () => {
          selected = choice
          repaint()
        })
        rows.push({ node, choice })
        box.appendChild(node)
      }
      if (choices.length === 0) {
        box.appendChild(el('div', 'loupe-param-hint', t('pickerNoWs')))
      }
      for (const choice of choices) addRow(choice.title, choice)
      addRow(t('pickerNone'), null, 'none')
      repaint()

      const actions = el('div', 'loupe-actions')
      const confirm = el('button', 'loupe-send', t('confirm'))
      confirm.addEventListener('click', () => {
        box.remove()
        onConfirm(selected)
      })
      const cancel = el('button', 'loupe-send loupe-ghost', t('cancel'))
      cancel.addEventListener('click', () => box.remove())
      actions.appendChild(confirm)
      actions.appendChild(cancel)
      box.appendChild(actions)
      parts.body.appendChild(box)
      parts.body.scrollTop = parts.body.scrollHeight
    }

    /** 用户选定后真正落库：建档 → 登记进工作区 → 投递内容。 */
    function commitSave(parts, transcript, title, choice) {
      const btn = parts.save
      // typeof 对未声明的标识符不会抛错，所以这道检查能在"变量根本没定义"
      // 这种事故里给出可读信息，而不是让点击静默失败。
      if (typeof transcript !== 'string' || transcript.length === 0) {
        btn.disabled = false
        parts.body.appendChild(el('div', 'loupe-err', t('saveEmpty')))
        return
      }
      const originalLabel = btn.textContent
      btn.disabled = true
      btn.textContent = t('saving')
      const succeed = (message) => {
        btn.textContent = t('saved')
        parts.body.appendChild(el('div', 'loupe-note', message))
        parts.body.scrollTop = parts.body.scrollHeight
      }
      const fail = (error) => {
        btn.textContent = originalLabel
        btn.disabled = false
        parts.body.appendChild(el('div', 'loupe-err', t('saveFailed') + (error && error.message ? error.message : error)))
        parts.body.scrollTop = parts.body.scrollHeight
      }

      const sessions = clientCtx && typeof clientCtx.get === 'function' ? clientCtx.get('sessions') : null
      // cwd 只给退化路径（host /pin）用；正常路径交给 workspaceId。
      const cwd = choice && choice.path ? choice.path : undefined
      const canCreate = sessions !== null && sessions !== undefined
        && typeof sessions.create === 'function' && typeof sessions.binding === 'function'

      if (!canCreate) {
        // 退化：走 host 的 pin 路由（会话能建出来，但可能不进列表）。
        fetch(`${ROUTE}/pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: transcript, title, cwd }),
        })
          .then((r) => r.json())
          .then((payload) => {
            if (!payload || !payload.ok) throw new Error((payload && payload.error) || 'save failed')
            succeed(t('savedFallback', { id: String(payload.sessionId || '').slice(0, 22) }))
          })
          .catch(fail)
        return
      }

      let savedId = null
      let named = false
      // 关键：传 workspaceId 而不是 cwd。host 的 session.create 对两者语义不同 ——
      //   cwd          → 只把会话建在那个目录，**不入工作区的账**（于是落进「未分组」）
      //   workspaceId  → 用 workspace.path 作为 cwd，并自动 workspace.attachSession()
      // 只有后者会让会话出现在左侧列表里（2026-09-22 读 host 命令实现确认）。
      sessions
        .create(choice && choice.id ? { workspaceId: choice.id } : {})
        .then((sessionId) => {
          savedId = sessionId
          const bound = sessions.binding(savedId)
          if (!bound || !bound.session || typeof bound.session.prompt !== 'function') {
            throw new Error(t('notAddressable'))
          }
          // 自动命名：宿主的 sessionTitle 服务能直接把标题钉成「划词 · <词>」
          // （better-sidebar 的侧边线程同款用法）。没有这个服务就保留宿主自动
          // 生成的标题 —— 命名失败绝不让保存失败。
          try {
            const titles = clientCtx && typeof clientCtx.get === 'function' ? clientCtx.get('sessionTitle') : null
            if (titles && typeof titles.rename === 'function') {
              titles.rename(bound.session, title)
              named = true
            }
          } catch {
            /* 命名是锦上添花 */
          }
          // content 必须是 ContentBlock[]（prompt 实现里有 content.some）。
          return bound.session.prompt([{ type: 'text', text: transcript }], 'queue').then(() => savedId)
        })
        .then((sessionId) => {
          const where = choice && choice.title ? choice.title : t('ungrouped')
          succeed(t('savedTo', { where, id: String(sessionId).slice(0, 22) }))
          if (named) succeed(t('renamed', { title }))
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
      const note = el('div', 'loupe-note', t('generating'))
      // 累积要用到完整答案：视图内部的状态拿不到，这里自己留一份。
      let answerText = ''
      // 推理过程：只有模型真的吐了推理分片才创建这个折叠块（默认收起）。
      let thinkBox = null
      let thinkPre = null
      let thinkText = ''
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
          note.textContent = t('thinking')
        },
        onMeta: (meta) => {
          if (seq !== sendSeq) return
          const injected = meta.injected || {}
          note.textContent = t('inject', { model: meta.model, effort: meta.reasoningEffort, sel: injected.selectionChars, msg: injected.messageChars, ctx: injected.contextChars })
        },
        onReasoning: (text) => {
          if (seq !== sendSeq) return
          if (thinkBox === null) {
            thinkBox = el('details', 'loupe-think')
            thinkBox.appendChild(el('summary', undefined, t('thinkingTitle')))
            thinkPre = el('pre')
            thinkBox.appendChild(thinkPre)
            turn.insertBefore(thinkBox, note)
          }
          thinkText += text
          thinkPre.textContent = thinkText
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
            turn.appendChild(el('div', 'loupe-err', t('emptyAnswer', { ms: info.ms })))
          } else {
            note.textContent = t('doneLine', { chars: info.chars, first: info.firstDeltaMs == null ? '—' : info.firstDeltaMs + 'ms', ms: info.ms })
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

    async function streamExplain({ selection, question, messageText, onMeta, onThinking, onReasoning, onDelta, onDone, onError }) {
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
        onError(t('requestFailed') + (error && error.message ? error.message : error))
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
        onError(t('streamBroken') + (error && error.message ? error.message : error))
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
      else if (event === 'reasoning') handlers.onReasoning(payload.text || '')
      else if (event === 'delta') handlers.onDelta(payload.text || '')
      else if (event === 'done') handlers.onDone(payload)
      else if (event === 'error') handlers.onError(payload.message || 'unknown error')
    }

    // ── settings / diagnosis panel (M1) ───────────────────────────────────────

    /** 设置面板：历史（M3）/ 上下文（M2）/ 诊断（M1 保留）。 */
    function openSettings(initialKey) {
      if (win) closeWindow()
      // 单实例：设置面板同样只能有一个 —— 此前重复点「设置」会叠出第二个面板，
      // 两个面板各带一份拖拽监听，关掉一个另一个还在。
      closeSettings()
      const w = el('div', `loupe-win`)
      w.setAttribute('data-dsh-loupe', 'settings')
      w.style.width = '600px'

      const head = el('div', 'loupe-head')
      head.appendChild(el('div', 'loupe-title', t('settingsTitle')))
      const close = el('button', undefined, '×')
      close.title = t('close')
      close.addEventListener('click', () => w.remove())
      head.appendChild(close)

      const tabBar = el('div', 'loupe-tabs')
      const body = el('div', 'loupe-body')
      const pages = [
        ['history', t('tabHistory'), renderHistory],
        ['params', t('tabParams'), renderParams],
        ['context', t('tabContext'), renderContext],
        ['probe', t('tabProbe'), renderProbe],
      ]
      for (const [key, label, render] of pages) {
        const btn = el('button', 'loupe-tab', label)
        btn.setAttribute('data-loupe-tab', key)
        btn.addEventListener('click', () => {
          for (const other of tabBar.querySelectorAll('button')) {
            other.classList.toggle('on', other === btn)
          }
          // 记住当前页签：语言被宿主偏好改写时要按同一页重绘。
          w.setAttribute('data-loupe-active', key)
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
      // 关面板时必须同时拆掉拖拽的 window 监听，否则反复开关会越攒越多。
      w.__loupeDestroy = stopDrag
      close.addEventListener('click', () => closeSettings())
      if (glassEnabled()) w.classList.add(GLASS_CLASS)
      applyScheme()
      const wanted = tabBar.querySelector('[data-loupe-tab="' + (initialKey || 'history') + '"]')
      const first = wanted || tabBar.querySelector('button')
      if (first) first.click()
    }

    /** 关掉设置面板（连同它注册的 window 监听）。 */
    function closeSettings() {
      const panel = document.querySelector('[data-dsh-loupe="settings"]')
      if (!panel) return false
      if (typeof panel.__loupeDestroy === 'function') panel.__loupeDestroy()
      panel.remove()
      return true
    }

    /** 用同一个页签重开设置面板 —— 切换界面语言后立刻按新语言重绘。 */
    function reopenSettings(key) {
      closeSettings()
      openSettings(key || 'history')
    }

    /** 诊断页：宿主能力一览（M1 起保留，排障第一入口）。 */
    function renderProbe(body) {
      const drag = window.__dshLoupeDrag || { down: 0, move: 0, up: 0, lastTarget: '' }
      body.appendChild(el('div', 'loupe-note', t('probeWs') + (lastWorkspaceProbe || t('probeNever'))))
      const dragLine = el('div', 'loupe-note', t('probeDrag') + 'down=' + drag.down + ' move=' + drag.move + ' up=' + drag.up + t('probeDragTip') + (drag.lastTarget || t('probeNone')))
      body.appendChild(dragLine)
      const scheme = themeScheme()
      body.appendChild(el('div', 'loupe-note',
        t('probeTheme') + (scheme === 'dark' ? t('themeDark') : t('themeLight'))
        + ' · ' + t('probeTokens') + (hostTokensAvailable() ? t('probeTokensYes') : t('probeTokensNo'))))
      body.appendChild(el('div', 'loupe-note', t('probeLang') + LANG + ' · ' + langSource()))
      const htmlLang = (document.documentElement.getAttribute('lang') || '').trim()
      body.appendChild(el('div', 'loupe-note', t('probeHtmlLang', { value: htmlLang || '—' })))
      const pre = el('div', 'loupe-probe', t('probeLoading'))
      body.appendChild(pre)
      fetch(`${ROUTE}/probe`)
        .then((r) => r.json())
        .then((payload) => {
          pre.textContent = JSON.stringify(payload, null, 2)
        })
        .catch((error) => {
          pre.textContent = t('probeFailed') + (error && error.message ? error.message : error)
        })
    }

    /**
     * 参数（M5）：存在 localStorage —— 它们只影响本机这一份插件行为，没有
     * 跨设备同步的必要，也就不该为它引入一个 host 端配置面。
     */
    const PARAMS_KEY = 'dsh-loupe:params'

    const GLASS_CLASS = 'glass'

    /**
     * 玻璃质感开关。判定用 !== 'off' 而不是 === 'on'：老用户 localStorage 里
     * 还没有这个键时也要默认打开，不需要任何迁移。
     */
    function glassEnabled() {
      return settings().glass !== 'off'
    }

    /** 把开关同步到已存在的浮层（设置页切换后立即生效，不必重开浮窗）。 */
    function applyGlass() {
      const on = glassEnabled()
      for (const node of document.querySelectorAll('[data-dsh-loupe]')) {
        if (node.getAttribute('data-dsh-loupe') === 'style') continue
        node.classList.toggle(GLASS_CLASS, on)
      }
    }

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
      const entry = t('autoEntry', { sel, summary })
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
            next = current + '\n\n' + AUTO_START + '\n' + t('autoHeading') + '\n' +
              t('autoNote') + '\n' +
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
     * 当前会话的工作目录 —— 优先走正式 API，DOM 只作兜底。
     *
     * `sessions.list.getSnapshot()` 给出列表快照：snapshot.current 是当前会话
     * id，snapshot.byId[current].cwd 就是它所属的工作区（与宿主 session.fork
     * 继承的 header.cwd 同源）。此前只用 DOM 选择器猜，实测猜不到 —— 保存出来
     * 的会话落进了「未分组」。
     */
    function currentCwd(sessions) {
      try {
        const list = sessions && sessions.list
        const snapshot = list !== null && list !== undefined && typeof list.getSnapshot === 'function'
          ? list.getSnapshot()
          : null
        if (snapshot !== null && snapshot !== undefined && snapshot.current !== undefined && snapshot.byId) {
          const summary = snapshot.byId[snapshot.current]
          if (summary && typeof summary.cwd === 'string' && summary.cwd.length > 0) return summary.cwd
        }
      } catch {
        /* 快照不可用：退回 DOM 探测 */
      }
      return guessCwd()
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
          label: t('pEffort'),
          hint: t('pEffortHint'),
          values: ['off', 'low', 'high', 'max'],
          fallback: 'off',
          numeric: false,
        },
        {
          key: 'neighborCount',
          label: t('pNeighbor'),
          hint: t('pNeighborHint'),
          values: ['0', '1', '2', '4'],
          fallback: '0',
          numeric: true,
        },
        {
          key: 'glass',
          label: t('pGlass'),
          hint: t('pGlassHint'),
          values: ['on', 'off'],
          fallback: 'on',
          numeric: false,
        },
        {
          key: 'accumulate',
          label: t('pAccumulate'),
          hint: t('pAccumulateHint'),
          values: ['on', 'off'],
          fallback: 'on',
          numeric: false,
        },
        {
          key: 'contextChars',
          label: t('pContextChars'),
          hint: t('pContextCharsHint'),
          values: ['800', '2200', '4000', '8000'],
          fallback: '2200',
          numeric: true,
        },
        {
          key: 'lang',
          label: t('pLang'),
          hint: t('pLangHint'),
          values: ['auto', 'zh', 'en'],
          labels: { auto: t('langAuto'), zh: '中文', en: 'English' },
          fallback: 'auto',
          numeric: false,
        },
      ]
      const status = el('div', 'loupe-note', t('paramsNote'))
      body.appendChild(status)
      // 主题是只读的：它跟着宿主走，这里只把「现在实际是哪种」摊开给人看。
      const themeRow = el('div', 'loupe-param')
      themeRow.appendChild(el('div', 'loupe-param-label', t('pTheme')))
      themeRow.appendChild(el('div', 'loupe-param-hint',
        t('pThemeHint') + ' · ' + (themeScheme() === 'dark' ? t('themeDark') : t('themeLight'))
        + ' · ' + (hostTokensAvailable() ? t('probeTokensYes') : t('probeTokensNo'))))
      body.appendChild(themeRow)
      for (const row of rows) {
        const wrap = el('div', 'loupe-param')
        wrap.appendChild(el('div', 'loupe-param-label', row.label))
        const select = document.createElement('select')
        select.className = 'loupe-select'
        const active = String(current[row.key] === undefined ? row.fallback : current[row.key])
        for (const value of row.values) {
          const option = document.createElement('option')
          option.value = value
          option.textContent = row.labels && row.labels[value] ? row.labels[value] : value
          if (value === active) option.selected = true
          select.appendChild(option)
        }
        select.addEventListener('change', () => {
          saveSetting(row.key, row.numeric ? Number(select.value) : select.value)
          status.textContent = t('paramSet', { label: row.label, value: select.value })
          if (row.key === 'glass') applyGlass()
          if (row.key === 'lang') {
            // 语言变了要立刻按新语言重绘（用户此刻正在参数页）。
            refreshLang()
            reopenSettings('params')
          }
        })
        wrap.appendChild(select)
        wrap.appendChild(el('div', 'loupe-param-hint', row.hint))
        body.appendChild(wrap)
      }
    }

    /** 历史页：搜索 + 分页加载，点任意一条即可在浮窗里继续。 */
    const HISTORY_PAGE = 50

    let historyQuery = ''
    let historyLoaded = []
    let historyTimer = null

    function renderHistory(body) {
      const status = el('div', 'loupe-note', t('histLoading'))
      const search = document.createElement('input')
      search.className = 'loupe-search'
      search.type = 'search'
      search.placeholder = t('histSearch')
      search.value = historyQuery
      const tools = el('div', 'loupe-hist-tools')
      const more = el('button', 'loupe-send loupe-ghost', t('histMore'))
      tools.appendChild(more)
      const list = el('div', 'loupe-hist')
      body.appendChild(status)
      body.appendChild(search)
      body.appendChild(tools)
      body.appendChild(list)

      const paint = () => {
        list.textContent = ''
        for (const item of historyLoaded) list.appendChild(historyRow(item))
      }

      const load = (reset) => {
        // 搜索与分页共用一条读路径：reset 清空已加载页，否则在尾部接下一页。
        if (reset) {
          historyLoaded = []
          list.textContent = ''
        }
        status.textContent = t('histLoading')
        const offset = historyLoaded.length
        const url = `${ROUTE}/history?limit=${HISTORY_PAGE}&offset=${offset}&q=${encodeURIComponent(historyQuery)}`
        fetch(url)
          .then((r) => r.json())
          .then((payload) => {
            if (!payload.ok) throw new Error(payload.error || 'read failed')
            historyLoaded = historyLoaded.concat(payload.items || [])
            paint()
            // 只有搜索时才有「匹配数」可言；没搜索时它就是总数，重复显示没意义。
            const matched = payload.query ? (typeof payload.matched === 'number' ? payload.matched : null) : null
            status.textContent = historyLoaded.length === 0
              ? (payload.query ? t('histNoMatch') : t('histEmpty'))
              : t('histCount', { total: payload.total || 0, shown: historyLoaded.length, matched })
            more.style.display = payload.hasMore === true ? '' : 'none'
            more.disabled = false
          })
          .catch((error) => {
            more.disabled = false
            status.textContent = t('histFailed') + (error && error.message ? error.message : error)
          })
      }

      more.addEventListener('click', () => {
        more.disabled = true
        load(false)
      })
      search.addEventListener('input', () => {
        if (historyTimer) clearTimeout(historyTimer)
        historyTimer = setTimeout(() => {
          historyTimer = null
          historyQuery = search.value.trim()
          load(true)
        }, 250)
      })

      load(true)
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
      row.appendChild(head)
      // 主标题 = 划选的文字：翻历史找的是「我当时划的是哪个词」，
      // 而问题那行是每条都一样的固定问句，不该占视觉重心。
      if (item.selection) row.appendChild(el('div', 'loupe-hist-sel', item.selection.slice(0, 60)))
      const meta = [
        item.answerChars ? t('histChars', { n: item.answerChars }) : '',
        item.firstDeltaMs == null ? '' : t('histFirst', { ms: item.firstDeltaMs }),
        item.model || '',
        item.ok === false ? t('histFail') : '',
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
      closeSettings()
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
      if (item.reasoning) {
        const box = el('details', 'loupe-think')
        box.appendChild(el('summary', undefined, t('thinkingTitle')))
        box.appendChild(el('pre', undefined, item.reasoning))
        turn.appendChild(box)
      }
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
      const status = el('div', 'loupe-note', t('ctxLoading'))
      body.appendChild(status)
      const editor = el('textarea', 'loupe-editor')
      editor.setAttribute('data-loupe', 'context')
      editor.placeholder = t('ctxPlaceholder')
      body.appendChild(editor)
      const actions = el('div', 'loupe-actions')
      const saveBtn = el('button', 'loupe-send', t('save'))
      saveBtn.disabled = true
      const hint = el('span', 'loupe-note', '')
      actions.appendChild(saveBtn)
      actions.appendChild(hint)
      body.appendChild(actions)
      const help = el('div', 'loupe-note',
        t('ctxHelp'))
      body.appendChild(help)

      fetch(`${ROUTE}/context`)
        .then((r) => r.json())
        .then((payload) => {
          if (!payload.ok) throw new Error(payload.error || 'read failed')
          editor.value = payload.text || ''
          status.textContent = payload.exists
            ? t('ctxLoaded', { chars: payload.chars, file: payload.file })
            : t('ctxMissing')
          saveBtn.disabled = false
        })
        .catch((error) => {
          status.textContent = t('ctxReadFailed') + (error && error.message ? error.message : error)
        })

      saveBtn.addEventListener('click', () => {
        saveBtn.disabled = true
        hint.textContent = t('ctxSaving')
        fetch(`${ROUTE}/context`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: editor.value }),
        })
          .then((r) => r.json())
          .then((payload) => {
            if (!payload.ok) throw new Error(payload.error || 'write failed')
            hint.textContent = payload.truncated
              ? t('ctxSavedTrunc', { chars: payload.chars })
              : t('ctxSaved', { chars: payload.chars })
            saveBtn.disabled = false
          })
          .catch((error) => {
            hint.textContent = t('ctxSaveFailed') + (error && error.message ? error.message : error)
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
      refreshLang()
      clientCtx = ctx
      // 宿主可能带一份语言偏好（settings.yaml 的 locale.preference）：
      // 先按浏览器语言把界面立起来，再按宿主偏好纠正一次。
      syncHostLocale()
      const style = document.createElement('style')
      style.setAttribute('data-dsh-loupe', 'style')
      style.textContent = CSS
      document.head.appendChild(style)

      document.addEventListener('mouseup', onMouseUp, true)
      document.addEventListener('mousedown', onMouseDown, true)
      window.addEventListener('scroll', onScroll, true)
      window.addEventListener('resize', hideBar)
      // 系统深浅变化时立刻改写浮层的配色属性（面板开着也能立即跟随）。
      try {
        const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
        if (typeof darkQuery.addEventListener === 'function') {
          const onSchemeChange = () => applyScheme()
          darkQuery.addEventListener('change', onSchemeChange)
          disposers.push(() => darkQuery.removeEventListener('change', onSchemeChange))
        }
      } catch {
        /* 没有 matchMedia 事件的老浏览器：保持创建时的配色 */
      }

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
