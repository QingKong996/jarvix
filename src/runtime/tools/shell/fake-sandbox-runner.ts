import { writeFileSync } from "node:fs";
import { join } from "node:path";

export type FakeSandboxRunnerOptions = {
    launch: {
        command: string;
        args: string[];
    };
    immediateViolations?: readonly string[];
    delayedViolations?: readonly {
        delayMs: number;
        line: string;
    }[];
    logPath?: string;
};

export function writeFakeSandboxRunner(
    directory: string,
    options: FakeSandboxRunnerOptions
): string {
    const runner = join(directory, "fake-sandbox-runner.mjs");
    writeFileSync(
        join(directory, "fake-sandbox-runner.json"),
        `${JSON.stringify(options)}\n`,
        "utf8"
    );
    writeFileSync(runner, [
        "import { appendFileSync, readFileSync } from 'node:fs';",
        "const config = JSON.parse(readFileSync(",
        "  new URL('./fake-sandbox-runner.json', import.meta.url),",
        "  'utf8'",
        "));",
        "const log = (line) => {",
        "  if (!config.logPath) return;",
        "  try { appendFileSync(config.logPath, `${line}\\n`); } catch {}",
        "};",
        "log('start');",
        "const timers = new Map();",
        "const send = (message, callback) => process.send?.(message, callback);",
        "process.on('message', (message) => {",
        "  if (message.type === 'prepare') {",
        "    const commandId = message.commandId;",
        "    log(`prepare:${commandId}`);",
        "    send({",
        "      type: 'prepared',",
        "      requestId: message.requestId,",
        "      commandId,",
        "      launch: {",
        "        command: config.launch.command,",
        "        args: config.launch.args,",
        "        env: process.env",
        "      }",
        "    });",
        "    for (const template of config.immediateViolations ?? []) {",
        "      send({",
        "        type: 'violations',",
        "        commandId,",
        "        violations: [{",
        "          line: template.replaceAll('{commandId}', commandId),",
        "          timestamp: Date.now()",
        "        }]",
        "      });",
        "    }",
        "    const commandTimers = [];",
        "    for (const delayed of config.delayedViolations ?? []) {",
        "      commandTimers.push(setTimeout(() => {",
        "        send({",
        "          type: 'violations',",
        "          commandId,",
        "          violations: [{",
        "            line: delayed.line.replaceAll('{commandId}', commandId),",
        "            timestamp: Date.now()",
        "          }]",
        "        });",
        "      }, delayed.delayMs));",
        "    }",
        "    timers.set(commandId, commandTimers);",
        "    return;",
        "  }",
        "  if (message.type === 'complete') {",
        "    for (const timer of timers.get(message.commandId) ?? []) {",
        "      clearTimeout(timer);",
        "    }",
        "    timers.delete(message.commandId);",
        "    send({",
        "      type: 'completed',",
        "      requestId: message.requestId,",
        "      commandId: message.commandId,",
        "      violations: []",
        "    });",
        "    return;",
        "  }",
        "  if (message.type === 'shutdown') {",
        "    log('shutdown');",
        "    send({ type: 'shutdown', requestId: message.requestId }, () => {",
        "      process.exit(0);",
        "    });",
        "  }",
        "});"
    ].join("\n"), "utf8");
    return runner;
}
