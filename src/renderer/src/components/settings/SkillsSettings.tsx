import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
    JarvixSkill,
    JarvixSkillScope,
    JarvixSkillSettings
} from "../../../../protocol/skill.ts";
import { Button } from "../ui/button.tsx";
import { Switch } from "../ui/switch.tsx";

type SkillsSettingsProps = {
    scope: JarvixSkillScope;
    workingDirectories?: readonly string[];
    settings: JarvixSkillSettings;
    disabled: boolean;
    onChange: (settings: JarvixSkillSettings) => void;
};

export function SkillsSettings({
    scope,
    workingDirectories,
    settings,
    disabled,
    onChange
}: SkillsSettingsProps) {
    const { t } = useTranslation();
    const [skills, setSkills] = useState<JarvixSkill[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const directoryKey = workingDirectories?.join("\0") ?? "";
    const title = t(scope === "user" ? "skills.userTitle" : "skills.projectTitle");
    const description = t(
        scope === "user" ? "skills.userDescription" : "skills.projectDescription"
    );

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError(null);
        void window.jarvix?.listSkills(workingDirectories ?? [], scope)
            .then((next) => {
                if (active) {
                    setSkills(next);
                }
            })
            .catch((cause: unknown) => {
                if (active) {
                    setError(cause instanceof Error ? cause.message : String(cause));
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });
        return () => {
            active = false;
        };
    }, [directoryKey, scope]);

    async function refresh(): Promise<void> {
        if (!window.jarvix || loading) {
            return;
        }
        setLoading(true);
        setError(null);
        try {
            setSkills(await window.jarvix.listSkills(
                workingDirectories ?? [],
                scope
            ));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setLoading(false);
        }
    }

    function setEnabled(skill: JarvixSkill, enabled: boolean): void {
        onChange({
            ...settings,
            [skill.location]: enabled
        });
    }

    return (
        <section aria-labelledby={`${scope}-skills-title`} className="flex flex-col gap-4 text-sm">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 id={`${scope}-skills-title`} className="font-medium text-foreground">
                        {title}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {description}
                    </p>
                </div>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled || loading}
                    aria-label={t("skills.refresh")}
                    title={t("skills.refresh")}
                    onClick={() => void refresh()}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                    <RefreshCw className={loading ? "animate-spin" : undefined} />
                </Button>
            </div>

            {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}

            {!loading && skills.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-surface-subtle/60 px-4 py-8 text-center text-xs text-muted-foreground">
                    {t("skills.empty")}
                </div>
            ) : null}

            {skills.length > 0 ? (
                <ul className="divide-y divide-border/80 overflow-hidden rounded-xl border border-border/80 bg-background">
                    {skills.map((skill) => {
                        const enabled = settings[skill.location] ?? skill.enabled;
                        return (
                            <li key={skill.location} className="flex items-start gap-3 px-4 py-3">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="font-medium text-foreground">
                                            {skill.name}
                                        </span>
                                        <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                            {t(`skills.scopes.${skill.scope}`)}
                                        </span>
                                        <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                            {t(`skills.sources.${skill.source}`)}
                                        </span>
                                        {skill.disableModelInvocation ? (
                                            <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                                {t("skills.manualOnly")}
                                            </span>
                                        ) : null}
                                    </div>
                                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                        {skill.description}
                                    </p>
                                    <p
                                        className="mt-1 truncate text-[11px] text-muted-foreground/80"
                                        title={skill.location}
                                    >
                                        {skill.location}
                                    </p>
                                    {!skill.nameMatchesDirectory ? (
                                        <p className="mt-1 text-[11px] leading-relaxed text-destructive">
                                            {t("skills.nameMismatch", {
                                                name: skill.name,
                                                directory: skill.directoryName
                                            })}
                                        </p>
                                    ) : null}
                                </div>
                                <label className="flex shrink-0 cursor-pointer items-center gap-2 pt-0.5 text-xs text-muted-foreground select-none">
                                    <Switch
                                        checked={enabled}
                                        disabled={disabled}
                                        aria-label={t("skills.toggle", {
                                            name: skill.name
                                        })}
                                        onCheckedChange={(checked) => setEnabled(
                                            skill,
                                            checked
                                        )}
                                    />
                                    {t("skills.enabled")}
                                </label>
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </section>
    );
}
