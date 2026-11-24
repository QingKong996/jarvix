import { homedir } from "node:os";
import { join } from "node:path";

export function observabilityDirectory(): string {
  return join(homedir(), ".jarvix", "observability");
}

export function observabilityDatabasePath(
  directory = observabilityDirectory()
): string {
  return join(directory, "agent.sqlite3");
}
