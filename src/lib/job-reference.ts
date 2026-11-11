/**
 * Immutable display reference for existing jobs while the application stores
 * jobs by UUID. The full UUID remains the authoritative unique identifier.
 * References are not sequential and must not be used as database keys.
 */
export function jobReference(id: string, automotive = false): string {
  const short = id.replaceAll("-", "").slice(0, 16).toUpperCase();
  return `${automotive ? "RO" : "JOB"}-${short}`;
}
