"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { createProxy } = require("./bombadil-cdp-proxy.cjs");

function argument(name, fallback) {
    const index = process.argv.indexOf(name);
    return index === -1 ? fallback : process.argv[index + 1];
}

function reservePort(host) {
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

function requestJson(port, requestPath) {
    return new Promise((resolve, reject) => {
        const request = http.get({
            host: "127.0.0.1",
            port,
            path: requestPath,
            timeout: 1500
        }, (response) => {
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
        request.on("timeout", () => request.destroy(new Error("timeout")));
        request.on("error", reject);
    });
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForTarget(port, deadline) {
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            const targets = await requestJson(port, "/json/list");
            const target = targets.find((item) =>
                item.type === "page" &&
                typeof item.url === "string" &&
                item.url.endsWith("/out/renderer/index.html")
            ) ?? targets.find((item) => item.type === "page");
            if (target?.url) {
                return target;
            }
        } catch (error) {
            lastError = error;
        }
        await delay(150);
    }
    throw lastError ?? new Error("Electron did not expose a renderer target");
}

async function waitForProxy(port, expectedOrigin, deadline) {
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            const targets = await requestJson(port, "/json/list");
            const target = targets.find((item) => item.type === "page");
            if (
                target &&
                (
                    String(target.webSocketDebuggerUrl ?? "").includes(expectedOrigin) ||
                    String(target.devtoolsFrontendUrl ?? "").includes(expectedOrigin)
                )
            ) {
                return;
            }
            lastError = new Error(
                "Proxy responded without rewriting the debugger URL to the proxy origin."
            );
        } catch (error) {
            lastError = error;
        }
        await delay(100);
    }
    throw lastError ?? new Error("CDP proxy did not become ready");
}

async function main() {
    const repo = path.resolve(argument("--repo"));
    const home = path.resolve(argument("--home"));
    const runDir = path.resolve(argument("--run-dir"));
    const hostPidPath = path.join(runDir, "host.pid");
    const electronPidPath = path.join(runDir, "electron.pid");
    const statusPath = path.join(runDir, "host.json");
    const debugPort = await reservePort("127.0.0.1");
    const proxyPort = await reservePort("0.0.0.0");
    const profile = path.join(home, "electron-profile");
    const appData = path.join(home, "AppData", "Roaming");
    const localAppData = path.join(home, "AppData", "Local");
    const homeRoot = path.parse(home).root;
    const logPath = path.join(runDir, "electron.log");
    const electronExecutable = path.join(
        repo,
        "node_modules",
        "electron",
        "dist",
        "electron.exe"
    );

    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(appData, { recursive: true });
    fs.mkdirSync(localAppData, { recursive: true });
    fs.writeFileSync(hostPidPath, `${process.pid}\n`, "utf8");

    const environment = {
        ...process.env,
        USERPROFILE: home,
        HOME: home,
        HOMEDRIVE: homeRoot.replace(/\\+$/, ""),
        HOMEPATH: home.slice(homeRoot.length - 1),
        APPDATA: appData,
        LOCALAPPDATA: localAppData,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "1"
    };
    const logFd = fs.openSync(logPath, "a");
    const electron = spawn(electronExecutable, [
        ".",
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profile}`,
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-features=CalculateNativeWinOcclusion"
    ], {
        cwd: repo,
        env: environment,
        stdio: ["ignore", logFd, logFd],
        windowsHide: false
    });

    if (!electron.pid) {
        throw new Error("Electron did not start");
    }
    fs.writeFileSync(electronPidPath, `${electron.pid}\n`, "utf8");

    let stopping = false;
    let proxy = null;
    function stop(exitCode) {
        if (stopping) {
            return;
        }
        stopping = true;
        const taskkill = path.join(
            process.env.SystemRoot ?? "C:\\Windows",
            "System32",
            "taskkill.exe"
        );
        spawnSync(taskkill, ["/PID", String(electron.pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true
        });
        proxy?.close(() => process.exit(exitCode));
        if (!proxy) {
            process.exit(exitCode);
        }
    }

    electron.on("error", (error) => {
        fs.writeFileSync(path.join(runDir, "host.error"), `${error.stack ?? error}\n`, "utf8");
        stop(1);
    });
    electron.on("exit", (code) => {
        if (!stopping) {
            fs.writeFileSync(
                path.join(runDir, "host.error"),
                `Electron exited before the test completed (code ${code ?? "unknown"}).\n`,
                "utf8"
            );
            stop(1);
        }
    });

    const target = await waitForTarget(debugPort, Date.now() + 30_000);
    proxy = createProxy({
        listenHost: "0.0.0.0",
        listenPort: proxyPort,
        targetHost: "127.0.0.1",
        targetPort: debugPort,
        onShutdown: () => stop(0)
    });
    await new Promise((resolve, reject) => {
        proxy.once("error", reject);
        proxy.listen(proxyPort, "0.0.0.0", resolve);
    });
    await waitForProxy(
        proxyPort,
        `127.0.0.1:${proxyPort}`,
        Date.now() + 5_000
    );

    fs.writeFileSync(statusPath, `${JSON.stringify({
        hostPid: process.pid,
        electronPid: electron.pid,
        debugPort,
        proxyPort,
        proxyUrl: `http://127.0.0.1:${proxyPort}`,
        targetUrl: target.url
    }, null, 2)}\n`, "utf8");
    process.stdout.write(
        `Jarvix Electron target ready: ${target.url}\n` +
        `Jarvix CDP proxy ready: 0.0.0.0:${proxyPort}\n`
    );

    process.on("SIGINT", () => stop(0));
    process.on("SIGTERM", () => stop(0));
}

main().catch((error) => {
    const runDir = argument("--run-dir");
    if (runDir) {
        try {
            fs.mkdirSync(runDir, { recursive: true });
            fs.writeFileSync(
                path.join(runDir, "host.error"),
                `${error.stack ?? error}\n`,
                "utf8"
            );
        } catch {
            // The original startup error is more useful than a logging failure.
        }
    }
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exit(1);
});
