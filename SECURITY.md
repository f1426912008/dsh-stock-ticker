# Security Policy

[English](SECURITY.md) · [简体中文](#简体中文)

## Supported versions

This project is pre-1.0, so only the latest release on `main` receives security fixes.

| Version | Supported |
|---|---|
| 0.1.x | ✅ |
| < 0.1 | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/f1426912008/dsh-stock-ticker/security/advisories/new),
or by email to the address on the maintainer's GitHub profile.

Include, as far as you can:

- what the issue is and which half it affects (host `src/`, or browser `lib/client.js`);
- the DSH version and platform;
- the build stamps from the settings page footer (前端 / 宿主);
- a minimal reproduction;
- the impact you believe it has.

You can expect an acknowledgement within a few days. This is a personal, unpaid project, so please
allow reasonable time for a fix before disclosing publicly — but you will be credited in the release
notes unless you ask otherwise.

## Threat model

Understanding the intended trust boundaries makes it easier to tell a real issue from expected
behaviour.

### The host half is the trust boundary

The plugin runs **inside the harness host process**, with the host's privileges. It reads and writes
one JSON document, and it makes outbound HTTPS requests. It does not execute user input, does not
spawn processes, and does not read files other than its own settings document.

### The HTTP routes are same-origin and loopback-bound

`/api/stock-ticker/*` is served by whatever carrier the composition provides, which binds to
**loopback by default**. A deployment may widen that. The routes therefore validate every argument:

- request bodies are capped at 4 KB;
- symbol arguments must match `^(sh|sz|bj)\d{6}$`;
- search queries must be non-empty and at most 32 characters;
- the watchlist is capped at 24 entries;
- settings patches are strictly validated, so a request cannot write arbitrary keys or types into
  the settings document;
- **no user-supplied value is ever interpolated into an upstream URL unencoded** — symbol arguments
  are pattern-matched before they are used.

### The browser half never talks to the settings RPC

Configuration travels over the plugin's own route rather than the platform's settings surface. The
browser half holds no credentials and performs no privileged action on its own.

### Upstream data is untrusted

Quote payloads come from a third party and are normalized in `src/provider.js` before anything above
it sees them. Missing values arrive as `"-"`, and every field is coerced to a finite number or
dropped. Incoming strings that reach the DOM are rendered as text through React, not as markup.

### Out of scope

- **The upstream provider blocking or throttling you.** That is the provider's own policy, applied to
  your address independently of this plugin.
- **Accuracy, completeness, or timeliness of market data.** See the
  [disclaimer](README.md#disclaimer).
- **Auto-update and distribution.** The project ships no updater; installation is explicit.
- **A compromised harness or a compromised host machine.** The plugin has the privileges it is given.
- **Secrets in your own environment.** The plugin reads no environment variable other than `DSH_HOME`
  and `HOME`/`USERPROFILE` (to locate the harness home), and ships no telemetry.

### What the plugin stores

One document, `$DSH_HOME/stock-ticker.json`, containing your watchlist and display preferences. It is
written with mode `0600` and contains no credentials. When the settings-namespace backing is selected
instead, the values live in the platform's own settings document.

---

## 简体中文

### 支持的版本

本项目尚未发布 1.0，因此只有 `main` 上的最新版本会获得安全修复。

| 版本 | 是否支持 |
|---|---|
| 0.1.x | ✅ |
| < 0.1 | ❌ |

### 报告漏洞

**请不要为安全问题开公开 issue。**

请通过 GitHub 的[私密漏洞报告](https://github.com/f1426912008/dsh-stock-ticker/security/advisories/new)
私下报告，或发送邮件到维护者 GitHub 主页上的邮箱。

请尽量包含：

- 问题是什么，以及影响哪一半（宿主 `src/`，还是浏览器 `lib/client.js`）；
- DSH 版本与平台；
- 设置页页脚中的构建戳记（前端 / 宿主）；
- 最小复现步骤；
- 你认为的影响。

通常会在几天内确认。这是一个个人、无偿的项目，因此在公开披露前请留出合理的修复时间 —— 除非你另有
要求，否则会在发布说明中致谢。

### 威胁模型

了解预期的信任边界，有助于区分真实问题与预期行为。

**宿主部分是信任边界。** 插件运行在 **harness 宿主进程内**，拥有宿主的权限。它只读写一个 JSON
文档，并发出 HTTPS 出站请求。它不执行用户输入、不启动进程，除自己的设置文档外不读取其它文件。

**HTTP 路由是同源且默认绑定回环的。** `/api/stock-ticker/*` 由当前组合提供的 carrier 服务，默认
绑定 **loopback**；部署方可能放宽这一点。因此路由会校验每个参数：请求体上限 4 KB；标的参数必须
匹配 `^(sh|sz|bj)\d{6}$`；搜索关键词非空且不超过 32 字符；自选股上限 24 条；设置补丁严格校验，
请求无法把任意键或类型写入设置文档；**任何用户提供的值都不会未经编码地拼进上游 URL** —— 标的参数
在被使用前都经过模式匹配。

**浏览器端从不接触 settings RPC。** 配置经由插件自己的路由传输。浏览器端不持有任何凭据，也不自行
执行特权操作。

**上游数据是不可信的。** 行情负载来自第三方，在 `src/provider.js` 中归一化后才被上层看到。缺失值
以 `"-"` 下发，每个字段都被强制转换为有限数值或直接丢弃。进入 DOM 的字符串通过 React 以文本渲染，
而非标记。

**不在范围内：** 上游数据源对你的封锁或限流（那是数据源自身的策略）；行情数据的准确性、完整性或
及时性（见[免责声明](README.zh-CN.md#免责声明)）；自动更新与分发（本项目不带更新器，安装是显式的）；
harness 或宿主机已被攻陷的情况；你自己环境中的密钥（除 `DSH_HOME` 与 `HOME`/`USERPROFILE` 用于定位
harness home 外，插件不读取任何环境变量，也不发送任何遥测）。

**插件存储的内容：** 一个文档 `$DSH_HOME/stock-ticker.json`，包含你的自选股与显示偏好。以 `0600`
权限写入，不含任何凭据。当选用 settings 命名空间后端时，这些值位于平台自身的设置文档中。
