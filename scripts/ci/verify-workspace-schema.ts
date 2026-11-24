import { closePools, pingDatabase } from "../../src/db/tenant";

// Use the deployed app role and current schema, without reading any shop rows.
// Do not include database diagnostics or credentials in build output.
export async function verifyWorkspaceSchema() {
  try {
    await pingDatabase();
    return true;
  } catch {
    return false;
  } finally {
    await closePools();
  }
}
