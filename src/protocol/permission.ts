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

const DOMAIN_PATTERN = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::\d{1,5})?$/i;

export const PERMISSION_ACTIONS = ["enable", "disable"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];
export const permissionActionSchema = z.enum(PERMISSION_ACTIONS);

export const PERMISSION_ACCESS = ["read", "write"] as const;
export type PermissionAccess = (typeof PERMISSION_ACCESS)[number];
export const permissionAccessSchema = z.enum(PERMISSION_ACCESS);

const domainSchema = z
    .string()
    .trim()
    .min(1)
    .max(260)
    .refine((value) => DOMAIN_PATTERN.test(value), "Invalid domain pattern")
    .transform((value) => value.toLowerCase());

const directorySchema = z.string().trim().min(1).max(4096);

export const permissionDomainChangeSchema = z
    .object({
        action: permissionActionSchema,
        domain: domainSchema
    })
    .strict();

export const permissionDirectoryChangeSchema = z
    .object({
        action: permissionActionSchema,
        access: permissionAccessSchema,
        path: directorySchema
    })
    .strict();

export type PermissionDomainChange = z.infer<typeof permissionDomainChangeSchema>;
export type PermissionDirectoryChange = z.infer<typeof permissionDirectoryChangeSchema>;

export const permissionGrantInputSchema = z
    .object({
        domains: z.array(permissionDomainChangeSchema).max(64),
        directories: z.array(permissionDirectoryChangeSchema).max(64)
    })
    .strict()
    .refine(
        (input) => input.domains.length > 0 || input.directories.length > 0,
        "At least one domain or directory is required"
    )
    .refine(
        (input) => !hasConflictingActions(
            input.domains,
            (change) => change.domain,
            (change) => change.action
        ),
        "A domain cannot be enabled and disabled in the same request"
    )
    .refine(
        (input) => !hasConflictingActions(
            input.directories,
            (change) => `${change.access}\0${change.path}`,
            (change) => change.action
        ),
        "A directory access cannot be enabled and disabled in the same request"
    )
    .transform((input) => ({
        domains: uniqueBy(
            input.domains,
            (change) => `${change.action}\0${change.domain}`
        ),
        directories: uniqueBy(
            input.directories,
            (change) => `${change.action}\0${change.access}\0${change.path}`
        )
    }));

export type PermissionGrantInput = z.infer<typeof permissionGrantInputSchema>;

export type PermissionRequest = PermissionGrantInput & {
    id: string;
};

export type PermissionDecision = "approved" | "cancelled";
export type PermissionRequestStatus = "pending" | PermissionDecision;

function hasConflictingActions<T>(
    changes: readonly T[],
    keyOf: (change: T) => string,
    actionOf: (change: T) => PermissionAction
): boolean {
    const actions = new Map<string, PermissionAction>();
    for (const change of changes) {
        const key = keyOf(change);
        const action = actionOf(change);
        const existing = actions.get(key);
        if (existing && existing !== action) {
            return true;
        }
        actions.set(key, action);
    }
    return false;
}

function uniqueBy<T>(values: readonly T[], keyOf: (value: T) => string): T[] {
    const seen = new Set<string>();
    return values.filter((value) => {
        const key = keyOf(value);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}
