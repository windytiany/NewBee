# NewBee Coding Standards

适用于本项目的手写代码和测试。

## TypeScript 与 Vue

- 禁止使用 `any`，包括类型标注、泛型参数和 `as any`。未知数据使用 `unknown`，访问前通过类型守卫或解析函数收窄。
- 禁止使用 `@ts-ignore`、`@ts-nocheck` 或双重断言 `as unknown as T` 绕过类型错误。
- 保持 TypeScript 的 `strict`、`noUnusedLocals`、`noUnusedParameters` 和 `noFallthroughCasesInSwitch` 开启。修复错误时不得降低这些检查。
- 新增或修改 Vue 组件使用 `<script setup lang="ts">`。业务模块导入使用项目的 `@/` 别名，不用多级 `../` 跨功能目录访问。

## 模块依赖

- `src/shared/` 禁止导入 `src/app/` 或 `src/features/`，包括仅类型导入。
- `src/features/` 禁止导入 `src/app/`。
- 播放以外的功能禁止导入播放运行时或队列内部实现；使用播放模块暴露的 session 接口。禁止用类型断言或新增导出来获取内部可变状态。
- 禁止仅因音乐业务代码被多个功能使用，就将其移动到 `shared`。

## Tauri 与 Rust

- 新增 `invoke` 调用必须指定返回类型或使用有明确返回类型的封装。
- 修改 command 名称、参数或返回字段时，必须在同一变更中更新 Rust command、注册位置、前端调用与类型，以及对应测试替身。
- Rust command 中的同步文件 I/O 和数据库操作放入 `spawn_blocking`，不直接在异步执行线程中运行。
- Rust 代码必须兼容 `src-tauri/Cargo.toml` 声明的 edition。

## 音频文件写入

- 前端发起音频文件写入时，必须经过播放模块的 `withMetadataEditing` 或由它提供的 `editFiles` 接口；禁止另写停止、释放和恢复播放流程。
- 传给编辑接口的 ID 必须是实际写入文件的曲目 ID；纯数据库操作不得借此停止播放。
- 下载和搜索请求不得放入文件编辑回调中；先取得结果，再进入文件编辑步骤。
- 音频标签读取和写入使用 `src-tauri/src/metadata/files` 的适配入口。新增格式处理放在该模块内，不在 Vue 组件、数据库模块或批次编排中直接解析音频标签。
- 新增格式补丁时，提交内容必须同时包含最小音频 fixture 或可复现文件，以及写入后重新读取文件并断言内容的测试。数据库断言或 mock 调用断言不能代替该测试。

## 保存结果与测试

- 批量写入测试必须覆盖部分成功后发生异常，并断言每个目标的最终结果，不能只断言整体 Promise 是否成功。
- 跨文件和数据库的保存测试必须分别断言文件内容与数据库记录，并覆盖文件成功、数据库失败的情况。
- 界面刷新失败的测试必须断言已完成的保存结果仍被保留；不得仅断言出现错误提示。
- 移动或重命名模块时，同步更新测试加载器的路径和依赖映射，并运行迁移模块及其调用方的测试。旧导入路径不得残留在代码和测试中。

## 检查与例外

- 前端变更完成前通过 `bun run lint`、`bun run format:check`、`bun test` 和 `bun run build`。
- Rust 变更完成前通过项目 CI 中的 rustfmt、Cargo check、Clippy 和测试检查；Clippy 保持 `-D warnings`。具体命令以 `.github/workflows/ci.yml` 为准。
- 禁止通过删除测试断言、跳过失败测试、关闭规则或扩大忽略范围使检查通过。
- 新增 lint 抑制或 Rust lint `allow` 必须经过明确批准，并限定到最小作用域，旁边注明原因；已有抑制不构成新增抑制的依据。
- 无法执行或未通过的检查应逐项列出，不能称为已验证完成。
