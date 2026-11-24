import { beforeEach, expect, it, vi } from "vitest";
import { verifyWorkspaceSchema } from "../../scripts/ci/verify-workspace-schema";
import { closePools, pingDatabase } from "@/db/tenant";

vi.mock("@/db/tenant", () => ({ pingDatabase: vi.fn(), closePools: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

it("allows a matching schema and closes the build's database connections", async () => {
  vi.mocked(pingDatabase).mockResolvedValueOnce(undefined);
  await expect(verifyWorkspaceSchema()).resolves.toBe(true);
  expect(closePools).toHaveBeenCalledOnce();
});

it("blocks a missing column and closes connections without exposing diagnostics", async () => {
  vi.mocked(pingDatabase).mockRejectedValueOnce(
    new Error("42703: private database diagnostics"),
  );
  await expect(verifyWorkspaceSchema()).resolves.toBe(false);
  expect(closePools).toHaveBeenCalledOnce();
});
