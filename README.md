<div align="center">

<img src="assets/logo.png" alt="dsh-loupe" width="140" />

# dsh-loupe

**选中，就问。**

在 DSH 会话里划词，答案浮在旁边——不建会话、不污染主会话、读完可以留下来。

[![License: MIT](https://img.shields.io/badge/License-MIT-2f7de1.svg)](./LICENSE)
[![Platform: DSH web](https://img.shields.io/badge/platform-DSH%20web-334eac.svg)](#安装)
[![Zero config](https://img.shields.io/badge/setup-zero%20config-1c7a54.svg)](#常见问题)
[![PRs: welcome](https://img.shields.io/badge/PRs-welcome-7096d1.svg)](#参与贡献)
[![GitHub stars](https://img.shields.io/github/stars/Rice00/dsh-loupe?style=flat&label=stars&color=7096d1)](https://github.com/Rice00/dsh-loupe/stargazers)

[它解决什么问题](#它解决什么问题) · [三个不一样的地方](#三个不一样的地方) · [用起来是什么样](#用起来是什么样) · [参数](#参数) · [安装](#安装) · [常见问题](#常见问题)

</div>

---

## 它解决什么问题

读代码或文档，撞上一段看不懂的。今天的做法是：选中、复制、切到另一个对话、粘贴、等答案、再切回来。

想保留上下文就开个侧边对话——但侧边对话会把主会话的**整个历史** fork 一份带走，几十万 token 的输入，外加一个事后要收拾的归档会话。

dsh-loupe 把这一串压成一步：**在正文里选中，浮窗里问。**

## 三个不一样的地方

### 一、独立通道：它不建会话

解释一次，只发一次 `llm.stream`，仅此而已——不建会话、不写会话日志、不注册工具。

真机验证过：解释完之后，主会话日志里的 `user/message` 条目数没有增加，没有一条来自插件。所以会话列表不会被解释记录塞满，你也不用事后清理"看一眼就扔"的归档会话。

### 二、它用插件自己的上下文，不用你的 agent 上下文

这是整件事里最划算的一处设计。**快靠减法，准靠加法。**

不发 agent 的全量上下文（省 token、压首字延迟），只发三样东西：

```
选区文字                            ← 你选中的那段
└─ 选区所在的那条消息 ± 邻域条数     ← 默认只带这一条，需要时调到 1 / 2 / 4
   └─ context.md（受字符上限约束）    ← 插件自己的常驻上下文
```

`~/.dsh/loupe/context.md` 是你的术语表、风格指令和累积结论。它放在 prompt 的**稳定前缀**里，所以能命中宿主的 prompt 缓存——同一份上下文反复用，第二次就便宜。

**它会自己长大。** 每次解释完，插件把「选区 → 结论」沉淀进文件里一个注释标记隔开的受控区块：不碰你手写的内容，最新在前，截断时先丢旧的。同一个词第二次问，比第一次更快也更准。不想要，参数页关掉即可。

浮窗底部常驻一行注入统计：`选区 12 字 · 所在消息 430 字 · 插件上下文 2200 字`。解释变差时，一眼看出是不是上下文的锅。

### 三、读完可以留下来

浮窗里的内容默认只属于浮窗。关掉不丢，进插件历史，设置页里点一条就能接着问。

但要是某段解释值得进项目记录：浮窗里点**保存** → 选一个目标工作区 → 确定。它就变成左侧列表里的一个**正式会话**，正常对话、正常归档，和你手动开的没有区别。

## 用起来是什么样

装好之后没有任何要配置的东西：

1. 在会话正文里**选中一段文字**——选区下方浮出两个入口：**解释** / **设置**。
2. 点**解释**——浮窗打开，输入框已经预填好你选的文字和提问句。直接回车，或者改了再问。
3. **接着追问**。浮窗是单实例的，可以一直聊下去；拖到顺手的位置，刷新页面后位置还在。
4. **想留住就保存**，不需要就走开——内容在历史里等你。

设置页有四栏：

- **历史**——全部问答，点任意一条即复原回浮窗（带「←」返回键）。
- **参数**——推理档 / 邻域条数 / 玻璃质感 / 自动累积 / 上下文上限，改动即时生效。
- **上下文**——直接编辑 `context.md` 的手写区。
- **诊断**——宿主能力、模型解析、拖动事件计数、工作区探测。不生效时先看这里。

## 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| 推理档 | `off` | `off` / `low` / `high` / `max`。解释单段文字用不上高推理：实测同一问题 off 首字 **544ms**、总 1.7s；low 首字 **2806ms**、总 4.3s（约 5 倍）。嫌答得浅再调 `low`。 |
| 邻域条数 | `0` | `0` / `1` / `2` / `4`。选区前后各带几条对话进 prompt。0 = 只带所在那条消息，最快最省。 |
| 玻璃质感 | `on` | `on` / `off`。浮窗与浮标的半透明 + 背景模糊；关掉是实底，拖动更跟手。 |
| 自动累积 | `on` | `on` / `off`。把每次结论沉淀进 `context.md`。 |
| 上下文上限 | `2200` | `800` / `2200` / `4000` / `8000` 字符。`context.md` 注入的长度上限。 |

## 安装

### 本地目录（推荐）

```bash
git clone https://github.com/Rice00/dsh-loupe.git
dsh plugin --profile <profile> add link:/abs/path/to/dsh-loupe
```

bundle 补丁会往 profile 里插一行（`loupe`）。**然后重启这个 profile**——宿主插件模块在进程内缓存，运行中的 harness 读不到新行。只改界面的话，刷新浏览器就够了。

`link:` 是活链接，改源码立刻生效；代价是装完之后不能挪动这个目录。想连文件一起复制走，用 `file:/abs/path/to/dsh-loupe`，以后每次改都得重装一遍。

### 从 GitHub 或 npm

```bash
dsh plugin --profile <profile> add github:Rice00/dsh-loupe
dsh plugin --profile <profile> add dsh-loupe        # 发布到 npm 之后
```

### 让 AI 助手帮你装

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
   选区下方应浮出「解释 / 设置」；点「解释」应弹出浮窗并流式作答，
   浮窗底部应有一行本次注入统计（选区 N 字 · 所在消息 M 字 · 插件上下文 K 字）。
4) 不生效就看设置页第四栏「诊断」：它会把宿主 llm 服务、模型解析、
   context.md 可写性、拖动事件计数、工作区探测结论逐项列出来。
```

## 常见问题

**会污染我的主会话吗？**
不会。只发一次 `llm.stream`，不建会话、不写会话日志、不注册工具。

**要填 API key 吗？**
不用。走宿主已有的 `llm` 服务，默认跟随 `agent-default-model`，也可以在插件配置里指定别的。

**为什么默认 `off` 推理档？**
解释单段文字用不上高推理。DeepSeek 只认 `off` / `low` / `high` / `max` 四档，没有 `medium`。

**关掉浮窗，内容还在吗？**
在。全部留档在 `history.jsonl`，设置页「历史」里点一条就能接着问。

**历史文件会越来越大吗？**
会，只追加不重写。读取时超过 8MB 只取尾部，所以不会因为文件变大而变慢。

**玻璃质感没效果？**
需要浏览器支持 `color-mix`。不支持时自动退回实底，其余功能不受影响。

**浮窗拖不动？**
设置页「诊断」里有拖动事件计数——拖一下看计数涨不涨，就知道事件有没有传到宿主。

## 数据与接口

<details>
<summary>给要改代码或接管线的人</summary>

数据落在 `~/.dsh/loupe/`（`DSH_HOME` 存在时跟随它）：

```
context.md     插件上下文（手写区 + 自动累积的受控区块）
history.jsonl  全部问答记录（只追加，不重写）
```

宿主半端提供的路由：

```
GET  /plugins/dsh-loupe/probe     诊断：宿主能力 / 模型解析 / context 可写性 / 拖动事件 / 工作区探测
POST /plugins/dsh-loupe/explain   解释调用（SSE：meta / thinking / first / delta / done / error）
GET  /plugins/dsh-loupe/history   历史（最新在前；文件超过 8MB 只读尾部）
GET  /plugins/dsh-loupe/context   读上下文
POST /plugins/dsh-loupe/context   写上下文（64 KB 上限）
POST /plugins/dsh-loupe/pin       保存成正式会话（客户端会话服务不可用时的兜底）
```

代码结构：

```
lib/index.js       宿主半端 —— 路由 / prompt 组装 / 流式解析 / 落盘（只 import Node 内置模块）
lib/client.js      界面半端 —— 划词 / 浮标 / 浮窗 / 四个页签（手写模块，无构建步骤）
cordis.patch.yml   bundle 补丁
docs/              实施与修复记录，含「保存」链路的复盘
```

改代码前值得知道：宿主半端不热重载（改 `lib/index.js` 要重启 profile），界面半端刷新页面即可。

</details>

## 卸载

```bash
dsh plugin --profile <profile> remove dsh-loupe
```

`~/.dsh/loupe/` 不会自动删除。想彻底清干净就手动删掉它——那是卸载后唯一会留下的东西。

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

Issue 和 PR 都欢迎。

## 许可证

[MIT](./LICENSE)

<div align="center">
<sub>loupe = 钟表匠的寸镜，用来看清一处细节。</sub>
</div>
