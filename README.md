# NewBee

NewBee 是一款面向本地音乐收藏的桌面播放器。它可以扫描和管理音乐目录，按艺人和专辑浏览曲目，创建播放列表，并通过播放队列收听和管理音乐。

## 功能

- 保存并扫描本地音乐目录，也可以直接导入音频文件。
- 按艺人、专辑浏览音乐库和曲目。
- 创建、编辑播放列表，并调整列表中的曲目顺序。
- 使用播放队列管理接下来播放的曲目。

## 技术栈

- 桌面应用：Tauri 2、Rust 2021
- 前端：Vue 3、TypeScript、Vite、Tailwind CSS
- JavaScript 包管理器：Bun

## 开发

需要安装 Bun、Rust 工具链，以及当前平台所需的 Tauri 构建依赖。

```sh
bun install
bun run tauri dev
```

## 构建与检查

```sh
bun test
bun run build
bun run lint
bun run format:check
bun run tauri build
cargo check --manifest-path src-tauri/Cargo.toml
```

## 项目结构

- `src/app/`：应用启动、页面切换、窗口壳与全局主题样式。
- `src/features/`：媒体库、歌单、播放、歌词、标签、封面和设置，每个功能拥有自己的组件与逻辑。
- `src/shared/`：无音乐业务语义的组件、交互与通知设施，不依赖 `app` 或 `features`。
- `tests/app/`、`tests/features/`、`tests/shared/`：对应模块的测试；跨模块约束放在 `tests/integration/`。
- `src-tauri/`：Tauri 配置、Rust 后端及桌面应用图标。

功能间使用明确的类型、请求、事件或组件入口，不引用其他功能的播放运行时或队列内部实现。业务代码即使被多个功能复用，也不放入 `shared`。

项目目前处于早期开发阶段，功能和内部实现可能继续调整。
