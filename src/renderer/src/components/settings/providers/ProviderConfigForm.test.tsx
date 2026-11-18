import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { beforeAll, expect, test } from "vitest";
import { i18n } from "../../../../../i18n/index.ts";
import { providerConfigSchema } from "../../../../../protocol/providers.ts";
import { ProviderConfigForm } from "./ProviderConfigForm.tsx";

const provider = providerConfigSchema.parse({
    id: "test",
    name: "Test provider",
    protocol: "openai-completions",
    baseUrl: "https://example.com/v1",
    env: [],
    models: [{ id: "test-model", name: "Test model" }]
});

function render(syncingModels: boolean): string {
    return renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
            <ProviderConfigForm
                formId="provider-form"
                draft={provider}
                disabled={false}
                syncingModels={syncingModels}
                modelPanelOpen={false}
                query=""
                revealed={false}
                onQueryChange={() => undefined}
                onRevealChange={() => undefined}
                onUpdate={() => undefined}
                onAddModel={() => undefined}
                onSyncModels={() => undefined}
                onOpenModel={() => undefined}
                onRemoveModel={() => undefined}
                onSubmit={() => undefined}
            />
        </I18nextProvider>
    );
}

beforeAll(async () => {
    await i18n.changeLanguage("zh");
});

test("locks provider identity fields while a model sync is in flight", () => {
    const input = render(true).match(
        /<input[^>]*data-testid="provider-base-url"[^>]*>/
    )?.[0];

    expect(input).toContain('disabled=""');
});

test("unlocks provider identity fields after model sync finishes", () => {
    const input = render(false).match(
        /<input[^>]*data-testid="provider-base-url"[^>]*>/
    )?.[0];

    expect(input).not.toContain('disabled=""');
});
