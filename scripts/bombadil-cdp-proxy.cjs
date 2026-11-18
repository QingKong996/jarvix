"use strict";

const http = require("node:http");
const net = require("node:net");

function argument(name, fallback) {
    const index = process.argv.indexOf(name);
    return index === -1 ? fallback : process.argv[index + 1];
}

const listenPort = Number(argument("--listen-port", "9334"));
const targetPort = Number(argument("--target-port", "9333"));
const listenHost = argument("--listen-host", "0.0.0.0");
const targetHost = argument("--target-host", "127.0.0.1");

function rewriteDebuggerUrls(body, publicOrigin, port) {
    return body.replaceAll(
        `127.0.0.1:${port}`,
        publicOrigin
    ).replaceAll(
        `localhost:${port}`,
        publicOrigin
    );
}

function proxyHttp(request, response, targetPort, targetHost, listenHost, listenPort, onShutdown) {
    if (request.url === "/__shutdown" && onShutdown) {
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end("shutting down");
        setImmediate(onShutdown);
        return;
    }
    const headers = {
        ...request.headers,
        host: `${targetHost}:${targetPort}`
    };
    const upstream = http.request({
        host: targetHost,
        port: targetPort,
        method: request.method,
        path: request.url,
        headers
    }, (upstreamResponse) => {
        const chunks = [];
        upstreamResponse.on("data", (chunk) => chunks.push(chunk));
        upstreamResponse.on("end", () => {
            let body = Buffer.concat(chunks);
            const contentType = String(upstreamResponse.headers["content-type"] ?? "");
            if (contentType.includes("application/json")) {
                const host = request.headers.host ?? `${listenHost}:${listenPort}`;
                body = Buffer.from(
                    rewriteDebuggerUrls(body.toString("utf8"), host, targetPort)
                );
            }
            const headersOut = { ...upstreamResponse.headers };
            delete headersOut["content-length"];
            delete headersOut["transfer-encoding"];
            headersOut["content-length"] = String(body.length);
            response.writeHead(upstreamResponse.statusCode ?? 502, headersOut);
            response.end(body);
        });
    });

    upstream.on("error", (error) => {
        if (!response.headersSent) {
            response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        }
        response.end(`CDP proxy error: ${error.message}`);
    });
    request.pipe(upstream);
}

function proxyUpgrade(request, socket, head, targetPort, targetHost) {
    const upstream = net.connect(targetPort, targetHost, () => {
        const headers = {
            ...request.headers,
            host: `${targetHost}:${targetPort}`
        };
        const lines = [`${request.method} ${request.url} HTTP/1.1`];
        for (const [name, value] of Object.entries(headers)) {
            if (Array.isArray(value)) {
                for (const item of value) lines.push(`${name}: ${item}`);
            } else if (value !== undefined) {
                lines.push(`${name}: ${value}`);
            }
        }
        upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
        if (head.length > 0) {
            upstream.write(head);
        }
        upstream.pipe(socket);
        socket.pipe(upstream);
    });

    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
}

function createProxy(options = {}) {
    const listenPort = options.listenPort ?? 9334;
    const listenHost = options.listenHost ?? "0.0.0.0";
    const targetPort = options.targetPort ?? 9333;
    const targetHost = options.targetHost ?? "127.0.0.1";
    const server = http.createServer((request, response) => {
        proxyHttp(
            request,
            response,
            targetPort,
            targetHost,
            listenHost,
            listenPort,
            options.onShutdown
        );
    });
    server.on("upgrade", (request, socket, head) => {
        proxyUpgrade(request, socket, head, targetPort, targetHost);
    });
    return server;
}

module.exports = { createProxy };

if (require.main === module) {
    const server = createProxy({
        listenPort,
        listenHost,
        targetPort,
        targetHost
    });
    server.listen(listenPort, listenHost, () => {
        process.stdout.write(
            `bombadil CDP proxy listening on ${listenHost}:${listenPort} -> ${targetHost}:${targetPort}\n`
        );
    });

    function shutdown() {
        server.close(() => process.exit(0));
    }

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}
