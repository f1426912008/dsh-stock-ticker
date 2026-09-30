<div align="center">

# dsh-stock-ticker

**DeepSeek Harness Web GUI 的实时股票盯盘迷你窗口插件。**

一个可拖拽的 A 股自选股面板：分时曲线、悬停详情卡，外加独立的设置页 —— 以单个零依赖的
DSH 插件形式发布。

[![DeepSeek Harness Plugin](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4B6BFB?style=flat-square)](https://github.com/topics/deepseek-harness)
[![dsh-plugin](https://img.shields.io/badge/tag-dsh--plugin-8A2BE2?style=flat-square)](https://github.com/topics/dsh-plugin)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.3-339933?style=flat-square&logo=node.js&logoColor=white)](package.json)
[![Runtime dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen?style=flat-square)](#为什么没有构建步骤)

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

---

## 目录

- [功能](#功能)
- [环境要求](#环境要求)
- [安装](#安装)
- [配置](#配置)
- [HTTP 路由](#http-路由)
- [数据源与限流](#数据源与限流)
- [架构](#架构)
- [开发](#开发)
- [排查「旧代码」问题](#排查旧代码问题)
- [已知限制](#已知限制)
- [免责声明](#免责声明)
- [开源协议](#开源协议)

## 功能

### 迷你窗口

位于 `shell.overlay` 座位上的一个可拖拽、可折叠面板，逐行显示自选股。处于曲线预算内的行会绘制
分时曲线；鼠标悬停某一行会打开它的完整详情卡 —— 今开/最高/最低/昨收、成交量、成交额、换手率、
振幅、量比、总市值、流通市值、市盈率/市净率，以及涨停价 / 跌停价 —— 并且**不会**让指针下方的
列表发生重排。

**「摆放」和「固定」是两件独立的事。** 拖动标题栏会移动面板，并且仅在本次会话内保留位置。
标题栏上的图钉才是让位置持久化的动作；面板处于固定状态时它是**锁定**的：标题栏不再是拖拽手柄
（抓取光标消失），尝试移动不会有任何效果。再次点击图钉即可解锁 —— 面板停在原地并重新可拖拽 ——
或者在设置页清除固定。

图钉只跟随**持久化的固定状态**，因此它的文案始终说明「按下去会发生什么」：面板自由时显示
钉住，已固定时显示 取消钉住。它绝不会在拖拽过程中翻转，而那正是早期版本看起来像「跳到默认
角落」的原因。

- **固定写入被拒绝时，面板不会移动。** 位置会先在本地保留，直到配置段确认写入成功；因此当 Host
  拒绝该字段时（例如部署只更新了一半），面板会停在用户放置的位置。控件会如实报告固定没有生效，
  因为重新加载后位置就会丢失。
- **在更大窗口上保存的位置会先按当前窗口校正**，再被应用，所以改变窗口大小绝不会把面板甩到屏幕
  外，导致它唯一的拖拽手柄无法触及。

### 自选股设置页

一个名为 股票盯盘 的 `settings.section` 页面。可按代码或中文名搜索、添加、排序、删除标的，并可
设置多少行绘制曲线、刷新频率、面板不透明度，以及是否显示迷你窗口。

### 默认符合 A 股习惯

涨为红、跌为绿，曲线描边同理 —— 这是内地读者预期的约定，而非欧美习惯。该行为有专门的回归测试，
因为它曾是一个被上报的缺陷。

## 环境要求

| | |
|---|---|
| DeepSeek Harness | 其 Web GUI 提供 `window.__DSH_BOOT__` 并暴露 `shell.overlay` / `settings.section` 扩展座位的桌面版本 |
| Node.js | `>= 20.3`（宿主部分使用了 `AbortSignal.any`） |
| 运行时依赖 | **无** |
| 网络 | 可访问 `push2.eastmoney.com`、`push2his.eastmoney.com`、`searchapi.eastmoney.com` 的 HTTPS 出站连接 |

> 本插件面向中国 A 股市场（上海、深圳、北京），并非面向其它交易所的通用行情客户端。

## 安装

本插件是一个 bundle：一个宿主行，外加一个自动发现的浏览器端。

```sh
# 在包含 dsh-stock-ticker/ 的目录下执行
dsh plugin --profile <profile> add ./dsh-stock-ticker
```

安装到桌面版时，用应用自带的 CLI 指向对应 profile（应用内置的 CLI 位于
`/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`）：

```sh
dsh plugin --profile desktop add ./dsh-stock-ticker
```

该命令会把 bundle 追加到 `dsh.profile.bundles`，并把包链接进 profile。

### 直接从 GitHub 安装

由于本包没有构建步骤也没有依赖，直接克隆即可使用：

```sh
git clone https://github.com/f1426912008/dsh-stock-ticker.git
dsh plugin --profile desktop add ./dsh-stock-ticker
```

### 手工安装

对于应用尚未接管其组合的 profile，也可以直接在它的 `cordis.patch.yml` 中手工添加 loader 行：

```yaml
- insert:
    - id: stock-ticker
      name: dsh-stock-ticker
```

本包**没有任何运行时依赖** —— 连 harness 的 schema 库都不依赖 —— 因此用绝对路径指定入口文件的
行同样可行：

```yaml
- insert:
    - id: stock-ticker
      name: '/absolute/path/to/dsh-stock-ticker/src/index.js'
```

## 配置

持久化配置段会按当前组合能提供的最佳后端来解析：

| 后端 | 选择时机 | 数据位置 |
|---|---|---|
| settings 命名空间 | settings 服务暴露 `register(namespace, schema)` | 平台自身的设置文档，位于 `stock-ticker:` 下 |
| JSON 文档 | 其它情况（0.2 线上的常规路径） | `$DSH_HOME/stock-ticker.json`，权限 `0600` |
| 进程内存 | harness home 只读时 | 仅当前会话有效 |

浏览器端从不接触 settings RPC。Host 的 Web 设置界面只服务白名单内的内置命名空间，因此树外命名
空间会返回 `settings-not-exposed`；配置因而经由本插件自己的 `/api/stock-ticker/config` 路由传输，
设置页与迷你窗口是同一份共享镜像的两个视图。

### 设置字段

| 字段 | 默认值 | 含义 |
|---|---|---|
| `watchlist` | `[]` | 自选标的，按显示顺序排列，最多 24 个 |
| `maxCurves` | `6` | 多少行绘制分时曲线（1–24） |
| `refreshMs` | `15000` | 交易时段的轮询间隔（5000–300000） |
| `visible` | `true` | 是否挂载面板 |
| `opacity` | `1` | 面板不透明度，`0.35`–`1` |
| `pinned` | `null` | 面板放置后为 `{ left, top }` |

每个自选标的条目形如 `{ code, name, market }`，其中 `code` 为六位数字，`market` 为 `sh`、`sz`
或 `bj` 之一。

写入是**严格校验**的：未知字段或类型错误的取值会以 `400` 拒绝，而不是被静默合并 —— 因为被静默
丢弃的字段在用户看来就是「保存没生效」。

## HTTP 路由

所有路由均为同源，位于 `/api/stock-ticker` 下。

| 路由 | 请求体 | 返回 |
|---|---|---|
| `GET /config` | — | 解析后的配置段 |
| `PATCH /config` | 部分配置段 | 下一个配置段；字段非法时返回 `400` |
| `POST /quotes` | `{ secids? }` | `{ asOf, trading, throttled, quotes }`；缺省使用自选股列表 |
| `POST /trends` | `{ secid, ndays? }` | `{ points, previousClose, name }` |
| `POST /search` | `{ query }` | `{ results }` |

请求体上限为 4 KB，每个标的参数都必须匹配 `^(sh|sz|bj)\d{6}$`。

## 数据源与限流

行情来自东方财富公开的 push2 系列接口，且只在宿主进程中读取：页面无法设置该数据源要求的
`Referer` 头，而把流量留在宿主侧才能让一份缓存服务所有标签页。

价格以缩放整数形式下发（`f59` 是整行的缩放比例，百分比字段同样适用），并在 `src/provider.js`
中归一化 —— 它是唯一了解该线上格式的模块。

| 关注点 | 行为 |
|---|---|
| 行情缓存 | 开市时 8 秒，非交易时段 120 秒 |
| 分时曲线缓存 | 30 秒 |
| 搜索缓存 | 300 秒 |
| 并发去重 | 并发未命中共享同一个上游请求（按 key） |
| 上游并发 | 同时最多 3 个读取 |
| 传输重试 | 2 次尝试，400 ms 退避，且仅针对传输抖动 |
| 冷却 | 连续 4 次传输失败后，静默 45 秒不再请求 |

处于冷却期时，行情响应会带上 `throttled`，迷你窗口将其转为 行情源限流 · 显示最后数据 —— 保留
最后已知的数字，而不是用一句道歉把它们替换掉。默认值（15 秒间隔、5 秒下限）同样出于这个原因：
该数据源会限流请求过于频繁的客户端。

失败结果永远不会被缓存，因此下一次轮询会立即重试，而不是在整个 TTL 窗口内被告诉「市场坏了」。

## 架构

```
src/index.js      宿主插件主体
src/routes.js     JSON 路由及其请求校验
src/provider.js   上游行情线上格式，隔离在此
src/settings.js   配置段形状、默认值与唯一的写入校验器
src/store.js      后端选择（settings 命名空间 → 文件 → 内存）
lib/client.js     浏览器端：由 shell 提供的 loader 工厂 bundle
cordis.patch.yml  bundle 层
```

`lib/client.js` 是直接以 loader 工厂形式手写的，而非编译产物，因此本包不含构建步骤。它除了平台
种子模块（`react` 与 `@deepseek-ai/dsh-client-ui-primitives`）之外不依赖任何东西，并且以防御性
方式解析它们：所有图标均内联绘制，两个 primitive 会回退到原生元素，因此某个被改名或移除的导出
只会让一个控件降级，而不会让整个 bundle 中断。

关于后端选择、缓存层与传输策略背后的设计推理，见
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

### 为什么没有构建步骤

harness 的 schema 库是 harness 自身的 peer 依赖，而非插件的，因此安装在 harness 模块树之外的
插件无法解析它。自带一个手写校验器可以让本包安装到任何位置 —— 包括使用绝对路径的 Loader 行 ——
并且不会与 harness 的 schema 版本产生偏差。

## 开发

```sh
git clone https://github.com/f1426912008/dsh-stock-ticker.git
cd dsh-stock-ticker
npm run check     # 对每个源文件做语法检查，无需安装任何依赖
```

没有需要安装的东西，也没有需要构建的东西。完整工作流、代码风格，以及覆盖两端的端到端手工测试
矩阵，见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

### 两端的加载时机

宿主部分在 DSH **进程**启动时从磁盘读取；浏览器部分在**页面**加载时读取。因此任一端都可能比磁盘
上的代码活得更久 —— 这正是两端都带有构建戳记的原因（见下节）。

## 排查「旧代码」问题

两端版本不一致时，表现出来的更像「某个功能坏了」，而不是部署问题。设置页页脚会打印两个戳记，
让这件事永远不需要靠猜：

```
前端 2026-09-30.6 · 宿主 2026-09-30.6
```

| 现象 | 原因 | 处理 |
|---|---|---|
| **宿主 unknown** | 正在运行的宿主部分早于戳记机制 | 重启 DSH |
| **宿主 早于 前端** | 宿主运行的是比页面更旧的构建 | 重启 DSH |
| **前端 早于本仓库中的戳记** | 页面运行的是此前提供的 bundle | 强制刷新页面 |

`src/settings.js` 中的 `HOST_BUILD` 与 `lib/client.js` 中的 `CLIENT_BUILD` 会在对应端行为变更时
一并提升，因此戳记始终能标识出产生它的那次构建。

## 已知限制

- **行情数据未做归属声明，也未获得再分发许可。** 本插件读取的是面向浏览器页面的公开接口，请仅用于
  个人盯盘。
- **交易时段是近似判断的。** 交易时间仅按北京时间与工作日计算，因此遇到交易所休市只会多产生几次
  上游请求，而不会影响正确性 —— 该标志只用于驱动缓存 TTL 与刷新频率。
- **自选股上限为 24 个标的**，这也是单次请求的上限。
- **曲线预算之外的行在悬停时才拉取曲线**，因此这类行首次悬停时会先显示价格单元格，详情卡中的图表
  随后才填充。
- **没有按会话或工作区隔离**：overlay 是根作用域的，所以每个会话中的自选股都相同。
- **上游数据源会封锁过于频繁的客户端。** 从同一地址以数秒级频率轮询，会让该地址在一段时间内被限流，
  这与本插件无关。冷却机制限制了本插件对此的「贡献」，但无法让数据源变得更宽松；当它真的封锁时，
  面板会如实说明，并继续显示最后收到的数值。
- **详情卡文案跟随应用语言环境**，通过框架的翻译器解析，并以插件自带词典作为确定性回退；插件未
  提供的语言会回退到中文。
- **迷你窗口显示的一切都来自用户自己的配置**，不存在硬编码的可调项。

## 免责声明

本项目与 DeepSeek、东方财富或任何交易所**均无关联，也未获得其背书或赞助**。「DeepSeek Harness」
与「DSH」仅用于描述本插件所扩展的宿主应用。

行情数据在运行时从第三方公开接口获取，本项目**不**对其进行再分发。数据仅供个人盯盘使用，不对其
准确性、完整性或及时性作任何担保，且**不构成投资建议**。你有责任遵守你所轮询的任何数据源的服务
条款。

## 开源协议

[MIT](LICENSE) © 2026 f1426912008
