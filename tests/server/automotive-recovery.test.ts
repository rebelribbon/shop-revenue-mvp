import { beforeEach, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { GET } from "@/app/automotive/route";
import { requireShopSession } from "@/server/views/shop";
import { logger } from "@/lib/logger";

vi.mock("@/server/views/shop", () => ({ requireShopSession: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

it("returns a retryable HTML page on a workspace failure instead of an empty download", async () => {
  vi.mocked(requireShopSession).mockRejectedValueOnce(
    new Error("private database details must not be disclosed"),
  );
  const response = await GET(
    new Request("https://shop.example/automotive?ro=private-id"),
  );
  expect(response.status).toBe(503);
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("content-disposition")).toBeNull();
  const html = await response.text();
  expect(html).toContain('name="viewport"');
  expect(html).toContain('href="">Try again');
  expect(html).not.toContain("private");
  expect(logger.error).toHaveBeenCalledWith({
    event: "automotive.workspace_unavailable",
  });
});

it("preserves framework sign-in redirects instead of treating them as outages", async () => {
  vi.mocked(requireShopSession).mockImplementationOnce(async () =>
    redirect("/sign-in"),
  );
  await expect(
    GET(new Request("https://shop.example/automotive")),
  ).rejects.toMatchObject({
    digest: expect.stringContaining("NEXT_REDIRECT"),
  });
  expect(logger.error).not.toHaveBeenCalled();
});
