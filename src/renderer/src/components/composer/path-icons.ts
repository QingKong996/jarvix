import {
    File,
    FileArchive,
    FileBox,
    FileBraces,
    FileCode,
    FileCog,
    FileDatabase,
    FileDiff,
    FileImage,
    FileKey,
    FileLock,
    FileMusic,
    FilePlay,
    FileSpreadsheet,
    FileTerminal,
    FileText,
    FileType,
    Folder,
    Presentation,
    type LucideIcon
} from "lucide-react";
import type { JarvixPathKind } from "../../../../protocol/path-completion.ts";

export type PathIconKind =
    | "archive"
    | "audio"
    | "binary"
    | "code"
    | "config"
    | "data"
    | "database"
    | "diff"
    | "file"
    | "folder"
    | "font"
    | "image"
    | "lock"
    | "presentation"
    | "secret"
    | "spreadsheet"
    | "terminal"
    | "text"
    | "video";

const ICONS: Record<PathIconKind, LucideIcon> = {
    archive: FileArchive,
    audio: FileMusic,
    binary: FileBox,
    code: FileCode,
    config: FileCog,
    data: FileBraces,
    database: FileDatabase,
    diff: FileDiff,
    file: File,
    folder: Folder,
    font: FileType,
    image: FileImage,
    lock: FileLock,
    presentation: Presentation,
    secret: FileKey,
    spreadsheet: FileSpreadsheet,
    terminal: FileTerminal,
    text: FileText,
    video: FilePlay
};

const NAME_ICON_KINDS = new Map<string, PathIconKind>([
    [".editorconfig", "config"],
    [".gitattributes", "config"],
    [".gitignore", "config"],
    [".npmrc", "config"],
    [".nvmrc", "config"],
    [".prettierignore", "config"],
    [".prettierrc", "config"],
    ["bun.lockb", "lock"],
    ["cargo.lock", "lock"],
    ["composer.lock", "lock"],
    ["dockerfile", "code"],
    ["gemfile", "code"],
    ["gemfile.lock", "lock"],
    ["jenkinsfile", "code"],
    ["makefile", "terminal"],
    ["package-lock.json", "lock"],
    ["pipfile.lock", "lock"],
    ["pnpm-lock.yaml", "lock"],
    ["poetry.lock", "lock"],
    ["procfile", "config"],
    ["rakefile", "code"],
    ["uv.lock", "lock"],
    ["vagrantfile", "code"],
    ["yarn.lock", "lock"]
]);

const EXTENSION_ICON_KINDS = buildExtensionMap([
    ["archive", [
        "7z", "bz2", "cab", "dmg", "ear", "gz", "iso", "jar", "lz",
        "lzma", "rar", "tar", "tbz2", "tgz", "txz", "war", "xz", "zip",
        "zst"
    ]],
    ["audio", [
        "aac", "aiff", "flac", "m4a", "mid", "midi", "mp3", "oga", "ogg",
        "opus", "wav", "wma"
    ]],
    ["binary", [
        "a", "apk", "bin", "class", "deb", "dll", "dylib", "exe", "lib",
        "msi", "o", "obj", "rpm", "so", "wasm"
    ]],
    ["code", [
        "astro", "c", "cc", "clj", "cljc", "cljs", "cpp", "cs", "cxx",
        "dart", "erl", "ex", "exs", "fs", "fsx", "go", "gql", "gradle",
        "graphql", "groovy", "h", "hh", "hpp", "hrl", "hs", "htm", "html",
        "hxx", "java", "js", "jsx", "kt", "kts", "less", "lhs", "lua",
        "mjs", "ml", "mli", "mts", "cts", "nim", "php", "prisma", "proto",
        "py", "pyw", "r", "rb", "rs", "sass", "scala", "scss", "sol",
        "svelte", "swift", "ts", "tsx", "vb", "vue", "xhtml", "zig"
    ]],
    ["config", [
        "cfg", "conf", "config", "editorconfig", "env", "ini", "properties",
        "toml", "yaml", "yml"
    ]],
    ["data", [
        "geojson", "ipynb", "json", "json5", "jsonc", "map", "ndjson",
        "plist", "xml", "xsl", "xslt"
    ]],
    ["database", [
        "accdb", "db", "db3", "mdb", "sql", "sqlite", "sqlite3"
    ]],
    ["diff", ["diff", "patch"]],
    ["font", ["eot", "otf", "ttf", "woff", "woff2"]],
    ["image", [
        "ai", "avif", "bmp", "fig", "gif", "heic", "heif", "ico", "jpeg",
        "jpg", "png", "psd", "raw", "sketch", "svg", "tif", "tiff", "webp"
    ]],
    ["lock", ["lock", "lockb"]],
    ["presentation", ["odp", "pps", "ppsx", "ppt", "pptx"]],
    ["secret", [
        "asc", "cer", "crt", "der", "gpg", "key", "kdbx", "p12", "pem",
        "pfx", "pgp"
    ]],
    ["spreadsheet", [
        "csv", "numbers", "ods", "tsv", "xls", "xlsb", "xlsm", "xlsx"
    ]],
    ["terminal", ["bash", "bat", "cmd", "fish", "nu", "ps1", "psm1", "sh", "zsh"]],
    ["text", [
        "adoc", "asciidoc", "doc", "docx", "epub", "log", "markdown", "md",
        "mdx", "odt", "org", "pages", "pdf", "rst", "rtf", "txt"
    ]],
    ["video", [
        "3gp", "avi", "flv", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg",
        "ogv", "webm", "wmv"
    ]]
]);

export function pathIconKind(
    kind: JarvixPathKind,
    nameOrPath: string
): PathIconKind {
    if (kind === "directory") {
        return "folder";
    }

    const name = fileName(nameOrPath).toLowerCase();
    const named = NAME_ICON_KINDS.get(name);
    if (named) {
        return named;
    }
    if (name.startsWith(".env")) {
        return "config";
    }
    if (name.startsWith("dockerfile")) {
        return "code";
    }
    if (name.startsWith("makefile")) {
        return "terminal";
    }
    if (/^(?:authors|changelog|contributing|license|notice|readme)(?:\.|$)/u.test(name)) {
        return "text";
    }

    const dot = name.lastIndexOf(".");
    if (dot <= 0 || dot === name.length - 1) {
        return "file";
    }
    return EXTENSION_ICON_KINDS.get(name.slice(dot + 1)) ?? "file";
}

export function pathIcon(
    kind: JarvixPathKind,
    nameOrPath: string
): LucideIcon {
    return ICONS[pathIconKind(kind, nameOrPath)];
}

function buildExtensionMap(
    groups: ReadonlyArray<readonly [PathIconKind, readonly string[]]>
): ReadonlyMap<string, PathIconKind> {
    const icons = new Map<string, PathIconKind>();
    for (const [kind, extensions] of groups) {
        for (const extension of extensions) {
            icons.set(extension, kind);
        }
    }
    return icons;
}

function fileName(nameOrPath: string): string {
    const normalized = nameOrPath.replace(/\\/gu, "/").replace(/\/+$/u, "");
    return normalized.slice(normalized.lastIndexOf("/") + 1);
}
