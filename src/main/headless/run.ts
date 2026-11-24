import { Jarvix } from "../../core/index.ts";
import { createPiAdapter } from "../../llm/pi.ts";
import type { JarvixConfig } from "../../protocol/config.ts";
import type { PermissionRequest } from "../../protocol/permission.ts";
import { mainLogger } from "../logger.ts";
import type { HeadlessOptions } from "./options.ts";
import { finalAssistantText } from "./output.ts";

const SESSION_NAME = "Headless";

export async function runHeadless(
    options: HeadlessOptions,
    config: JarvixConfig
): Promise<number> {
    const logger = mainLogger("headless");
    const jarvix = new Jarvix({
        llm: createPiAdapter({ providers: () => config.providers }),
        config,
        logger
    });
    let sessionId: string | undefined;
    let interrupted = false;
    let streamError: string | undefined;
    let requestError: string | undefined;
    let unsubscribe = (): void => undefined;

    const interrupt = (): void => {
        interrupted = true;
        if (sessionId) {
            jarvix.stopRequest(sessionId);
        }
    };
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);

    try {
        const session = jarvix.createSession(
            { workingDirectory: options.workingDirectory },
            SESSION_NAME,
            options.permission
        );
        sessionId = session.meta.id;
        unsubscribe = jarvix.subscribe((event, eventSessionId) => {
            if (eventSessionId !== sessionId) {
                return;
            }
            if (event.type === "permission.request") {
                process.stderr.write(
                    `jarvix: denied permission request in headless mode: ${permissionSummary(event.request)}\n`
                );
                jarvix.respondPermission(eventSessionId, event.request.id, false);
            } else if (event.type === "error") {
                streamError = event.message.errorMessage
                    ?? "Model stream returned an error";
            } else if (event.type === "done" || event.type === "start") {
                streamError = undefined;
            } else if (event.type === "request.error") {
                requestError = event.error;
            }
        });

        await jarvix.request(options.prompt, sessionId);
        if (interrupted) {
            throw new Error("Interrupted");
        }
        if (requestError) {
            throw new Error(requestError);
        }
        if (streamError) {
            throw new Error(streamError);
        }

        const loaded = jarvix.loadSession(sessionId);
        const text = finalAssistantText(loaded?.messages ?? []);
        if (text.length > 0) {
            await write(process.stdout, `${text}\n`);
        }
        return 0;
    } catch (error) {
        const message = errorMessage(error);
        logger.error("Headless prompt failed", error);
        await write(process.stderr, `jarvix: ${message}\n`).catch(() => undefined);
        return interrupted ? 130 : 1;
    } finally {
        unsubscribe();
        process.off("SIGINT", interrupt);
        process.off("SIGTERM", interrupt);
        try {
            await jarvix.shutdown();
        } catch (error) {
            logger.error("Failed to shut down headless runtime", error);
        }
        if (sessionId) {
            try {
                jarvix.deleteSession(sessionId);
            } catch (error) {
                logger.warn("Failed to remove headless session", {
                    sessionId,
                    reason: errorMessage(error)
                });
            }
        }
    }
}

function permissionSummary(request: PermissionRequest): string {
    return [
        ...request.domains.map((change) => `${change.action} domain ${change.domain}`),
        ...request.directories.map(
            (change) => `${change.action} ${change.access} ${change.path}`
        )
    ].join(", ");
}

function write(stream: NodeJS.WriteStream, text: string): Promise<void> {
    return new Promise((resolve, reject) => {
        stream.write(text, (error) => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
