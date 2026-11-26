import { useEffect, useState } from "react";
import {
    Folder,
    LayoutDashboard,
    LoaderCircle,
    Sparkles
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { JarvixConfig } from "../../../../protocol/config.ts";
import type { JarvixProject } from "../../../../protocol/project.ts";
import type { JarvixSkillSettings } from "../../../../protocol/skill.ts";
import { DialogFooter } from "../common/DialogFooter.tsx";
import { NavigationItem } from "../common/NavigationItem.tsx";
import { SkillsSettings } from "../settings/SkillsSettings.tsx";
import { Button } from "../ui/button.tsx";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from "../ui/dialog.tsx";

type ProjectDetailsSection = "overview" | "skills";

type ProjectDetailsDialogProps = {
    project: JarvixProject | null;
    open: boolean;
    config: JarvixConfig | null;
    onOpenChange(open: boolean): void;
    onSaved(config: JarvixConfig): void;
};

const bridge = window.jarvix;

export function ProjectDetailsDialog({
    project,
    open,
    config,
    onOpenChange,
    onSaved
}: ProjectDetailsDialogProps) {
    const { t } = useTranslation();
    const [section, setSection] = useState<ProjectDetailsSection>("overview");
    const [skillSettings, setSkillSettings] = useState<JarvixSkillSettings>({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            setError(null);
            return;
        }
        setSection("overview");
        setSkillSettings(config?.skills ?? {});
        setError(null);
    }, [open, project?.id, config]);

    async function save(): Promise<void> {
        if (!bridge || !config || !project || saving) {
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const next = await bridge.setConfig({
                ...config,
                skills: skillSettings
            });
            onSaved(next);
            onOpenChange(false);
        } catch {
            setError(t("projects.details.saveFailed"));
        } finally {
            setSaving(false);
        }
    }

    const disabled = !bridge || !config || !project || saving;

    return (
        <Dialog open={open && project !== null} onOpenChange={onOpenChange}>
            <DialogContent
                aria-describedby={undefined}
                data-testid="project-details-dialog"
                className="h-[clamp(28rem,72dvh,46rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-4xl"
            >
                <DialogHeader className="flex h-14 justify-center border-b border-border px-6">
                    <DialogTitle>{t("projects.details.title")}</DialogTitle>
                </DialogHeader>

                <div className="flex h-full min-h-0 min-w-0">
                    <nav
                        aria-label={t("projects.details.title")}
                        className="flex w-44 shrink-0 flex-col gap-1 border-r border-border bg-sidebar p-3"
                    >
                        <NavigationItem
                            active={section === "overview"}
                            aria-current={section === "overview" ? "page" : undefined}
                            icon={<LayoutDashboard />}
                            onClick={() => setSection("overview")}
                        >
                            {t("projects.details.sections.overview")}
                        </NavigationItem>
                        <NavigationItem
                            active={section === "skills"}
                            aria-current={section === "skills" ? "page" : undefined}
                            icon={<Sparkles />}
                            onClick={() => setSection("skills")}
                        >
                            {t("projects.details.sections.skills")}
                        </NavigationItem>
                    </nav>

                    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-card p-6">
                        <div className={section === "overview" ? undefined : "hidden"}>
                            {project ? <ProjectOverview project={project} /> : null}
                        </div>
                        <div className={section === "skills" ? undefined : "hidden"}>
                            {project ? (
                                <SkillsSettings
                                    scope="project"
                                    workingDirectories={project.workingDirectories}
                                    settings={skillSettings}
                                    disabled={disabled}
                                    onChange={(next) => {
                                        setSkillSettings(next);
                                        setError(null);
                                    }}
                                />
                            ) : null}
                        </div>
                    </div>
                </div>

                <DialogFooter
                    error={error}
                    className="gap-2.5 border-t border-border bg-sidebar/50 px-6 py-3.5"
                >
                    <Button
                        type="button"
                        variant="outline"
                        disabled={saving}
                        onClick={() => onOpenChange(false)}
                    >
                        {t("projects.details.cancel")}
                    </Button>
                    <Button
                        type="button"
                        disabled={disabled}
                        onClick={() => void save()}
                    >
                        {saving ? <LoaderCircle className="animate-spin" /> : null}
                        {t("projects.details.save")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function ProjectOverview({ project }: { project: JarvixProject }) {
    const { t } = useTranslation();

    return (
        <section
            aria-labelledby="project-overview-title"
            className="flex flex-col gap-5 text-sm"
        >
            <div>
                <h3 id="project-overview-title" className="font-medium text-foreground">
                    {t("projects.details.sections.overview")}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t("projects.details.description")}
                </p>
            </div>

            <div className="flex flex-col gap-4 rounded-xl border border-border/80 bg-background px-4 py-4">
                <div>
                    <p className="text-xs text-muted-foreground">
                        {t("projects.details.name")}
                    </p>
                    <p className="mt-1 font-medium text-foreground">{project.name}</p>
                </div>

                <div>
                    <p className="text-xs text-muted-foreground">
                        {t("projects.details.workingDirectories")}
                    </p>
                    <ul className="mt-2 flex flex-col gap-1.5">
                        {project.workingDirectories.map((directory) => (
                            <li
                                key={directory}
                                className="flex items-center gap-2 rounded-lg bg-surface-subtle px-3 py-1.5"
                            >
                                <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                                <span
                                    className="min-w-0 flex-1 truncate font-mono text-xs text-foreground"
                                    title={directory}
                                >
                                    {directory}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </section>
    );
}
