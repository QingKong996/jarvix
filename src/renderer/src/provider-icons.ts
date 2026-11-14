export type ProviderIcon = {
    name: string;
    url: string;
    colored: boolean;
};

type ProviderIconCatalog = {
    icons: Map<string, ProviderIcon>;
};

type IconFile = {
    path: string;
    url: string;
};

const aliases: Record<string, string> = {
    "302ai": "ai302",
    amd: "amdradeoncloud",
    bailing: "ling",
    googlevertex: "vertexai",
    kilo: "kilocode",
    moonshotai: "moonshot",
    siliconflow: "siliconcloud",
    xiaomi: "xiaomimimo",
    zhipuai: "zhipu"
};

const iconUrls = import.meta.glob([
    "../../../node_modules/@lobehub/icons-static-svg/icons/*.svg",
    "!../../../node_modules/@lobehub/icons-static-svg/icons/*-text*.svg",
    "!../../../node_modules/@lobehub/icons-static-svg/icons/*-brand*.svg"
], {
    eager: true,
    import: "default",
    query: "?url&no-inline"
}) as Record<string, string>;

const bundledCatalog = createProviderIconCatalog(
    Object.entries(iconUrls).map(([path, url]) => ({ path, url }))
);

function normalize(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function createProviderIconCatalog(files: readonly IconFile[]): ProviderIconCatalog {
    const icons = new Map<string, ProviderIcon>();
    for (const file of files) {
        const name = /(?:^|\/)([a-z0-9-]+)\.svg$/.exec(file.path)?.[1];
        if (!name || /-(text|brand)(-|$)/.test(name)) continue;
        const key = normalize(name.replace(/-color$/, ""));
        if (!icons.has(key) || name.endsWith("-color")) {
            icons.set(key, { name, url: file.url, colored: name.endsWith("-color") });
        }
    }
    if (icons.size === 0) throw new Error("Bundled provider icon catalog is empty");
    return { icons };
}

export function resolveProviderIcon(
    id: string,
    name: string,
    catalog: ProviderIconCatalog = bundledCatalog
): ProviderIcon | undefined {
    if (id.startsWith("custom:")) return undefined;
    const candidates = [id, name.replace(/\([^)]*\)/g, "").trim()];
    for (const candidate of candidates) {
        const exact = catalog.icons.get(normalize(candidate));
        if (exact) return exact;
    }
    for (const candidate of candidates) {
        const parts = candidate.split(/[-\s]+/);
        while (parts.length > 0) {
            const key = normalize(parts.join(""));
            const icon = catalog.icons.get(key) ?? catalog.icons.get(aliases[key] ?? "");
            if (icon) return icon;
            parts.pop();
        }
    }
    return undefined;
}
