// URL parsing strips control characters and interprets backslashes as slashes.
// Validate before parsing, then enforce the parsed origin rather than trusting a prefix.
export function safeNext(value: string | null | undefined) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\u0000-\u0020\u007f\\]/.test(value)
  )
    return "/app";
  try {
    const url = new URL(value, "https://shop.invalid");
    return url.origin === "https://shop.invalid"
      ? `${url.pathname}${url.search}${url.hash}`
      : "/app";
  } catch {
    return "/app";
  }
}
