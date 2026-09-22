# dsh-loupe

划词解释浮窗 for DeepSeek Harness —— **选中即弹、独立通道、不污染主会话、可保存成正式会话**。

> loupe = 钟表匠的寸镜，用来看清一处细节。

## 状态

功能完整（2026-09-22），全部经真机验证：

| 能力 | 说明 |
| --- | --- |
| 划词 → 浮标 | 选中即弹，锚在选区下方（解释 / 设置） |
| 独立浮窗 | 单实例、多轮、流式 markdown、可拖拽、位置记忆 |
| 独立通道 | 只发一次 `llm.stream`：不建会话、不写会话日志、不注册工具 |
| 上下文注入 | `context.md` 可编辑 + 自动累积 + 字符预算 |
| 历史 | 全量留档（`history.jsonl`）、面板翻阅、一键复原回浮窗 |
| 参数 | 推理档 / 邻域条数 / 上下文上限 / 自动累积开关 |
| 保存 | 选工作区 → 建档 → 投递，成为左侧列表里的正式会话 |
| 诊断页 | 宿主能力、拖动事件计数、工作区探测结论 |

## 它做什么

在 DSH 会话里选中任意文字，选区下方浮出两个入口：

- **解释** —— 打开浮动窗（单实例）：显示选中文字、预填提问句的输入框、流式 markdown 回答，可多轮追问。
- **设置** —— 四个页签：历史 / 参数 / 上下文 / 诊断。

浮窗可拖拽（位置记忆）、可从历史恢复（带「←」返回键）、可把整段对话「保存」成正式会话。

## 为什么不是又一个侧边聊天

| | 侧边对话（sidenote / better-sidebar） | **dsh-loupe** |
| --- | --- | --- |
| 是否建会话 | 是（真 fork，全量历史快照） | **否**——只发一次 `llm.stream` |
| 关掉之后 | 变归档会话，要捞回来 | 只关窗口，内容进插件历史 |
| 首轮上下文 | 主会话全量历史（几十万 token 量级） | 选区 + 所在消息 + ≤1500 token 插件上下文 |
| 会话列表 | 每次开一个都要收拾 | 不产生任何会话垃圾 |

## 上下文策略

**快靠减法，准靠加法**：不塞 agent 全量上下文（省 token、降首字延迟），只加一份受预算约束的插件上下文。

`~/.dsh/loupe/context.md` 是常驻上下文（术语表、风格指令、累积结论）。它被放在 prompt 的**稳定前缀**里，吃宿主的 prompt 缓存。

自动累积会把「选区 → 结论摘要」写进该文件的受控区块（注释标记隔开，不碰手写内容；最新在前，便于截断时保住最近的条目）。可在参数页关闭。

浮窗底部常驻一行注入统计：`选区 N 字 · 所在消息 M 字 · 插件上下文 K 字`——解释变差时能立刻判断是不是上下文的锅。

## 零配置

插件的模型调用**走宿主已有的 llm 服务**（默认跟随 `agent-default-model`），不需要填任何 API key。

解释默认用 **off** 推理档：实测同一问题 off 首字 544ms、总 1.7s；low 首字 2806ms、总 4.3s（约 5 倍差距）。觉得答得浅可在参数页调回。

host 半端只 import Node 内置模块，不解析任何第三方包。

## 安装

```sh
dsh plugin --profile web add link:<此目录>
```

host 半端不热重载（改动需重启 DSH）；client 半端刷新页面即可。

## 接口

```
GET  /plugins/dsh-loupe/probe     宿主能力诊断（llm / model 解析 / context / 拖动事件 / 工作区探测）
POST /plugins/dsh-loupe/explain   解释调用（SSE：meta / thinking / first / delta / done / error）
GET  /plugins/dsh-loupe/history   历史（最新在前，超过 8MB 只读尾部）
GET  /plugins/dsh-loupe/context   读上下文
POST /plugins/dsh-loupe/context   写上下文（64 KB 上限）
POST /plugins/dsh-loupe/pin       保存成正式会话（客户端会话服务不可用时的兜底）
```

## 数据落在哪

```
~/.dsh/loupe/context.md       插件上下文（手写区 + 自动累积受控区）
~/.dsh/loupe/history.jsonl    全部问答记录（无限追加）
```

## 文件

```
lib/index.js    host 半端
lib/client.js   client 半端
PLAN.md                        实现方案
docs/M1-实施记录.md             M0 取证 + M1 落地
docs/M1-真机迭代.md             M1 阶段的四个坑（配置 / Message 字段 / 推理分片 / markdown）
docs/M2-M5-实施与修复记录.md    M2–M5 实施与修复
docs/保存链路复盘.md            「保存」踩穿的七个坑与两条工程教训
```
