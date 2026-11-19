import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const approvedDesigns = [
  {
    path: "design/automotive/Shop_Revenue_Automotive_Unified.html",
    sha256: "5f001635ed1662a4fc3b4c81a9fbe40be25cb3b889834551c019dbd2777d4a0e",
  },
  {
    path: "design/automotive/Shop_Revenue_Automotive_Approved.html",
    sha256: "7c62daf9d2d5e1032ed2ce8b10bea711f786877a253b34ca9ab2189b15108a8e",
  },
] as const;

describe("customer-approved Automotive UI sources", () => {
  it.each(approvedDesigns)("retains the exact approved source: $path", ({ path, sha256 }) => {
    const body = readFileSync(join(process.cwd(), path));
    expect(createHash("sha256").update(body).digest("hex")).toBe(sha256);
  });
});
