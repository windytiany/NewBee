# 媒体库快照完整工作流验收

关联：GitHub windytiany/NewBee #6，规格 #1。验收环境：Windows，本机 dev，2026-10-08。

## 测试边界与新增覆盖

沿用既有 Tauri command、播放 session 和保存协调接口。音频使用真实 fixture，文件与数据库分别验证；数据库断言通过读取 command 获取，不检查私有表或缓存容器。文件访问及图片解码使用此前已存在的仅测试观测，不新增生产接口。

此次是已实现功能的验收 ticket。逐个先编写验收测试并执行，现有实现直接通过，未发现需要生产修复的红灯，因此未制造失败或增加重复实现。

新增 `metadata/tests/library_workflow.rs`：

- 音乐离线后通过 IPC 浏览艺人、专辑、曲目、音频属性、歌词、封面和共用编辑信息；管理歌单、重排、移除歌单项、标记跳过、迁移到不存在的路径、移除媒体库曲目。既断言返回结果，也断言文件适配层没有内容、存在性或权限访问。
- 真实 SQLite `BEGIN IMMEDIATE` 写锁注入数据库失败，不依赖内部表名或触发器。批量保存分别保留文件成功/数据库失败和缺失文件失败。通过 Lofty 回读实际文件、IPC 查询数据库；解锁重试修复快照，已成功文件不会再次改变字节。
- 完整目录扫描导入共享封面，通过发行版保存 command 替换一个目标的内嵌封面，独立回读文件，确认目录图片及另一曲目不受影响；再扫描、关闭数据库、移除音乐及目录图片、重新打开数据库，同尺寸缩略图仍可获取且没有重新解码。

增强既有测试：

- `metadata/tests/snapshot.rs` 明确断言外部改动后的修改时间与之前完全相同，同时保留相同大小与下一次扫描更新内容的断言。
- `tests/features/tags/save.test.ts` 组合文件与数据库部分成功、请求中断、界面刷新失败和刷新重试，逐目标保存结果始终保留，播放释放通过现有 session 完成。

## 验收覆盖

| #6 条件                                                      | 验证方式                                                                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 离线浏览、编辑准备及纯数据库组织操作不访问原文件             | 新增离线 IPC 工作流；既有普通/发行版编辑器测试使用相同 `get_editable_tracks` 契约                                                |
| 完整扫描、真实保存、快照更新、封面替换、跨重启复用           | 新增共享封面保存/冷启动工作流；既有快照保存、封面 IPC 和更新测试                                                                 |
| 大小与修改时间相同仍重新读取                                 | 快照扫描测试，明确断言两项相同且扫描得到新标题                                                                                   |
| 扫描失败保留快照、确认移除清缓存、歌单关系保留               | 既有快照扫描测试、目录封面扫描测试和共享封面更新测试                                                                             |
| 播放旁挂歌词与控制、预加载、自动切换、快速切歌、内嵌保存组合 | 既有 `playbackSidecar.test.ts`、`session.test.ts`、`useLyrics` 测试及 Rust sidecar command 测试；此次实际 WebView 控制验证见下节 |
| 内嵌编辑/下载不修改或持久化旁挂歌词                          | 既有 release/lyrics 保存 command 测试、真实歌词批次提交测试及 sidecar command 测试；播放器与编辑器无新增来源说明/选择/刷新       |
| 部分成功、文件成功数据库失败、刷新失败保留结果               | 新增真实数据库写锁 command 测试与前端组合测试，既有逐目标保存及下载批次失败测试                                                  |
| 安全重置并保留其他数据                                       | 删除前进程检查、独占打开及 104 个文件的 SHA-256 对比                                                                             |
| 新库实际启动、扫描、浏览、编辑、播放                         | 真实应用 WebView + 实际 command + UI 操作；非浏览器 mock                                                                         |
| 封面按需加载，不在启动装入全库图片                           | 既有冷启动封面 IPC 测试及新增冷启动工作流，无图片请求时解码观测为 0；前端既有按需封面测试                                        |

## 本机数据库重置

核对来源：`src-tauri/tauri.conf.json` 的 identifier `com.windytiany.newbee`、`lib.rs` 的 `app_data_dir().join("music-library.sqlite3")`，以及安装的 Tauri 2.12.1 Windows 路径实现。没有平台配置或 `appDirectoriesOverride`。Windows 实际 RoamingAppData 为 `C:\Users\tiany\AppData\Roaming`。

删除前通过 `Win32_Process` 确认无 `newbee.exe` 及对应 WebView；现存 WebView 属于 SearchHost 和 Notepad++，未终止它们。对存在的数据库文件独占打开成功，然后仅删除下列明确目标：

| 路径                                                                         | 删除时结果 |
| ---------------------------------------------------------------------------- | ---------- |
| `C:\Users\tiany\AppData\Roaming\com.windytiany.newbee\music-library.sqlite3` | 已删除     |
| 同路径追加 `-wal`                                                            | 不存在     |
| 同路径追加 `-shm`                                                            | 不存在     |
| 同路径追加 `-journal`                                                        | 不存在     |

没有删除数据目录，也没有进行旧 schema 迁移。开发和正式构建共用该本机曲库，均受到此次重置影响。

删除前后比较 104 个文件的 SHA-256：设置、窗口状态、日志，以及旧数据库实际配置音乐目录 `D:\Temp\tempdir` 下的文件全部未改变。日志实际位于 `C:\Users\tiany\AppData\Local\com.windytiany.newbee\logs`。

## 真实新库工作流

通过临时 Tauri 配置仅开启 WebView 的 CDP 调试，未修改提交配置、identifier 或数据路径。使用 `agent-browser` 独立 session 连接实际应用。

1. 新库成功启动，`list_album_artists` 返回空列表。通过真实 command 加入原音乐目录并完整扫描：新增 87、更新 0、跳过 14、失败 0。
2. UI 浏览四个艺人、专辑和曲目。用于实际写入的音乐是复制到系统临时目录的 `Intro.flac`，原音乐文件不参与编辑。
3. 临时副本经真实导入 command 入库，再通过临时歌单 UI 打开标签编辑器，保存标题 `Issue 6 verified copy`。UI 列表刷新，`get_track` 返回新标题，独立 `ffprobe` 回读实际 FLAC 标签也返回新标题。
4. UI 播放临时歌单。实际后端状态为 `hasAudio: true`、`isPlaying: true`，位置持续推进。播放 UI 显示实际 `.lrc` 的 `Issue 6 sidecar session`。
5. 暂停后外部改变临时 `.lrc`，UI 恢复并点击歌词跳转仍显示原会话歌词。重新播放歌单后显示 `Issue 6 next session`，验证新会话重新读取。
6. 停止临时播放，经既有 command 删除临时曲目和歌单，删除本次创建的临时音频及 `.lrc`。再通过 UI 播放原专辑并暂停，保留有效的原音乐队列。关闭本次浏览器 session，终止本次启动进程树，确认无遗留 NewBee 实例。
7. 最终本机新库保留 87 首原音乐曲目，SQLite `integrity_check` 为 `ok`。原音乐目录和设置的 SHA-256 仍未改变。窗口状态和日志因正常运行而更新，文件均保留，未作为重置目标删除。

## 完整检查与限制

以下完整检查均通过。Bun 共 616 项通过；Rust 常规测试 201 项通过、3 项默认忽略，随后单独执行这 3 项并全部通过。

- `bun run lint`、`bun run format:check`、`bun test`、`bun run build`。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`。
- `cargo check --locked --manifest-path src-tauri/Cargo.toml`。
- `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`。
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`。
- 额外执行 `cargo test --locked --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture`，通过 3 项原本忽略的测试：NetEase 实时查询、MusicBrainz/封面实时查询及本机真实音乐文件回读。设置 `NEWBEE_LYRICS_REPRO_FILE` 指向原目录音频；该测试只编辑其临时副本，并验证原文件字节不变。

实际应用验证不等于全部人工验收：保留原音量 0，未做听音确认；快速切歌、真正自动连续切换、歌词下载期间的全部竞争组合和实际发行版编辑器保存由自动化测试覆盖，未逐项做人工 UI 操作。新库没有通过正式安装包再次启动。没有把这些项目报告为人工验证完成，也没有运行完整 Tauri 安装包构建。
