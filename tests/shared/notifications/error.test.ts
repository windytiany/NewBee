import { afterEach, expect, it } from "bun:test";
import { errorMessage } from "@/shared/notifications/error";
import { setLocale } from "@/shared/i18n/locale";

afterEach(() => setLocale("zh-CN"));

it("uses concise command messages rather than diagnostic details", () => {
  const failure = {
    code: "write_busy",
    message: "数据写入或备份任务正在运行",
    detail: "internal lock unavailable",
  };
  expect(errorMessage(failure, "扫描失败")).toBe("数据写入或备份任务正在运行");
  setLocale("en");
  expect(errorMessage(failure, "Scan failed")).toBe("A data write or backup task is running");
});

it("retains useful short legacy errors", () => {
  expect(errorMessage(new Error("permission denied"), "扫描失败")).toBe("permission denied");
  expect(errorMessage("数据写入或备份任务正在运行，请稍后重试", "扫描失败")).toBe(
    "数据写入或备份任务正在运行，请稍后重试",
  );
});

it("does not expose multiline errors, paths, SQL, credentials or arbitrary objects", () => {
  for (const reason of [
    new Error("broken\nstack"),
    "x".repeat(121),
    "failed at D:/Music/song.flac",
    "failed at /home/user/song.flac",
    "SELECT * FROM tracks",
    "https://server/failure",
    "token=secret",
    { response: "private" },
  ]) {
    expect(errorMessage(reason, "扫描失败")).toBe("扫描失败");
  }
});
