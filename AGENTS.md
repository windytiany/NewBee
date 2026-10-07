# Project instructions

## References

- 编写、修改或审查代码前，必须读取并遵循 [CODING_STANDARDS.md](CODING_STANDARDS.md)。
- 启动应用或查找开发环境、目录入口时，读取 [README.md](README.md)。依赖版本以 package manifest 为准，检查命令以项目脚本和 `.github/workflows/ci.yml` 为准。

## Navigation and file organization

- 首次探索项目时，先列出 `src/`、`src-tauri/src/` 和 `tests/` 的目录结构，排除依赖、构建产物及资源文件。
- 探索尚未查看的功能时，先列出该功能子树，再搜索文件或内容。当前任务中已查看且未变化的结构不重复列出。
- 文件路径使用“所属业务 + 具体职责”命名。
- 多入口共用的业务行为放在其业务归属下，不挂在某个 UI 入口下。发现归属或命名误导时，明确提出调整，而不是通过导航文档补偿。

## Issue Tracker

- 使用 GitHub Issues，通过 `gh` CLI 查询、发布和更新；目标仓库以 `git remote` 为准。
- 可交由 agent 实施的 spec 和 tickets 标记 `ready-for-agent`。
- 从 spec 拆出的 tickets 使用 GitHub 原生 sub-issue 关系关联父 issue，并使用原生阻塞关系记录依赖；发布后核验关系和标签。

## Project constraints

- 使用 Bun 安装 JavaScript 依赖和运行脚本，保留 `bun.lock` 作为锁文件。
- 样式优先使用 Tailwind utility classes，默认采用深色主题。
- 项目处于早期开发阶段，允许任务所需的 breaking change，不添加兼容旧接口或旧实现的代码。
