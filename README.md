<div align="center">

<img src="assets/logo.png" alt="dsh-loupe" width="140" />

# dsh-loupe

**划词，就问。**

在 DSH 的对话里选中一个词、或者一句话，浮窗里把它讲明白——不碰你的主会话。

[![License: MIT](https://img.shields.io/badge/License-MIT-2f7de1.svg)](./LICENSE)
[![Platform: DSH web](https://img.shields.io/badge/platform-DSH%20web-334eac.svg)](#安装)
[![Zero config](https://img.shields.io/badge/setup-zero%20config-1c7a54.svg)](#零配置)
[![PRs: welcome](https://img.shields.io/badge/PRs-welcome-7096d1.svg)](#参与贡献)

</div>

---

## 划词，然后呢

读代码、读文档、读别人写的长句，总会卡在某一两个字上。以前的流程是：复制出来，切到另一个对话，粘贴，问完，再切回来。

现在少两步。选中它：

![选中一句话后，选区下方浮出「解释 / 设置」两个入口](assets/screenshot-select.png)

点「解释」，旁边浮出一个窗口。顶上那行是你选的原句，下面是解释：

![浮窗里给出解释，并把选中的原句钉在顶部](assets/screenshot-window.png)

窗口可以接着追问（它是单实例的，就一直聊下去），可以拖到顺手的位置，位置会记住。不想聊了就关掉——内容不会丢，都在设置页的「历史」里，点一条就能接着问。

设置页有四栏：**历史**（翻旧账）、**参数**、**上下文**（直接编辑那本小本子）、**诊断**（不灵的时候先看这儿）。

## 它不碰你的主会话

解释一次，插件只朝模型发**一次**请求，仅此而已——不建会话、不写会话日志、不注册工具。

所以聊完再回头看左侧列表：不会多出任何「看一眼就扔」的会话，也没有事后要清理的归档。

这条是实测过的：连续解释若干次之后，主会话日志里的 `user/message` 条目数没有变化，没有一条来自插件。

## 它带自己的上下文

这是整个插件里最值得说的一处设计。

它**不**把你的 agent 上下文拖进来（那又贵又慢），而是自己带一本小本子：`~/.dsh/loupe/context.md`。里面随你写——术语表、写作偏好、之前问出过的结论。

于是发给模型的东西只有三样：

```
你选中的那句字
└─ 它所在的那条消息（想多带几条可以调，默认只带这一条）
   └─ context.md（有字符上限，默认 2200 字）
```

小本子放在 prompt 靠前的位置而且位置固定，所以能吃到宿主的 prompt 缓存——同一本本子反复用，第二次就便宜。

**它还会自己长。** 每次解释完，插件把「选了哪句 → 得出什么结论」写进文件里一个带标记的区块，不动你手写的那部分。同一个词再问一遍，通常比第一遍更快也更准。不想要就在参数页关掉。

浮窗底下常驻一行统计，比如上面那张图里的 `687 字 · 首字 634ms · 共 2421ms`。解释得不对劲时先看这行：是上下文没喂对，还是模型没发挥。

## 想留下就保存

浮窗里的内容默认只属于浮窗。但有些解释值得进项目记录——比如你刚问清了一个只在某个仓库里成立的术语。

这时点浮窗顶上的**保存**：选一个目标工作区，确定。它就变成左侧列表里的一个**正式会话**，能正常对话、正常归档，和你手动开的一个样。工作区由你自己挑，插件不猜。

## 零配置

不用填 API key。插件直接借用宿主已有的 `llm` 服务，模型默认跟着 `agent-default-model` 走，也可以在插件配置里指定别的。

宿主半端只 import Node 内置模块，不解析任何第三方包。

## 参数

设置页「参数」里改，下一次解释就生效。

| 参数 | 默认 | 说明 |
|---|---|---|
| 推理档 | `off` | `off` / `low` / `high` / `max`。解释单段文字用不上高推理：同一个问题实测 off 首字 **544ms**、总 1.7s，low 首字 **2806ms**、总 4.3s。嫌答得浅再调 `low`。 |
| 邻域条数 | `0` | `0` / `1` / `2` / `4`。选区前后各带几条对话进 prompt。0 就是只带所在那条消息，最快最省。 |
| 玻璃质感 | `on` | `on` / `off`。浮窗和浮标的半透明 + 背景模糊。关掉是实底，拖动更跟手。 |
| 自动累积 | `on` | `on` / `off`。把每次结论沉淀进 `context.md`。 |
| 上下文上限 | `2200` | `800` / `2200` / `4000` / `8000` 字符。`context.md` 注入的长度上限。 |

## 安装

### 本地目录（推荐）

```bash
git clone https://github.com/Rice00/dsh-loupe.git
dsh plugin --profile <profile> add link:/abs/path/to/dsh-loupe
```

补丁会往 profile 里插一行（`loupe`）。**然后重启这个 profile**——宿主插件模块在进程内缓存，运行中的 harness 读不到新行。只改界面的话，刷新浏览器就够了。

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
   浮窗底部应有一行统计（N 字 · 首字 …ms · 共 …ms）。
4) 不灵就看设置页第四栏「诊断」：它会把宿主 llm 服务、模型解析、
   context.md 可写性、拖动事件计数、工作区探测结论逐项列出来。
```

## 常见问题

**会污染我的主会话吗？**
不会。只发一次模型请求，不建会话、不写会话日志、不注册工具。

**要填 API key 吗？**
不用。走宿主已有的 `llm` 服务，默认跟随 `agent-default-model`。

**为什么默认 `off` 推理档？**
解释单段文字用不上高推理。DeepSeek 只认 `off` / `low` / `high` / `max` 四档，没有 `medium`。

**关掉浮窗，内容还在吗？**
在。全在 `history.jsonl` 里，设置页「历史」点一条就能接着问。

**历史文件会越来越大吗？**
会，只追加、不重写。读取时超过 8MB 只取尾部，所以不会因为文件变大而变慢。

**玻璃质感没效果？**
需要浏览器支持 `color-mix`。不支持时自动退回实底，其余功能不受影响。

**浮窗拖不动？**
设置页「诊断」里有拖动事件计数——拖一下看数字涨不涨，就知道事件有没有传到宿主。

## 数据与接口

<details>
<summary>给要改代码或接管线的人</summary>

数据落在 `~/.dsh/loupe/`（有 `DSH_HOME` 就跟着它）：

```
context.md     插件上下文（你手写的部分 + 自动累积的带标记区块）
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
cordis.patch.yml   补丁
docs/              实施与修复记录，含「保存」链路的复盘
```

改代码前值得知道：宿主半端不热重载（改 `lib/index.js` 要重启 profile），界面半端刷新页面即可。

</details>

## 卸载

```bash
dsh plugin --profile <profile> remove dsh-loupe
```

`~/.dsh/loupe/` 不会跟着删。想彻底清干净就手动删掉它——那是卸载后唯一会留下的东西。

## 后续计划

- [x] 划词浮标（解释 / 设置）
- [x] 浮窗：多轮追问、流式 markdown、可拖拽、位置记忆
- [x] 独立通道：不建会话、不写会话日志
- [x] 自带上下文 + 自动累积
- [x] 历史留档与一键复原
- [x] 保存成正式会话（自己选工作区）
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
