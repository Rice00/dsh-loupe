<div align="center">

<img src="assets/logo.png" alt="dsh-loupe" width="150" />

# dsh-loupe

**这一段什么意思？**——选中就能问，答案浮在旁边（为读不懂的人设计）。

一个 DeepSeek Harness 插件：在会话里划词，浮窗解释。独立通道，不建会话、不污染主会话，读完可保存成正式会话。

[![License: MIT](https://img.shields.io/badge/License-MIT-2f7de1.svg)](./LICENSE)
[![Platform: DSH web](https://img.shields.io/badge/platform-DSH%20web-334eac.svg)](#兼容性)
[![Host: zero deps](https://img.shields.io/badge/host-zero%20deps-3c873a.svg)](#兼容性)
[![Zero config](https://img.shields.io/badge/setup-zero%20config-1c7a54.svg)](#功能)
[![PRs: welcome](https://img.shields.io/badge/PRs-welcome-7096d1.svg)](#参与贡献)
[![GitHub stars](https://img.shields.io/github/stars/Rice00/dsh-loupe?style=flat&label=stars&color=7096d1)](https://github.com/Rice00/dsh-loupe/stargazers)

[功能](#功能) · [安装](#安装) · [快速上手](#快速上手) · [工作原理](#工作原理) · [参数](#参数) · [接口](#接口) · [常见问题](#常见问题)

</div>

---

## 功能

| | |
|---|---|
| 🖱️ **划词即弹** | 在会话正文里选中任意文字，选区下方浮出两个入口：**解释** / **设置**。 |
| 🪟 **浮窗，不是侧栏** | 单实例、可多轮追问、流式 markdown。可拖拽，位置刷新页面后还在。 |
| 🔌 **独立通道** | 只发一次 `llm.stream`：不建会话、不写会话日志、不注册工具。关掉就是关掉，不留归档垃圾。 |
| 🧠 **插件自己的上下文** | 常驻 `context.md`（术语表、风格指令、累积结论），受字符上限约束，放在 prompt 的稳定前缀里吃宿主缓存。 |
| 🔁 **自动累积** | 每次解释后把「选区 → 结论」沉淀进受控区块，下次遇到同样的词更快更准。可关。 |
| 🗂️ **全量留档** | 每次问答进 `history.jsonl`；历史页点任意一条即可在浮窗里接着问，带「←」返回键。 |
| 📌 **保存成正式会话** | 选目标工作区 → 建档 → 投递记录，成为左侧会话列表里的一个真会话。 |
| 🔑 **零配置** | 走宿主已有的 `llm` 服务（默认跟随 `agent-default-model`），不要 API key。 |
| 🫧 **玻璃质感** | 浮窗与浮标的半透明 + 背景模糊，可在参数页关掉（拖动更跟手）。 |

## 安装

### 本地目录（推荐）

```bash
git clone https://github.com/Rice00/dsh-loupe.git
dsh plugin --profile <profile> add link:/abs/path/to/dsh-loupe
```

bundle 补丁会往 profile 里插一行（`loupe`）。**然后重启这个 profile**——宿主插件模块在进程内缓存，运行中的 harness 不会自动读到新行。只改界面的话，刷新浏览器就够了。

`link:` 是活链接：**改源码立刻生效**（宿主代码重启后生效，界面代码刷新后生效），但装完之后不能挪动这个目录。想连文件一起复制走，用 `file:/abs/path/to/dsh-loupe`，代价是以后每次改都得重新装一遍。

### 从 GitHub 或 npm 安装

```bash
dsh plugin --profile <profile> add github:Rice00/dsh-loupe
dsh plugin --profile <profile> add dsh-loupe        # 发布到 npm 之后
```

### 交给 AI 助手（直接复制）

```
请帮我安装 DSH 插件 dsh-loupe：

1) 装进 web profile，两种来源任选：
     从 GitHub：
       dsh plugin --profile web add github:Rice00/dsh-loupe
     或从本地检出（填这个文件夹的绝对路径）：
       dsh plugin --profile web add link:<绝对路径>
2) 重启该 profile —— 宿主插件模块在进程内缓存，新行只在启动时读。
   （只改界面的话，刷新浏览器就够了。）
3) 验证：随便打开一个会话，在正文里选中一句话。
   选区下方应浮出「解释 / 设置」；点「解释」应弹出浮窗并流式作答。
   浮窗底部一行应显示本次注入统计（选区 N 字 · 所在消息 M 字 · 插件上下文 K 字）。
4) 不生效时看设置页第四页「诊断」：宿主 llm 服务、模型解析、context.md 可写性、
   拖动事件计数、工作区探测结论，逐项列出来。
```

## 快速上手

装好后什么都不用配：

1. 在会话正文里**选中一段文字** → 选区下方浮出「解释 / 设置」。
2. 点**解释** → 浮窗打开，输入框已预填你选的文字与提问句，直接回车或改了再问。
3. 追问、拖走、关掉随你。关掉不丢——设置页「历史」里全在。
4. 想留住某个结论 → 浮窗里点**保存** → 选工作区 → **确定**，它就成了左侧列表里的正式会话。

## 工作原理

```
选中文字
   │
   ├─[浮标]──┬─ 解释 ──→ 浮窗（单实例）
   │         └─ 设置 ──→ 历史 / 参数 / 上下文 / 诊断
   │
   └─ 浮窗提问
         │
         POST /plugins/dsh-loupe/explain
                │
                ├─ 选区文字
                ├─ 选区所在的那条消息（± 邻域条数）
                └─ context.md（受字符上限约束）
                        │
                        └─ llm.stream（宿主 llm 服务，跟随默认模型）
                               │
                               └─ SSE：meta → (thinking) → first → delta → done
                                      │
                                      ├─ 流式 markdown 渲染
                                      ├─ history.jsonl 留档
                                      └─ context.md 自动累积（可关）
```

## 上下文策略

**快靠减法，准靠加法。** 不塞 agent 的全量上下文（省 token、压首字延迟），只加一份自己的、受预算约束的上下文。

- `context.md` 放在 prompt 的**稳定前缀**里，能命中宿主的 prompt 缓存。
- 自动累积写进**注释标记隔开的受控区块**，不碰你手写的内容；最新在前，截断时先丢旧的。
- 浮窗底部常驻一行注入统计——解释变差时，一眼看出是不是上下文的锅。

## 参数

设置页「参数」，改动即时生效（下一次解释就用新值）：

| 参数 | 可选值 | 默认 | 作用 |
|---|---|---|---|
| 推理档 | `off` / `low` / `high` / `max` | `off` | 实测同一问题：off 首字 544ms、总 1.7s；low 首字 2806ms、总 4.3s（约 5 倍）。解释单段文字建议 off。 |
| 邻域条数 | `0` / `1` / `2` / `4` | `0` | 选区前后各带几条对话进 prompt。0 = 只带选区所在的那条消息，最快最省。 |
| 玻璃质感 | `on` / `off` | `on` | 浮窗与浮标的半透明 + 背景模糊；需要浏览器支持 `color-mix`。 |
| 自动累积 | `on` / `off` | `on` | 把每次结论沉淀进 `context.md` 的受控区块。 |
| 插件上下文上限 | `800` / `2200` / `4000` / `8000` | `2200` | `context.md` 注入的字符上限。 |

## 接口

```
GET  /plugins/dsh-loupe/probe     诊断：宿主能力 / 模型解析 / context 可写性 / 拖动事件 / 工作区探测
POST /plugins/dsh-loupe/explain   解释调用（SSE：meta / thinking / first / delta / done / error）
GET  /plugins/dsh-loupe/history   历史（最新在前；文件超过 8MB 只读尾部）
GET  /plugins/dsh-loupe/context   读上下文
POST /plugins/dsh-loupe/context   写上下文（64 KB 上限）
POST /plugins/dsh-loupe/pin       保存成正式会话（客户端会话服务不可用时的兜底）
```

<details>
<summary><b>数据落在哪</b></summary>

```
~/.dsh/loupe/context.md     插件上下文（手写区 + 自动累积受控区）
~/.dsh/loupe/history.jsonl  全部问答记录（只追加，不重写）
```

`DSH_HOME` 存在时跟随它。历史读取在文件超过 8MB 时只取尾部，所以不会因为文件越来越大而越来越慢。

</details>

<details>
<summary><b>为什么不是又一个侧边聊天</b></summary>

| | 侧边对话 | **dsh-loupe** |
| --- | --- | --- |
| 是否建会话 | 是（真 fork，全量历史快照） | **否**——只发一次 `llm.stream` |
| 关掉之后 | 变归档会话，要捞回来 | 只关窗口，内容进插件历史 |
| 首轮上下文 | 主会话全量历史（几十万 token 量级） | 选区 + 所在消息 + 受上限约束的插件上下文 |
| 会话列表 | 每开一个都要收拾 | 不产生任何会话垃圾 |

</details>

## 兼容性

- **运行环境**：DSH **web** profile（`platform: web`）。client 半端是手写的模块加载器模块——**没有打包产物要同步，也没有构建步骤**。
- **宿主半端零依赖**：`lib/index.js` 只 import `node:fs` / `node:os` / `node:path` / `node:crypto`，不解析任何第三方包。
- **模型**：走宿主 `llm` 服务，默认跟随 `agent-default-model`，也可在插件配置里指定。**不需要任何 API key。**
- **浏览器**：玻璃质感依赖 `color-mix`；不支持时自动退回实底，其余功能不受影响。

<details>
<summary><b>文件结构</b></summary>

```
lib/index.js       宿主半端（路由 / prompt 组装 / 流式解析 / 落盘）
lib/client.js      界面半端（划词 / 浮标 / 浮窗 / 四个页签）
cordis.patch.yml   bundle 补丁（插一行 id: loupe）
PLAN.md                          实现方案
docs/M1-实施记录.md              M0 取证 + M1 落地
docs/M1-真机迭代.md              M1 阶段的四个坑（配置 / Message 字段 / 推理分片 / markdown）
docs/M2-M5-实施与修复记录.md     M2–M5 实施与修复
docs/保存链路复盘.md             「保存」踩穿的七个坑与两条工程教训
```

</details>

## 常见问题

| 问题 | 答案 |
| --- | --- |
| 会污染我的主会话吗？ | 不会。插件只发一次 `llm.stream`，不建会话、不写会话日志、不注册工具——主会话里不会多出任何消息。 |
| 要填 API key 吗？ | 不用。走宿主已有的 `llm` 服务，默认跟随 `agent-default-model`。 |
| 为什么默认 `off` 推理档？ | 解释单段文字不需要高推理。实测 off 首字 544ms，low 2806ms（约 5 倍）。嫌答得浅就在参数页调 `low`。 |
| 关掉浮窗，内容还在吗？ | 在。全部留档在 `history.jsonl`，设置页「历史」里点一条就能接着问。 |
| 「保存」保存到哪去了？ | 保存到一个**你选的工作区**，成为左侧会话列表里的一个正式会话（不是归档、不是临时文件）。 |
| 历史会越来越大吗？ | 会，只追加不重写。超过 8MB 时读取只取尾部，把变慢的影响限制住了。 |
| 玻璃质感没效果？ | 需要浏览器支持 `color-mix`；不支持时自动退回实底，其余功能照常。 |
| 浮窗拖不动？ | 设置页「诊断」里有拖动事件计数——拖一下看计数涨不涨，就知道事件有没有到。 |

## 卸载

```bash
dsh plugin --profile <profile> remove dsh-loupe
```

`~/.dsh/loupe/`（`context.md` + `history.jsonl`）不会自动删除。想彻底清干净就手动删掉它——那是卸载后唯一会留下的东西。

## 后续计划

- [x] 划词浮标（解释 / 设置）
- [x] 独立浮窗：多轮、流式 markdown、可拖拽、位置记忆
- [x] 独立通道：不建会话、不写会话日志
- [x] 插件上下文注入 + 自动累积
- [x] 历史留档与一键复原
- [x] 保存成正式会话（选工作区）
- [x] 玻璃质感开关
- [ ] 保存后的会话自动命名
- [ ] 历史检索与分页
- [ ] 推理过程可折叠
- [ ] 发布到 npm
- [ ] English README

## 参与贡献

Issue 和 PR 都欢迎。动手前值得知道两条：

- **宿主半端不热重载**——改 `lib/index.js` 要重启 profile；改 `lib/client.js` 刷新页面即可。
- **界面半端没有构建步骤**——`lib/client.js` 直接就是加载器吃的模块，改完本身就是产物。

## 许可证

[MIT](./LICENSE)

<div align="center">
<sub>loupe = 钟表匠的寸镜，用来看清一处细节。</sub>
</div>
