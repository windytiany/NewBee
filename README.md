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
bun run build
bun run tauri build
cargo check --manifest-path src-tauri/Cargo.toml
```

## 项目结构

- `src/`：Vue 前端与应用功能模块。
- `src-tauri/`：Tauri 配置、Rust 后端及桌面应用图标。

项目目前处于早期开发阶段，功能和内部实现可能继续调整。
