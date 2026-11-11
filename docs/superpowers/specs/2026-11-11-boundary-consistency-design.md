# Spec: boundary-consistency · 运行时边界统一出口

**模块**：`boundary-consistency`（能力地图第 4 项，评审 P1-1、P1-2、P1-3）
**状态**：默认倾向生效（用户授权按最佳实践推进）；台账 `.superpowers/sdd/2026-11-11-boundary-consistency/progress.md`

## Objective

**根因**：URL 校验、浏览器启动、路由构造散落多个入口各自实现，无单一策略出口。三个已复核事实：

| 评审项 | 位置 | 现状 |
|---|---|---|
| P1-1 回环口径不一 | `packages/cli/local-web.mjs:7-9` | 回环白名单只约束 `--url` 与 entryMode；`declarative.mjs:40` 的 baseUrl 与 `index.mjs:65` 的 preview origin 只过 webUrl（http/https 无凭据），可指向任意外网并驱动真实 Chrome |
| P1-2 Chrome 硬编码 | `packages/cli/index.mjs:34-37` | `chromium.launch({channel:'chrome'})` 覆盖 CLI 全部命令路径，无配置/环境出口 |
| P1-3 pathname 根路径假设 | `packages/capture/declarative.mjs:58` | pathname 模式 `url.pathname = spec.route` 整体覆盖——子路径部署（`https://host/app/`）无法表达；README 推荐该模式却未记录限制 |

**目标语义与默认方案**：

1. **回环边界统一**（新增 `packages/capture/web-boundary.mjs`）：单一策略出口 `assertLoopback(url, {allowRemote, message})`——主机名 ∈ {127.0.0.1, localhost, [::1]} 或 `allowRemote === true` 放行，否则抛调用方提供的中文错误。接入三处：local-web（行为不变，仅委托）、declarative baseUrl、view() 的 preview origin。**新配置字段 `allowRemoteUrls: boolean`（默认 false）** 为 yaml/json 数据配置提供显式逃生口（局域网开发服务是真实场景）。**信任边界**：`.mjs` 适配器与其 previewUrls 属可信本地代码，不受回环限制（协议写明）。
2. **浏览器通道可配**：新字段 `browserChannel: string`（默认 `'chrome'`），环境变量 `ATLAS_BROWSER_CHANNEL` 优先于配置；`openChrome` 读取两者。纯函数 `resolveBrowserChannel(config, env)` 导出供测试，非法值（非字符串/空串）中文报错。`examples/verify-viewer.mjs` 的同款硬编码保持不动（示例属可信本地代码，评审补注）。
3. **pathname 路由前缀**：新字段 `routePrefix: string`（默认 `''`），校验 `/` 开头、规范化去尾斜杠；仅 pathname 模式生效，构造处 `url.pathname = routePrefix + spec.route`——`route` 字段存构造后的完整 pathname，`matchesLocation` 对称无需改动。hash 模式忽略该字段（fragment 与部署前缀无关）。

## Commands

```sh
pnpm type-check && pnpm test && pnpm test:browser   # 模块收尾
node --test tests/declarative.test.mjs tests/browser-channel.test.mjs
```

## Project Structure

```
packages/capture/web-boundary.mjs   # 新增：回环策略单一出口
packages/capture/declarative.mjs    # baseUrl 回环 + routePrefix + allowRemoteUrls 校验
packages/cli/local-web.mjs          # 委托共享策略（行为不变）
packages/cli/index.mjs              # preview origin 接入；resolveBrowserChannel + openChrome
tests/declarative.test.mjs          # 扩展：回环拒绝/逃生、routePrefix
tests/browser-channel.test.mjs      # 新增：通道解析优先级与校验
docs/协议与适配接口.md               # 三个字段与信任边界成文
README.md                            # pathname 模式补一句 routePrefix
```

## Testing Strategy

TDD 先红后绿。declarative 层：外网 baseUrl 默认拒绝（错误含 `allowRemoteUrls` 指引）、`allowRemoteUrls:true` 放行、回环 baseUrl 不回归；routePrefix 构造对称（entry 的 pathname = 前缀+route，route 存完整值）、非法前缀报错、hash 模式忽略。通道层：env > config > 默认 'chrome' 的优先级与非法值报错。preview origin 分支：共享助手 + view() 接入，由类型检查与浏览器套件回归覆盖（server 常驻难以单测，台账记为已知缺口）。

## Boundaries

- Always：TDD；新错误文案中文可行动（含设置项名）；`pnpm test` 全绿。
- Never：不改 `.mjs` 适配器信任模型；不动 `--url` 的回环约束（隐式模式无配置可挂）；不改 examples；不提交。

## Success Criteria

1. 外网 baseUrl（yaml/json）默认拒绝且错误提示 `allowRemoteUrls`；置 true 后放行；回环 baseUrl 行为不变。
2. preview origin（yaml/json）默认限回环，`allowRemoteUrls: true` 放行；`.mjs` previewUrls 不受限。
3. `ATLAS_BROWSER_CHANNEL` 与 `browserChannel` 均可改变启动通道，优先级 env > 配置 > 'chrome'；非法值中文报错。
4. pathname 模式 `routePrefix: '/app'` 时 entry 为 `<base>/app/<route>` 且 route 匹配对称；缺省时行为与现在逐字节一致（既有用例锚定）。
5. 协议与 README 成文；`pnpm type-check`/`test`/`test:browser` 全绿。

## Assumptions

1. `allowRemoteUrls` 默认 false 是收紧——对已用局域网 baseUrl 的既有配置是破坏性变更，属有意的边界统一，逃生口与协议说明随之提供（评审方向 A）。
2. `browserChannel` 仅影响 CLI 启动路径；程序化注入 browser 的调用方（宿主工作台）不受影响。
3. routePrefix 不进 hash 模式（fragment 与部署路径正交）；未来需要再议。
