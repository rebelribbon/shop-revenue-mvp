export function smsDraftHref(phone: string, body: string) {
  const ios =
    typeof navigator !== "undefined" &&
    (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  return `sms:${phone.trim()}${ios ? "&" : "?"}body=${encodeURIComponent(body)}`;
}
