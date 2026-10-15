## References

- 查阅 `package.json` 与 `src-tauri/Cargo.toml` 获取技术栈信息。

## Directory

- `src/app/`：应用启动、页面切换、窗口壳与全局主题样式。
- `src/features/`：音乐业务组件与逻辑。
- `src/shared/`：无音乐业务语义的组件、交互、日志与通知设施。
- `src-tauri/src/`：Rust 后端。`lib.rs` 是应用初始化与 command 注册入口，`main.rs` 是可执行入口。
- `tests/`：前端模块的测试。`tests/integration/`：跨模块约束；`tests/support/`：测试加载器及辅助设施。
- Rust 测试位于对应业务模块的 `tests/` 或模块内测试块。

## Tests and checks

Frontend：

```sh
bun run lint
bun run format:check
bun test
bun run build
```

Rust：

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path src-tauri/Cargo.toml
```
