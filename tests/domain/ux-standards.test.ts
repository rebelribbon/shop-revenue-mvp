import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const css = readFileSync("src/app/globals.css", "utf8");
const luminance = (hex: string) =>
  hex
    .match(/[a-f\d]{2}/gi)!
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a: string, b: string) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
it("keeps all text palette combinations above 4.5:1 in both themes, including hover and status text", () => {
  const blocks = css.match(/:root\s*\{[^}]+\}/g)!;
  expect(blocks).toHaveLength(2);
  for (const block of blocks) {
    const tokens = Object.fromEntries(
      [...block.matchAll(/--([\w-]+):\s*(#[a-f\d]{6})/gi)].map((m) => [
        m[1],
        m[2],
      ]),
    );
    for (const fg of [
      "text",
      "muted",
      "accent",
      "accent-hover",
      "danger",
      "ok",
    ])
      for (const bg of ["bg", "surface", "hover"])
        expect(
          contrast(tokens[fg], tokens[bg]),
          `${fg} on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(tokens["accent-text"], tokens.accent),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(tokens["accent-text"], tokens["accent-hover"]),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(tokens["warn-text"], tokens["warn-bg"]),
    ).toBeGreaterThanOrEqual(4.5);
  }
});
it("uses the 8px grid for every authored margin, padding and layout gap", () => {
  const declarations = [
    ...css.matchAll(
      /(?:^|[;{])\s*((?:margin|padding|gap|row-gap|column-gap)[\w-]*)\s*:\s*([^;}]+)/gm,
    ),
  ];
  expect(declarations.length).toBeGreaterThan(40);
  for (const [, property, value] of declarations)
    for (const [, number] of value.matchAll(/(-?[\d.]+)px/g))
      expect(Math.abs(Number(number)) % 8, `${property}: ${value}`).toBe(0);
});
it("provides immediate hover, focus and reduced-motion treatment and a 65ch prose measure", () => {
  expect(css).toContain("--reading-width: 65ch");
  expect(css).toContain(":focus-visible");
  expect(css).toContain("prefers-reduced-motion");
  for (const [, duration] of css.matchAll(/(\d+)ms/g))
    expect(Number(duration)).toBeLessThan(100);
});
