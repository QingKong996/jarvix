import { z } from "zod";

export const PERMISSION_MODES = [
    "read-only",
    "project-read-write",
    "full-access",
    "auto-review"
] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const DEFAULT_PERMISSION_MODE: PermissionMode = "read-only";
export const permissionModeSchema = z.enum(PERMISSION_MODES);

export function permissionModeOrDefault(value: unknown): PermissionMode {
    const parsed = permissionModeSchema.safeParse(value);
    return parsed.success ? parsed.data : DEFAULT_PERMISSION_MODE;
}
