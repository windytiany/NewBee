# NewBee

NewBee 是一款面向本地音乐收藏的桌面播放器，集音乐库管理、播放与标签整理于一体。基于 Tauri、Vue 和 Rust 构建，目前提供 Windows x64 安装包。

## 特色

- 扫描音乐目录或导入音频文件，按艺人、专辑浏览本地音乐库。
- 创建播放列表，通过播放队列安排接下来收听的曲目。
- 编辑音频标签与封面，也可根据 MusicBrainz 发行版本匹配、更新专辑信息。
- 显示、编辑和在线搜索歌词。

项目处于早期开发阶段，功能仍在持续完善。

## 安装

1. 打开 [GitHub Releases](https://github.com/windytiany/NewBee/releases/latest)。
2. 在 Assets 中下载 Windows x64 的 `*-setup.exe` 安装包。
3. 运行安装包，按提示完成安装。

若系统缺少 WebView2，安装程序会联网下载并安装该运行时。

## 开发

Windows 开发环境需要：

- [Bun](https://bun.sh/) 1.4.2。
- [Rust](https://rustup.rs/) stable，使用 MSVC 工具链。
- [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，勾选“使用 C++ 的桌面开发”。
- [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)。

完整环境要求见 [Tauri 前置依赖](https://v2.tauri.app/start/prerequisites/)。

```sh
git clone https://github.com/windytiany/NewBee.git
cd NewBee
bun install --frozen-lockfile
bun run desktop:dev
```

开发版使用独立数据目录，不与安装版共享应用数据；导入同一音乐文件时，对文件的修改仍会相互影响。

## 构建

在 Windows 上构建 x64 安装包：

```sh
rustup target add x86_64-pc-windows-msvc
bun run tauri build --target x86_64-pc-windows-msvc --bundles nsis -- --locked
```

安装包输出到 `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`。

## 检查

```sh
bun run lint
bun run format:check
bun test
bun run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path src-tauri/Cargo.toml
```
