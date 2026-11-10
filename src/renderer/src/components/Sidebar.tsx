import { MessageSquare, Settings } from "lucide-react";

type SidebarProps = {
    onOpenSettings: () => void;
};

function navItemClass(active: boolean): string {
    return `flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
    }`;
}

export function Sidebar({ onOpenSettings }: SidebarProps) {
    return (
        <aside className="flex h-full min-h-0 flex-col bg-secondary/20">
            <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
                <span className="text-[15px] font-semibold tracking-[0.4px]">Jarvix</span>
                <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">Electron</span>
            </div>

            <nav className="flex flex-col gap-1 p-3">
                <div aria-current="page" className={navItemClass(true)}>
                    <MessageSquare className="size-4" />
                    对话
                </div>
            </nav>

            <div className="mt-auto p-3">
                <button type="button" onClick={onOpenSettings} className={navItemClass(false)}>
                    <Settings className="size-4" />
                    设置
                </button>
            </div>
        </aside>
    );
}
