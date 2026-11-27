import {
    _electron as electron,
    expect,
    test as base,
    type ElectronApplication,
    type Page
} from "@playwright/test";
import {
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

type Client = {
    app: ElectronApplication;
    page: Page;
    runtimeErrors: string[];
};

const test = base.extend<{ client: Client }>({
    client: async ({}, use) => {
        const profile = createProfile();
        const app = await electron.launch({
            args: [
                repoRoot,
                `--user-data-dir=${join(profile.home, "electron-profile")}`,
                ...(process.env.CI ? ["--no-sandbox"] : [])
            ],
            cwd: repoRoot,
            env: profile.environment
        });

        try {
            const page = await app.firstWindow();
            const runtimeErrors: string[] = [];
            page.on("pageerror", (error) => {
                runtimeErrors.push(error.message);
            });
            await use({ app, page, runtimeErrors });
        } finally {
            await app.close();
            rmSync(profile.home, {
                recursive: true,
                force: true,
                maxRetries: 5,
                retryDelay: 100
            });
        }
    }
});

test("boots the client with a working preload bridge", async ({ client }) => {
    const { page, runtimeErrors } = client;

    await expect(page).toHaveTitle("Jarvix");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh");
    await expect(page.getByTestId("app-shell")).toHaveAttribute("data-busy", "false");
    await expect(page.getByTestId("session-sidebar")).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByTestId("composer-form")).toBeVisible();

    const bridgeMethods = await page.evaluate(() => Object.keys(
        (window as unknown as {
            jarvix: Record<string, unknown>;
        }).jarvix
    ));
    expect(bridgeMethods).toEqual(expect.arrayContaining([
        "getConfig",
        "request",
        "createSession",
        "listSessions"
    ]));
    expect(runtimeErrors).toEqual([]);
});

test("opens settings and persists a theme change through IPC", async ({ client }) => {
    const { page } = client;

    await page.getByTestId("open-settings").click();
    await expect(page.getByTestId("settings-dialog")).toBeVisible();
    await page.getByTestId("settings-section-general").click();
    await page.locator("#settings-theme").click();
    await page.getByRole("option", { name: "深色" }).click();
    await page.getByTestId("settings-save").click();

    await expect(page.getByTestId("settings-dialog")).toBeHidden();
    const config = await page.evaluate(() => (
        window as unknown as {
            jarvix: {
                getConfig(): Promise<{ theme?: string }>;
            };
        }
    ).jarvix.getConfig());
    expect(config.theme).toBe("dark");
});

test("opens and closes the create project dialog", async ({ client }) => {
    const { page } = client;

    await page.getByTestId("new-project").click();
    await expect(page.getByTestId("create-project-dialog")).toBeVisible();
    await expect(page.getByTestId("project-name")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("create-project-dialog")).toBeHidden();
});

function createProfile(): {
    home: string;
    environment: Record<string, string>;
} {
    const home = mkdtempSync(join(tmpdir(), "jarvix-electron-"));
    const appData = join(home, "AppData", "Roaming");
    const localAppData = join(home, "AppData", "Local");
    const configDirectory = join(home, ".jarvix");
    mkdirSync(appData, { recursive: true });
    mkdirSync(localAppData, { recursive: true });
    mkdirSync(configDirectory, { recursive: true });
    writeFileSync(
        join(configDirectory, "config.json"),
        `${JSON.stringify({ language: "zh", theme: "light" }, null, 2)}\n`,
        "utf8"
    );

    const homeRoot = parse(home).root;
    return {
        home,
        environment: {
            ...definedEnvironment(),
            USERPROFILE: home,
            HOME: home,
            HOMEDRIVE: homeRoot.replace(/\\+$/, ""),
            HOMEPATH: home.slice(homeRoot.length - 1),
            APPDATA: appData,
            LOCALAPPDATA: localAppData,
            XDG_CONFIG_HOME: join(home, ".config"),
            ELECTRON_DISABLE_SECURITY_WARNINGS: "1"
        }
    };
}

function definedEnvironment(): Record<string, string> {
    return Object.fromEntries(
        Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined
        )
    );
}
