import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ModelCost, ModelCostRate } from "../../../../protocol/providers.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { FormField } from "./FormField.tsx";

type ModelPricingFieldsProps = {
    cost: ModelCost;
    disabled: boolean;
    onChange: (cost: ModelCost) => void;
};

const BASE_RATE_FIELDS = [
    ["input", "settings.providers.priceInput"],
    ["output", "settings.providers.priceOutput"],
    ["cacheRead", "settings.providers.priceCacheRead"],
    ["cacheWrite", "settings.providers.priceCacheWrite"]
] as const satisfies ReadonlyArray<
    readonly [keyof ModelCostRate, string]
>;

export function ModelPricingFields({
    cost,
    disabled,
    onChange
}: ModelPricingFieldsProps) {
    const { t } = useTranslation();

    function updateRate(key: keyof ModelCostRate, value: number): void {
        onChange({ ...cost, [key]: value });
    }

    function updateTier(index: number, patch: Partial<ModelCostRate & {
        inputTokensAbove: number;
    }>): void {
        const tiers = (cost.tiers ?? []).map((tier, tierIndex) => (
            tierIndex === index ? { ...tier, ...patch } : tier
        ));
        onChange({ ...cost, tiers });
    }

    function removeTier(index: number): void {
        onChange({
            ...cost,
            tiers: (cost.tiers ?? []).filter((_tier, tierIndex) => tierIndex !== index)
        });
    }

    function addTier(): void {
        const previous = cost.tiers?.at(-1)?.inputTokensAbove ?? 0;
        const threshold = previous > 0
            ? Math.ceil(previous * 1.5 / 1_000) * 1_000
            : 200_000;
        onChange({
            ...cost,
            tiers: [
                ...(cost.tiers ?? []),
                {
                    inputTokensAbove: threshold,
                    input: cost.input,
                    output: cost.output,
                    cacheRead: cost.cacheRead,
                    cacheWrite: cost.cacheWrite
                }
            ]
        });
    }

    return (
        <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
                {t("settings.providers.priceUnit")}
            </p>
            <div className="grid grid-cols-2 gap-3">
                {BASE_RATE_FIELDS.map(([key, label]) => (
                    <FormField key={key} label={t(label)}>
                        <Input
                            type="number"
                            min={0}
                            step={0.001}
                            value={cost[key]}
                            disabled={disabled}
                            onChange={(event) => updateRate(
                                key,
                                Number(event.target.value)
                            )}
                        />
                    </FormField>
                ))}
            </div>

            {(cost.tiers ?? []).map((tier, index) => (
                <div
                    key={index}
                    className="flex flex-col gap-3 rounded-xl border border-border bg-surface-subtle/60 p-3"
                >
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-foreground">
                            {t("settings.providers.priceTier", {
                                index: index + 1
                            })}
                        </span>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            disabled={disabled}
                            aria-label={t("settings.providers.removePriceTier", {
                                index: index + 1
                            })}
                            onClick={() => removeTier(index)}
                            className="text-muted-foreground hover:text-destructive"
                        >
                            <Trash2 />
                        </Button>
                    </div>
                    <FormField label={t("settings.providers.priceTierThreshold")}>
                        <Input
                            type="number"
                            min={0}
                            step={1}
                            value={tier.inputTokensAbove}
                            disabled={disabled}
                            onChange={(event) => updateTier(index, {
                                inputTokensAbove: Number(event.target.value)
                            })}
                        />
                    </FormField>
                    <div className="grid grid-cols-2 gap-3">
                        {BASE_RATE_FIELDS.map(([key, label]) => (
                            <FormField key={key} label={t(label)}>
                                <Input
                                    type="number"
                                    min={0}
                                    step={0.001}
                                    value={tier[key]}
                                    disabled={disabled}
                                    onChange={(event) => updateTier(index, {
                                        [key]: Number(event.target.value)
                                    })}
                                />
                            </FormField>
                        ))}
                    </div>
                </div>
            ))}

            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={addTier}
                className="self-start"
            >
                <Plus />
                {t("settings.providers.addPriceTier")}
            </Button>
        </div>
    );
}
