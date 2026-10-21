import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const config = JSON.parse(await Bun.file("src-tauri/tauri.conf.json").text());
const capability = JSON.parse(await Bun.file("src-tauri/capabilities/default.json").text());
const workflow = Bun.YAML.parse(await Bun.file(".github/workflows/release.yml").text()) as {
  jobs: {
    release: {
      permissions: Record<string, string>;
      steps: Array<{
        name?: string;
        uses?: string;
        run?: string;
        env?: Record<string, string>;
        with?: Record<string, unknown>;
      }>;
    };
  };
};
const steps = workflow.jobs.release.steps;
const publish = steps.find((step) => step.name === "Publish release")!;

describe("signed Windows update release", () => {
  it("generates PR and commit notes from full history before building", () => {
    const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout@"))!;
    expect(checkout.with?.["fetch-depth"]).toBe(0);
    expect(workflow.jobs.release.permissions["pull-requests"]).toBe("read");
    const notes = steps.find((step) => step.name === "Generate release notes")!;
    expect(notes.uses).toBe("orhun/git-cliff-action@a9a95522b26fe6403f7bb24031f21fb573d0f5ff");
    expect(notes.with?.version).toBe("v2.14.2");
    expect(notes.with?.config).toBe("github-keepachangelog");
    expect(notes.with?.args).toContain("--unreleased --tag ${{ steps.version.outputs.tag }}");
    expect(notes.with?.args).toContain("--tag-pattern '^v[0-9]+\\.[0-9]+\\.[0-9]+$'");
    expect(notes.with?.args).toContain("--use-branch-tags");
    expect(notes.with?.args).toContain("--github-repo ${{ github.repository }}");
    expect(notes.env?.OUTPUT).toBe("${{ runner.temp }}/notes.md");
    expect(steps.indexOf(notes)).toBeLessThan(
      steps.findIndex((step) => step.name === "Build installer"),
    );
  });

  it("configures a public HTTPS stable feed, signature verification and minimum permissions", () => {
    expect(config.bundle.createUpdaterArtifacts).toBe(true);
    expect(config.plugins.updater.endpoints).toEqual([
      "https://github.com/windytiany/NewBee/releases/latest/download/latest.json",
    ]);
    expect(Buffer.from(config.plugins.updater.pubkey, "base64").toString()).toContain(
      "minisign public key",
    );
    expect(config.plugins.updater.windows.installMode).toBe("passive");
    expect(
      capability.permissions.filter((permission: string) => permission.startsWith("updater:")),
    ).toEqual(["updater:allow-check", "updater:allow-download", "updater:allow-install"]);
    const build = steps.find((step) => step.name === "Build installer")!;
    expect(build.env?.TAURI_SIGNING_PRIVATE_KEY).toBe("${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}");
    expect(build.env?.TAURI_SIGNING_PRIVATE_KEY_PASSWORD).toBe(
      "${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}",
    );
    expect(build.run).toContain("--bundles nsis -- --locked");
    expect(build.run).toContain("IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY)");
  });

  it.skipIf(process.platform !== "win32")(
    "publishes a valid manifest with the exact installer and signature before setting latest",
    () => {
      // PowerShell expands Windows 8.3 aliases when resolving installer paths.
      const directory = realpathSync.native(mkdtempSync(join(tmpdir(), "newbee-update-")));
      try {
        const bundles = join(
          directory,
          "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis",
        );
        mkdirSync(bundles, { recursive: true });
        const name = "newbee_0.2.0_x64-setup.exe";
        writeFileSync(join(bundles, name), "test installer");
        writeFileSync(join(bundles, `${name}.sig`), "test-signature\n");
        const script = `
$ErrorActionPreference = 'Stop'
function gh {
  $entry = ConvertTo-Json -InputObject @($args) -Compress
  Add-Content -Path (Join-Path $env:RUNNER_TEMP 'calls.jsonl') -Value $entry
  $global:LASTEXITCODE = 0
}
${publish.run}
`;
        writeFileSync(join(directory, "publish.ps1"), script);
        const result = Bun.spawnSync(["pwsh", "-NoProfile", "-File", "publish.ps1"], {
          cwd: directory,
          env: {
            ...process.env,
            RELEASE_TAG: "v0.2.0",
            GH_REPO: "windytiany/NewBee",
            GITHUB_SHA: "test-sha",
            RUNNER_TEMP: directory,
          },
        });
        expect(result.exitCode).toBe(0);
        const manifest = JSON.parse(readFileSync(join(directory, "latest.json"), "utf8"));
        expect(manifest.version).toBe("0.2.0");
        expect(Number.isFinite(Date.parse(manifest.pub_date))).toBe(true);
        expect(manifest.platforms).toEqual({
          "windows-x86_64": {
            signature: "test-signature",
            url: `https://github.com/windytiany/NewBee/releases/download/v0.2.0/${name}`,
          },
        });
        const calls = readFileSync(join(directory, "calls.jsonl"), "utf8")
          .trim()
          .split(/\r?\n/)
          .map((line) => JSON.parse(line) as string[]);
        expect(calls).toHaveLength(2);
        expect(calls[0]?.slice(0, 3)).toEqual(["release", "create", "v0.2.0"]);
        expect(calls[0]).toContain(join(bundles, name));
        expect(calls[0]).toContain(join(bundles, `${name}.sig`));
        expect(calls[0]).toContain(join(directory, "latest.json"));
        expect(calls[0]).toContain("--draft");
        expect(calls[0]).toContain("--notes-file");
        expect(calls[0]).toContain(join(directory, "notes.md"));
        expect(calls[0]).not.toContain("--generate-notes");
        expect(calls[1]).toEqual(["release", "edit", "v0.2.0", "--draft=false", "--latest"]);
        rmSync(join(bundles, `${name}.sig`));
        const unsigned = Bun.spawnSync(["pwsh", "-NoProfile", "-File", "publish.ps1"], {
          cwd: directory,
          env: {
            ...process.env,
            RELEASE_TAG: "v0.2.0",
            GH_REPO: "windytiany/NewBee",
            RUNNER_TEMP: directory,
          },
        });
        expect(unsigned.exitCode).not.toBe(0);
        expect(unsigned.stderr.toString()).toContain("Missing installer signature");
        expect(
          readFileSync(join(directory, "calls.jsonl"), "utf8").trim().split(/\r?\n/),
        ).toHaveLength(2);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
