import { expect, test } from "vitest";
import { createProviderIconCatalog, resolveProviderIcon } from "./provider-icons.ts";

const catalog = createProviderIconCatalog([
    "newvendor",
    "newvendor-color",
    "agnesai-color",
    "githubcopilot",
    "minimax-color",
    "ai302",
    "siliconcloud-color",
    "ling-color"
].map((name) => ({
    path: `/icons/${name}.svg`,
    url: `/provider-icons/${name}.svg`
})));

test("matches provider IDs and names against bundled icons", () => {
    expect(resolveProviderIcon("new-vendor", "New Vendor", catalog)).toMatchObject({
        name: "newvendor-color",
        colored: true
    });
    expect(resolveProviderIcon("agnes", "Agnes AI", catalog)?.name).toBe("agnesai-color");
    expect(resolveProviderIcon("github-copilot", "GitHub Copilot", catalog)?.name).toBe("githubcopilot");
    expect(resolveProviderIcon("minimax-cn-coding-plan", "MiniMax Token Plan (China)", catalog)?.name)
        .toBe("minimax-color");
    expect(resolveProviderIcon("302ai", "302.AI", catalog)?.name).toBe("ai302");
    expect(resolveProviderIcon("bailing", "Bailing", catalog)?.name).toBe("ling-color");
    expect(resolveProviderIcon("siliconflow-cn", "SiliconFlow (China)", catalog)?.name)
        .toBe("siliconcloud-color");
    expect(resolveProviderIcon("absent", "Absent Brand", catalog)).toBeUndefined();
    expect(resolveProviderIcon("custom:newvendor", "New Vendor", catalog)).toBeUndefined();
});

test("prefers brands over shorter matches and excludes text artwork", () => {
    const icons = createProviderIconCatalog([
        { path: "/icons/example.svg", url: "/example.svg" },
        { path: "/icons/example-text.svg", url: "/example-text.svg" },
        { path: "/icons/example-brand-color.svg", url: "/example-brand-color.svg" },
        { path: "/icons/example-cloud-color.svg", url: "/example-cloud-color.svg" }
    ]);
    expect(resolveProviderIcon("example-cloud", "Example Cloud", icons)?.name).toBe("example-cloud-color");
    expect(resolveProviderIcon("example", "Example", icons)?.name).toBe("example");
    expect(() => createProviderIconCatalog([])).toThrow(/empty/);
});

test("bundles common provider icons with their color variant", () => {
    expect(resolveProviderIcon("openrouter", "OpenRouter")).toMatchObject({
        name: "openrouter-color",
        colored: true
    });
    expect(resolveProviderIcon("anthropic", "Anthropic")?.colored).toBe(false);
});
