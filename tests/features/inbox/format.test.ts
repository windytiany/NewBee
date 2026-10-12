import { expect, it } from "bun:test";
import { formatAddedDate } from "@/features/inbox/format";

it("formats the registration timestamp in local time to minute precision", () => {
  expect(formatAddedDate(new Date(2026, 0, 2, 3, 4, 59).getTime())).toBe("2026-01-02 03:04");
  expect(formatAddedDate(new Date(2026, 10, 12, 13, 14).getTime())).toBe("2026-11-12 13:14");
});
