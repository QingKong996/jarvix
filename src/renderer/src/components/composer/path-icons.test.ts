import { File, FileCode, FileText, Folder } from "lucide-react";
import { expect, test } from "vitest";
import { pathIcon, pathIconKind } from "./path-icons.ts";

test.each([
    ["directory", "src", "folder"],
    ["file", "main.ts", "code"],
    ["file", "C:\\repo\\src\\types.d.ts", "code"],
    ["file", "README.md", "text"],
    ["file", "LICENSE", "text"],
    ["file", "config.yaml", "config"],
    ["file", ".env.local", "config"],
    ["file", "package.json", "data"],
    ["file", "photo.PNG", "image"],
    ["file", "clip.mp4", "video"],
    ["file", "track.flac", "audio"],
    ["file", "bundle.tar.gz", "archive"],
    ["file", "report.xlsx", "spreadsheet"],
    ["file", "slides.pptx", "presentation"],
    ["file", "app.sqlite", "database"],
    ["file", "server.pem", "secret"],
    ["file", "font.woff2", "font"],
    ["file", "deploy.sh", "terminal"],
    ["file", "changes.patch", "diff"],
    ["file", "app.exe", "binary"],
    ["file", "pnpm-lock.yaml", "lock"],
    ["file", "unknown.xyz", "file"]
] as const)("maps %s %s to the %s icon category", (kind, name, expected) => {
    expect(pathIconKind(kind, name)).toBe(expected);
});

test("uses type-specific icons and falls back to the generic file icon", () => {
    expect(pathIcon("directory", "src")).toBe(Folder);
    expect(pathIcon("file", "main.ts")).toBe(FileCode);
    expect(pathIcon("file", "README.md")).toBe(FileText);
    expect(pathIcon("file", "unknown.xyz")).toBe(File);
});
