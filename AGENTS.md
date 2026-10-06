# Project instructions

## References

- 编写、修改或审查代码前，必须读取并遵循 [CODING_STANDARDS.md](CODING_STANDARDS.md)。
- 启动应用或查找开发环境、目录入口时，读取 [README.md](README.md)。依赖版本以 package manifest 为准，检查命令以项目脚本和 `.github/workflows/ci.yml` 为准。

## Project constraints

- 使用 Bun 安装 JavaScript 依赖和运行脚本，保留 `bun.lock` 作为锁文件。
- 样式优先使用 Tailwind utility classes，默认采用深色主题。
- 项目处于早期开发阶段，允许任务所需的 breaking change，不添加兼容旧接口或旧实现的代码。
