import { z } from "zod";

const projectName = z.string().trim().min(1, "Project name must be non-empty");
const workingDirectory = z.string().trim().min(1, "Working directory must be non-empty");

export const createProjectInputSchema = z.object({
    name: projectName,
    workingDirectories: z.array(workingDirectory).min(1, "Project must have at least one working directory")
});

export const jarvixProjectSchema = z.object({
    type: z.literal("project"),
    version: z.number().int().positive(),
    id: z.string().trim().min(1),
    name: projectName,
    workingDirectories: z.array(workingDirectory).min(1, "Project must have at least one working directory"),
    createdAt: z.number().nonnegative()
});

export type JarvixProject = z.infer<typeof jarvixProjectSchema>;
