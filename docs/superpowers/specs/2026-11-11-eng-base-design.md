# Spec: eng-base · 工程化基座（最小集）

**模块**：`eng-base`（能力地图第 3 项；用户已定**最小集**：CI 与覆盖率转 backlog）
**状态**：精简 spec（需求无歧义的配置型模块，验收标准照常）。授权记录见 SDD 台账。

## Objective

三个可独立验证的小能力，为 `canvas-core-maint` 的格式化提供工具前提：

1. **P2-8 忽略规则**：`.mimosa/`、`.v2c/`、`.video_agent/`、`.zcode/` 四个本机 agent 工具目录进 `.gitignore`（评审指出上一提交专门补忽略规则却漏了它们；当前 `git check-ignore` 对四者均不命中）。
2. **代码风格工具**：引入 prettier（唯一新增 devDependency，用户选定最小集时已含此意），配置镜像仓库既有风格（`printWidth:120, semi:true, singleQuote:true, bracketSpacing:false, trailingComma:'none', arrowParens:'avoid'`），提供 `format`/`format:check` 脚本。**本模块不全局应用格式化**（那是 `canvas-core-maint` 的裁决与执行）；仅对本轮新增文件执行一次使其达标。
3. **type-check 覆盖测试代码**（附录A infra-4 捎带）：tsconfig include 增 `tests/canvas`、`tests/browser`（.ts/.tsx），修复随之暴露的类型错误。

**捎带候补**（附录A infra-5/6：playwright 版本钉法统一、jest-dom 未使用移除）：涉及 lockfile 更新，网络可用则做，失败则挂 backlog 并记录。

## Commands

```sh
git check-ignore .mimosa .v2c .video_agent .zcode   # 任务1 验收
pnpm format:check                                    # 工具就绪性（限本轮新文件）
pnpm type-check && npx tsc --noEmit --listFiles | grep -c tests/   # 任务3 验收
pnpm test
```

## Boundaries

- Always：先 RED 后 GREEN（check-ignore / listFiles 作确定性判定）；`pnpm test` 全绿。
- Never：不在本模块全仓格式化（P2-3 属 canvas-core-maint）；不加 CI/覆盖率（backlog）；不提交。

## Success Criteria

1. `git check-ignore` 对四个目录全部命中。
2. `pnpm format:check` 通过（针对本轮新增文件集合）；`.prettierrc` 就位且镜像既有风格。
3. `pnpm type-check` 退出码 0 且 `--listFiles` 含 `tests/canvas`、`tests/browser` 下的文件；测试代码的类型错误清零。
4. `pnpm test` 退出码 0；浏览器套件不受影响（本模块不触运行时代码，跑一次确认）。
