// Display-only formatting for stored E.164 numbers. Dependency-free so client
// components can use it. Storage and matching stay E.164 (see normalize.ts).
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : e164;
}
