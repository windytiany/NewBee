# Project instructions

## Tech stack

- Desktop shell: Tauri 2; Rust code and configuration live in `src-tauri/` (Rust 2021 edition).
- Frontend: Vue 3.5, TypeScript 6, Vite 8, and Tailwind CSS 4; application source lives in `src/`.
- Styling: prefer Tailwind utility classes over handwritten CSS, and use a dark theme by default.
- JavaScript package manager: Bun. Use Bun for dependency installation and scripts, and keep `bun.lock` as the lockfile.

## Development and verification

- Start the desktop app: `bun run tauri dev`.
- Verify the frontend: `bun run build`.
- When changing Rust code, verify it with `cargo check --manifest-path src-tauri/Cargo.toml`.
- Currently in early development phase, breaking change ok, NO compatibility code.
