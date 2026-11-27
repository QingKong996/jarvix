import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argumentsList = process.argv.slice(2);
const skipBuild = process.env.JARVIX_BOMBADIL_SKIP_BUILD === "1"
    || argumentsList.includes("--skip-build");
const timeLimit = option("--time-limit")
    ?? process.env.JARVIX_BOMBADIL_TIME_LIMIT
    ?? "30s";

if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
    process.stdout.write([
        "Usage: npm run test:ui -- [options]",
        "",
        "Options:",
        "  --time-limit <duration>  bombadil run duration (default: 30s)",
        "  --skip-build             Reuse the existing out/ build",
        "",
        "Environment:",
        "  JARVIX_BOMBADIL_TIME_LIMIT  Same as --time-limit",
        "  JARVIX_BOMBADIL_SKIP_BUILD  Set to 1 to skip building",
        ""
    ].join("\n"));
    process.exit(0);
}

function option(name) {
    const inline = argumentsList.find((value) => value.startsWith(`${name}=`));
    if (inline) {
        return inline.slice(name.length + 1);
    }
    const index = argumentsList.indexOf(name);
    return index === -1 ? undefined : argumentsList[index + 1];
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: repo,
        stdio: "inherit",
        ...options
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${command} exited with code ${result.status ?? "unknown"}`);
    }
}

function windowsPath(wslPath) {
    return execFileSync("wslpath", ["-w", wslPath], { encoding: "utf8" }).trim();
}

function wslPath(windowsPathValue) {
    return execFileSync("wslpath", ["-u", windowsPathValue], { encoding: "utf8" }).trim();
}

function shellQuote(value) {
    return `'${value.replaceAll("'", "'\\''")}'`;
}

function isWsl() {
    try {
        return fs.readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft");
    } catch {
        return false;
    }
}

function findWindowsNode() {
    const override = process.env.JARVIX_WINDOWS_NODE;
    if (override) {
        return override;
    }
    const candidates = [
        "/mnt/c/Program Files/nodejs/node.exe",
        "/mnt/c/Program Files (x86)/nodejs/node.exe"
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    const output = execFileSync("cmd.exe", ["/d", "/c", "where", "node"], {
        encoding: "utf8"
    });
    const executable = output.split(/\r?\n/).find((line) => line.toLowerCase().endsWith(".exe"));
    if (!executable) {
        throw new Error("Could not locate the Windows Node.js executable.");
    }
    return wslPath(executable);
}

function wslGateway() {
    const output = execFileSync("ip", ["route", "show", "default"], { encoding: "utf8" });
    const gateway = output.match(/\bvia\s+(\S+)/)?.[1];
    if (!gateway) {
        throw new Error("Could not determine the Windows host address from WSL.");
    }
    return gateway;
}

function freePort(host) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, host, () => {
            const address = server.address();
            const port = typeof address === "object" && address ? address.port : 0;
            server.close((error) => error ? reject(error) : resolve(port));
        });
    });
}

function getJson(url) {
    return new Promise((resolve, reject) => {
        const request = http.get(url, { timeout: 3000 }, (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => {
                if ((response.statusCode ?? 500) >= 400) {
                    reject(new Error(`HTTP ${response.statusCode}`));
                    return;
                }
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
                } catch (error) {
                    reject(error);
                }
            });
        });
        request.on("timeout", () => request.destroy(
            new Error(`Timed out waiting for ${url}`)
        ));
        request.on("error", reject);
    });
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForJson(url, deadline) {
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            return await getJson(url);
        } catch (error) {
            lastError = error;
            await delay(150);
        }
    }
    throw new Error(
        `Timed out waiting for ${url}: ${lastError?.message ?? "no response"}`
    );
}

function createRunDirectory() {
    const root = path.join(repo, ".test-tmp", "bombadil");
    const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
    const runDir = path.join(root, "runs", stamp);
    fs.mkdirSync(runDir, { recursive: true });
    return runDir;
}

function writeFixture(home) {
    const fixtureRoot = path.join(repo, ".test-tmp", "bombadil");
    const resolvedHome = path.resolve(home);
    if (!resolvedHome.startsWith(`${path.resolve(fixtureRoot)}${path.sep}`)) {
        throw new Error(`Refusing to seed outside ${fixtureRoot}: ${resolvedHome}`);
    }
    fs.rmSync(resolvedHome, { recursive: true, force: true });

    const directory = path.join(resolvedHome, ".jarvix");
    const projectDirectory = path.join(directory, "projects");
    const sessionDirectory = path.join(directory, "sessions");
    const cacheDirectory = path.join(directory, "tmp");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.mkdirSync(sessionDirectory, { recursive: true });
    fs.mkdirSync(cacheDirectory, { recursive: true });

    const now = Date.now();
    const project = {
        type: "project",
        version: 1,
        id: "fixture-project",
        name: "Alpha / 桌面端",
        workingDirectories: ["C:\\Users\\Public", "C:\\Windows\\Temp"],
        createdAt: now - 4 * 60 * 60 * 1000
    };
    fs.writeFileSync(
        path.join(projectDirectory, `${project.id}.json`),
        `${JSON.stringify(project)}\n`,
        "utf8"
    );

    const config = {
        language: "zh",
        theme: "light",
        providers: [{
            id: "fixture-provider",
            name: "Fixture Provider",
            protocol: "openai-completions",
            baseUrl: "http://127.0.0.1:1/v1",
            env: [],
            apiKey: "fixture-only",
            models: [{
                id: "fixture-chat",
                name: "Fixture Chat",
                reasoning: true,
                reasoningLevels: ["low", "high"],
                contextWindow: 128000,
                maxTokens: 8192,
                input: ["text"],
                toolCall: true,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
            }]
        }],
        selectedModel: { provider: "fixture-provider", id: "fixture-chat" },
        reasoning: "high"
    };
    fs.writeFileSync(
        path.join(directory, "config.json"),
        `${JSON.stringify(config, null, 2)}\n`,
        "utf8"
    );

    const catalog = {
        version: 4,
        providers: [{
            id: "fixture-catalog",
            name: "Fixture Catalog",
            protocol: "openai-completions",
            baseUrl: "http://127.0.0.1:1/v1",
            env: [],
            models: [{
                id: "fixture-catalog-chat",
                name: "Fixture Catalog Chat",
                reasoning: false,
                contextWindow: 64000,
                maxTokens: 4096,
                input: ["text"],
                toolCall: false,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
            }]
        }],
        fetchedAt: now
    };
    fs.writeFileSync(
        path.join(cacheDirectory, "models-dev.json"),
        `${JSON.stringify(catalog)}\n`,
        "utf8"
    );

    const session = (id, name, createdAt, permission, extra = {}, messages = []) => {
        const meta = {
            type: "session",
            version: 3,
            id,
            name,
            createdAt,
            status: "active",
            permission,
            ...extra
        };
        const lines = [JSON.stringify(meta)];
        for (const message of messages) {
            lines.push(JSON.stringify({ type: "message", message }));
        }
        fs.writeFileSync(
            path.join(sessionDirectory, `${id}.jsonl`),
            `${lines.join("\n")}\n`,
            "utf8"
        );
    };

    session(
        "fixture-release",
        "发布检查 — 这是一段很长的会话名称，用来验证侧边栏截断和布局稳定性",
        now - 60 * 60 * 1000,
        "full-access",
        {},
        [{
            role: "user",
            content: "检查发布清单",
            timestamp: now - 30 * 60 * 1000
        }]
    );
    session(
        "fixture-project-session",
        "Alpha kickoff",
        now - 2 * 60 * 60 * 1000,
        "project-read-write",
        { projectId: project.id }
    );
    session(
        "fixture-temporary",
        "Quick question",
        now - 3 * 60 * 60 * 1000,
        "read-only"
    );
    session(
        "fixture-archived",
        "Archived notes",
        now - 5 * 60 * 60 * 1000,
        "auto-review",
        { status: "archived", archivedAt: now - 20 * 60 * 1000 }
    );
}

function typecheckSpecification() {
    const tsc = path.join(repo, "node_modules", "typescript", "bin", "tsc");
    if (!fs.existsSync(tsc)) {
        throw new Error("TypeScript is not installed.");
    }
    run(process.execPath, [
        tsc,
        "-p",
        path.join(repo, "tests", "bombadil", "tsconfig.json"),
        "--noEmit"
    ]);
}

function runBombadil(remoteDebugger, targetUrl, runDir) {
    const executable = path.join(
        repo,
        "node_modules",
        "@antithesishq",
        "bombadil",
        "bin",
        "bombadil.js"
    );
    const trace = path.join(runDir, "trace.jsonl");
    const specification = path.join(repo, "tests", "bombadil", "jarvix.spec.ts");
    const child = spawn(process.execPath, [
        executable,
        "browser",
        "test-external",
        "--remote-debugger",
        remoteDebugger,
        "--time-limit",
        timeLimit,
        "--exit-on-violation",
        "--output-path",
        trace,
        targetUrl,
        specification
    ], {
        cwd: repo,
        stdio: "inherit"
    });
    return new Promise((resolve) => {
        child.on("error", (error) => {
            process.stderr.write(`${error.stack ?? error}\n`);
            resolve(1);
        });
        child.on("exit", (code, signal) => {
            resolve(code ?? (signal ? 1 : 0));
        });
    });
}

async function cleanupWindowsHost(gateway, statusPath, runDir) {
    let status = null;
    try {
        status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    } catch {
        // The host may have failed before publishing its status.
    }
    const readPid = (name) => {
        try {
            const value = Number(fs.readFileSync(path.join(runDir, name), "utf8").trim());
            return Number.isInteger(value) && value > 0 ? value : null;
        } catch {
            return null;
        }
    };
    if (status?.proxyPort) {
        await new Promise((resolve) => {
            const request = http.get(
                `http://${gateway}:${status.proxyPort}/__shutdown`,
                { timeout: 1500 },
                (response) => {
                    response.resume();
                    response.on("end", resolve);
                }
            );
            request.on("timeout", () => request.destroy());
            request.on("error", resolve);
        });
    }
    const pids = new Set([
        status?.hostPid,
        status?.electronPid,
        readPid("host.pid"),
        readPid("electron.pid")
    ].filter((pid) => Number.isInteger(pid) && pid > 0));
    for (const pid of pids) {
        spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
            stdio: "ignore"
        });
    }
    const hostError = path.join(runDir, "host.error");
    if (fs.existsSync(hostError)) {
        process.stderr.write(fs.readFileSync(hostError, "utf8"));
    }
}

async function runInWsl() {
    if (!skipBuild) {
        run("cmd.exe", ["/d", "/c", "npm", "run", "build"]);
    }
    typecheckSpecification();

    const runDir = createRunDirectory();
    const home = path.join(repo, ".test-tmp", "bombadil", "home");
    writeFixture(home);
    const gateway = wslGateway();
    const statusPath = path.join(runDir, "host.json");
    const hostLog = fs.openSync(path.join(runDir, "host.log"), "a");
    const host = spawn(findWindowsNode(), [
        windowsPath(path.join(repo, "scripts", "bombadil-windows-host.cjs")),
        "--repo",
        windowsPath(repo),
        "--home",
        windowsPath(home),
        "--run-dir",
        windowsPath(runDir)
    ], {
        stdio: ["ignore", hostLog, hostLog]
    });

    let exitCode = 1;
    try {
        let status;
        const deadline = Date.now() + 35_000;
        while (Date.now() < deadline) {
            try {
                status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
                break;
            } catch {
                if (fs.existsSync(path.join(runDir, "host.error"))) {
                    throw new Error(fs.readFileSync(path.join(runDir, "host.error"), "utf8"));
                }
                await delay(200);
            }
        }
        if (!status) {
            throw new Error("Timed out waiting for the Electron host.");
        }
        const targets = await waitForJson(
            `http://${gateway}:${status.proxyPort}/json/list`,
            Date.now() + 10_000
        );
        if (!targets.some((target) => target.url === status.targetUrl)) {
            throw new Error("The Electron renderer target disappeared before the test started.");
        }
        process.stdout.write(`bombadil target: ${status.targetUrl}\n`);
        exitCode = await runBombadil(
            `http://${gateway}:${status.proxyPort}`,
            status.targetUrl,
            runDir
        );
    } finally {
        await cleanupWindowsHost(gateway, statusPath, runDir);
        try {
            process.kill(host.pid);
        } catch {
            // The host normally exits after its shutdown request.
        }
        process.stdout.write(`bombadil run: ${runDir}\n`);
    }
    process.exitCode = exitCode;
}

function electronExecutable() {
    if (process.platform === "darwin") {
        return path.join(repo, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");
    }
    return path.join(repo, "node_modules", "electron", "dist", "electron");
}

async function runNative() {
    if (!skipBuild) {
        run("npm", ["run", "build"]);
    }
    typecheckSpecification();

    const runDir = createRunDirectory();
    const home = path.join(repo, ".test-tmp", "bombadil", "home");
    writeFixture(home);
    const debugPort = await freePort("127.0.0.1");
    const profile = path.join(home, "electron-profile");
    const log = fs.openSync(path.join(runDir, "electron.log"), "a");
    const electron = spawn(electronExecutable(), [
        ".",
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profile}`,
        ...(process.env.CI ? ["--no-sandbox"] : [])
    ], {
        cwd: repo,
        env: {
            ...process.env,
            HOME: home,
            XDG_CONFIG_HOME: path.join(home, ".config")
        },
        stdio: ["ignore", log, log]
    });

    let exitCode = 1;
    try {
        const targets = await waitForJson(
            `http://127.0.0.1:${debugPort}/json/list`,
            Date.now() + 30_000
        );
        const target = targets.find((item) =>
            item.type === "page" && item.url.endsWith("/out/renderer/index.html")
        );
        if (!target) {
            throw new Error("Electron did not expose the Jarvix renderer target.");
        }
        process.stdout.write(`bombadil target: ${target.url}\n`);
        exitCode = await runBombadil(
            `http://127.0.0.1:${debugPort}`,
            target.url,
            runDir
        );
    } finally {
        electron.kill("SIGTERM");
        process.stdout.write(`bombadil run: ${runDir}\n`);
    }
    process.exitCode = exitCode;
}

async function delegateToWsl() {
    if (!skipBuild) {
        run("cmd.exe", ["/d", "/c", "npm", "run", "build"]);
    }
    const repositoryInWsl = execFileSync("wsl.exe", [
        "wslpath",
        "-a",
        repo.replaceAll("\\", "/")
    ], {
        encoding: "utf8"
    }).trim();
    const command = [
        "cd",
        shellQuote(repositoryInWsl),
        "&& node scripts/run-bombadil.mjs --skip-build",
        `--time-limit ${shellQuote(timeLimit)}`
    ].join(" ");
    run("wsl.exe", ["--exec", "bash", "-lc", command]);
}

async function main() {
    if (process.platform === "win32") {
        await delegateToWsl();
        return;
    }
    if (isWsl()) {
        await runInWsl();
        return;
    }
    await runNative();
}

main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
});
