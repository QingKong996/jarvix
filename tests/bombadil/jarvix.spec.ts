import { always } from "@antithesishq/bombadil";
import {
    actions,
    extract,
    getFingerprint,
    registerCustomAction,
    weighted,
    type Fingerprint
} from "@antithesishq/bombadil/browser";
import {
    noConsoleErrors,
    noHttpErrorCodes,
    noUncaughtExceptions,
    noUnhandledPromiseRejections
} from "@antithesishq/bombadil/browser/defaults/properties";

export {
    noConsoleErrors,
    noHttpErrorCodes,
    noUncaughtExceptions,
    noUnhandledPromiseRejections
};

type ClickTarget = {
    fingerprint: Fingerprint;
    point: { x: number; y: number };
};

function isVisible(window: Window, element: Element): boolean {
    const closingContent = element.closest(
        "[data-slot='dialog-content'], [data-slot='dropdown-menu-content'], [data-slot='context-menu-content']"
    );
    if (closingContent?.getAttribute("data-state") === "closed") return false;
    const style = window.getComputedStyle(element);
    if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        Number(style.opacity) === 0 ||
        element.getClientRects().length === 0
    ) {
        return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function visible(window: Window, element: Element): boolean {
    return isVisible(window, element);
}

function textForIds(document: Document, ids: string | null): string {
    if (!ids) return "";
    return ids
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
}

function labelText(document: Document, element: Element): string {
    if (element.id) {
        const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        const value = label?.textContent?.trim();
        if (value) return value;
    }
    if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
    ) {
        return [...element.labels ?? []]
            .map((label) => label.textContent?.trim() ?? "")
            .filter(Boolean)
            .join(" ");
    }
    return "";
}

function accessibleName(document: Document, element: Element): string {
    return (
        element.getAttribute("aria-label")?.trim() ||
        textForIds(document, element.getAttribute("aria-labelledby")) ||
        labelText(document, element) ||
        element.textContent?.trim() ||
        element.getAttribute("title")?.trim() ||
        ""
    );
}

function clickTarget(window: Window, element: Element): ClickTarget | null {
    if (!visible(window, element)) return null;
    const rect = element.getBoundingClientRect();
    const point = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
    };
    if (point.x < 0 || point.y < 0 || point.x > window.innerWidth || point.y > window.innerHeight) {
        return null;
    }
    const top = window.document.elementFromPoint(point.x, point.y);
    if (!top || (top !== element && !element.contains(top))) {
        return null;
    }
    return {
        fingerprint: getFingerprint(element),
        point
    };
}

function visibleElements(window: Window, selector: string): Element[] {
    return [...window.document.querySelectorAll(selector)].filter(
        (element) => visible(window, element)
    );
}

function visibleDialogs(window: Window): Element[] {
    return visibleElements(window, "[role='dialog']");
}

function hasVisibleModal(window: Window): boolean {
    return visibleDialogs(window).some(
        (element) => element.getAttribute("aria-modal") !== "false"
    );
}

function insideViewport(window: Window, rect: DOMRect, slack = 1): boolean {
    return (
        rect.left >= -slack &&
        rect.top >= -slack &&
        rect.right <= window.innerWidth + slack &&
        rect.bottom <= window.innerHeight + slack
    );
}

function inside(rect: DOMRect, outer: DOMRect, slack = 1): boolean {
    return (
        rect.left >= outer.left - slack &&
        rect.top >= outer.top - slack &&
        rect.right <= outer.right + slack &&
        rect.bottom <= outer.bottom + slack
    );
}

function settle(milliseconds = 250): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const blockedName = /添加目录|选择目录|刷新目录|同步模型|自动命名|发送|安装|永久删除|关闭|取消|add director|choose director|refresh catalog|sync model|auto name|send|install|delete permanently|close|cancel/i;
const blockedTestId = /add-directories|choose-directory|composer-send|settings-sync|install|sync|refresh|auto-name|delete-session-confirm/;

function isSafeToClick(document: Document, window: Window, element: Element): boolean {
    const testId = element.getAttribute("data-testid") ?? "";
    if (blockedTestId.test(testId)) return false;
    if (element.matches(":disabled, [aria-disabled='true'], [inert]")) return false;
    if (element.closest("[inert]")) return false;
    const name = accessibleName(document, element);
    return !blockedName.test(name);
}

const targets = extract((state) => {
    const selector = [
        "button:not([disabled])",
        "a[href]",
        "input:not([type='hidden'])",
        "textarea",
        "select",
        "[role='button']",
        "[role='checkbox']",
        "[role='combobox']",
        "[role='menuitem']",
        "[role='menuitemradio']",
        "[role='option']",
        "[role='switch']",
        "[role='tab']"
    ].join(",");
    const result: ClickTarget[] = [];
    const seen = new Set<string>();
    for (const element of state.document.querySelectorAll(selector)) {
        if (!isSafeToClick(state.document, state.window, element)) continue;
        const target = clickTarget(state.window, element);
        if (!target) continue;
        const key = JSON.stringify(target);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(target);
        if (result.length >= 60) break;
    }
    return result;
});

const uiClicks = actions(() => targets.current.map((target) => ({ Click: target })));

const sessionIds = extract((state) => {
    const sidebar = state.document.querySelector("[data-testid='session-sidebar']");
    if (!sidebar) return [];
    const ids = [...sidebar.querySelectorAll("[data-session-id]")]
        .filter((row) => row.getAttribute("data-session-status") !== "archived")
        .map((row) => row.getAttribute("data-session-id"))
        .filter((value): value is string => Boolean(value));
    return [...new Set(ids)].slice(0, 12);
});

const openSessionMenu = registerCustomAction(
    "openSessionMenu",
    async (document, window, sessionId: string) => {
        if (
            hasVisibleModal(window) ||
            visibleElements(
                window,
                "[data-slot='dropdown-menu-content'], [data-slot='context-menu-content']"
            ).length > 0
        ) {
            return;
        }
        const row = document.querySelector(`[data-session-id="${CSS.escape(sessionId)}"]`);
        const trigger = row?.querySelector("button") ?? row;
        if (!(trigger instanceof HTMLElement)) return;
        const rect = trigger.getBoundingClientRect();
        trigger.dispatchEvent(new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            button: 2,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2
        }));
        trigger.focus();
        await settle(250);
    }
);

const sessionMenus = actions(() => sessionIds.current.map((id) => openSessionMenu(id)));

const composer = extract((state) => {
    const input = state.document.querySelector<HTMLTextAreaElement>(
        "[data-testid='composer-input']"
    );
    return {
        usable: Boolean(
            input &&
            !input.disabled &&
            !hasVisibleModal(state.window)
        )
    };
});

const fillComposer = registerCustomAction(
    "fillComposer",
    async (document, window, text: string) => {
        if (hasVisibleModal(window)) return;
        const input = document.querySelector<HTMLTextAreaElement>(
            "[data-testid='composer-input']"
        );
        if (!input || input.disabled) return;
        const value = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            "value"
        )?.set;
        value?.call(input, text);
        input.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: text
        }));
        input.focus();
        await settle(50);
    }
);

const composerValues = [
    "release check",
    "你好，bombadil",
    "   ",
    "A".repeat(512)
];

const composerEditing = actions(() => {
    if (!composer.current.usable) return [];
    return [
        ...composerValues.map((text) => fillComposer(text)),
        fillComposer("")
    ];
});

const clickTestId = registerCustomAction(
    "clickTestId",
    async (
        document,
        window,
        testId: string,
        allowModal: boolean,
        pointerPress: boolean
    ) => {
        if (!allowModal && hasVisibleModal(window)) return;
        const element = document.querySelector(`[data-testid="${CSS.escape(testId)}"]`);
        if (!(element instanceof HTMLElement)) return;
        if (!visible(window, element)) return;
        if (element.matches(":disabled, [aria-disabled='true']")) return;
        if (pointerPress) {
            element.dispatchEvent(new PointerEvent("pointerdown", {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: "mouse",
                isPrimary: true,
                button: 0,
                buttons: 1
            }));
            element.dispatchEvent(new PointerEvent("pointerup", {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: "mouse",
                isPrimary: true,
                button: 0,
                buttons: 0
            }));
            element.click();
            await settle(300);
            return;
        }
        element.click();
        if (
            testId === "open-settings" ||
            testId === "new-project" ||
            testId === "session-context-trigger"
        ) {
            await settle(300);
        }
    }
);

const closeDialog = registerCustomAction(
    "closeDialog",
    async (document, window) => {
        const dialogs = visibleDialogs(window);
        const dialog = dialogs[dialogs.length - 1];
        if (!dialog) return;
        const close = dialog.querySelector<HTMLElement>("[data-testid='dialog-close']");
        if (close && !close.matches(":disabled")) {
            close.click();
            await settle(300);
        }
    }
);

const closeDialogs = actions(() => (
    documentState.current.dialogCount > 0 ? [closeDialog()] : []
));

function hasVisibleModalSafe(): boolean {
    return documentState.current.dialogCount > 0;
}

const openSettings = actions(() => (
    hasVisibleModalSafe() ? [] : [clickTestId("open-settings", false, false)]
));

const toggleRightSidebar = actions(() => {
    if (hasVisibleModalSafe()) return [];
    return documentState.current.rightSidebarOpen
        ? [clickTestId("right-sidebar-close", false, false)]
        : [clickTestId("right-sidebar-open", false, false)];
});

const openPermissionMenu = actions(() => {
    if (hasVisibleModalSafe()) return [];
    return [clickTestId("permission-menu-trigger", false, true)];
});

const openModelMenu = actions(() => {
    if (hasVisibleModalSafe()) return [];
    return [clickTestId("model-menu-trigger", false, true)];
});

const openSessionContext = actions(() => {
    if (hasVisibleModalSafe() || documentState.current.menuOpen) return [];
    return [clickTestId("session-context-trigger", false, false)];
});

const openCreateProject = actions(() => (
    hasVisibleModalSafe() ? [] : [clickTestId("new-project", false, false)]
));

const settingsSections = actions(() => {
    if (!documentState.current.settingsOpen) return [];
    return [
        clickTestId("settings-section-model", true, false),
        clickTestId("settings-section-general", true, false),
        clickTestId("settings-section-archived", true, false)
    ];
});

const escape = actions(() => [{ PressKey: { code: 27 } }]);

const viewports = actions(() => {
    const width = documentState.current.viewportWidth;
    if (width >= 1300) {
        return [{ SetViewport: { width: 760, height: 520 } }];
    }
    if (width >= 900) {
        return [{ SetViewport: { width: 1440, height: 900 } }];
    }
    return [{ SetViewport: { width: 1024, height: 768 } }];
});

const documentState = extract((state) => {
    const document = state.document;
    const window = state.window;
    const root = document.querySelector("[data-testid='app-shell']");
    const sidebar = document.querySelector("[data-testid='session-sidebar']");
    const main = document.querySelector("main");
    const visibleButtons = visibleElements(window, "button");
    const unnamedButtons = visibleButtons.filter(
        (element) => accessibleName(document, element).length === 0
    ).length;
    const fields = visibleElements(
        window,
        "input:not([type='hidden']), textarea, select"
    );
    const unnamedFields = fields.filter(
        (element) => accessibleName(document, element).length === 0
    ).length;
    const dialogs = visibleDialogs(window);
    const unnamedDialogs = dialogs.filter(
        (element) => accessibleName(document, element).length === 0
    ).length;
    const dialogsWithinViewport = dialogs.every(
        (element) => insideViewport(window, element.getBoundingClientRect())
    );
    const dialogsHaveOverlay = dialogs.length === 0 ||
        visibleElements(window, "[data-slot='dialog-overlay']").length > 0;
    const menuContents = visibleElements(
        window,
        "[data-slot='dropdown-menu-content'], [data-slot='context-menu-content']"
    );
    const menuItems = visibleElements(
        window,
        "[role='menuitem'], [role='menuitemradio']"
    );
    const unnamedMenuItems = menuItems.filter(
        (element) => accessibleName(document, element).length === 0
    ).length;
    const permissionOptions = visibleElements(window, "[role='menuitemradio']");
    const checkedPermissionOptions = permissionOptions.filter(
        (element) => element.getAttribute("aria-checked") === "true"
    ).length;
    const menusWithinViewport = menuContents.every(
        (element) => insideViewport(window, element.getBoundingClientRect())
    );
    const ids = [...document.querySelectorAll("[id]")]
        .map((element) => element.id)
        .filter(Boolean);
    const duplicateIds = ids.length - new Set(ids).size;
    const nestedInteractive = document.querySelectorAll(
        "button button, button a[href], a[href] button, [role='button'] button, button [role='button']"
    ).length;
    const horizontalOverflow =
        document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const busy = root?.getAttribute("data-busy") === "true";
    const language = document.documentElement.lang.toLowerCase();

    const sessionRows = sidebar
        ? [...sidebar.querySelectorAll("[data-session-id]")]
        : [];
    const visibleSessionRows = sessionRows.filter(
        (row) => visible(window, row)
    );
    const activeRows = visibleSessionRows.filter(
        (row) => row.querySelector("[aria-current='page']") !== null
    );
    const groupedCorrectly = sessionRows.every((row) => {
        const expected = row.getAttribute("data-session-project") ?? "temporary";
        const actual = row.closest("[data-project-group]")?.getAttribute("data-project-group");
        return actual === expected;
    });
    const archivedVisible = visibleSessionRows.some(
        (row) => row.getAttribute("data-session-status") === "archived"
    );
    const sidebarRect = sidebar?.getBoundingClientRect() ?? null;
    const sessionRowsFitSidebar = sidebarRect === null || visibleSessionRows.every(
        (row) => inside(row.getBoundingClientRect(), sidebarRect)
    );
    const activeRow = activeRows[0] ?? null;
    const contextTrigger = document.querySelector(
        "[data-testid='session-context-trigger']"
    );
    const permissionTrigger = document.querySelector(
        "[data-testid='permission-menu-trigger']"
    );
    const activeContextMatches = activeRow === null || (
        (activeRow.getAttribute("data-session-project") ?? "temporary") ===
            (contextTrigger?.getAttribute("data-project-id") ?? "temporary") &&
        (activeRow.getAttribute("data-session-working-directory") ?? "") ===
            (contextTrigger?.getAttribute("data-working-directory") ?? "")
    );
    const permission = permissionTrigger?.getAttribute("data-permission") ?? "";
    const permissionIsValid = [
        "read-only",
        "project-read-write",
        "full-access",
        "auto-review"
    ].includes(permission);
    const checkedPermission = permissionOptions.find(
        (element) => element.getAttribute("aria-checked") === "true"
    );
    const permissionTriggerName = permissionTrigger
        ? accessibleName(document, permissionTrigger)
        : "";
    const checkedPermissionName = checkedPermission
        ? accessibleName(document, checkedPermission)
        : "";
    const permissionSelectionMatchesTrigger = permissionOptions.length === 0 || (
        permissionTriggerName.length > 0 &&
        checkedPermissionName.startsWith(permissionTriggerName)
    );

    const composerForm = document.querySelector("[data-testid='composer-form']");
    const composerInput = document.querySelector<HTMLTextAreaElement>(
        "[data-testid='composer-input']"
    );
    const send = document.querySelector<HTMLButtonElement>(
        "[data-testid='composer-send']"
    );
    const stop = document.querySelector("[data-testid='composer-stop']");
    const composerSubmitIsConsistent = !send || !composerInput || (
        send.disabled ||
        composerInput.value.trim().length > 0
    );
    const composerActionsAreExclusive = !(
        send && stop &&
        visible(window, send) &&
        visible(window, stop)
    );
    const composerIsVisible = composerForm !== null && visible(window, composerForm);
    const mainRect = main?.getBoundingClientRect() ?? null;
    const composerFitsMain = composerForm === null || mainRect === null ||
        inside(composerForm.getBoundingClientRect(), mainRect);

    const rightSidebar = document.querySelector(
        "[data-testid='right-sidebar']"
    );
    const rightSidebarFitsViewport = rightSidebar === null ||
        insideViewport(window, rightSidebar.getBoundingClientRect());
    const overlayVisible = [...document.querySelectorAll("div[aria-hidden='true']")]
        .some((element) => {
            if (element.getAttribute("data-slot") === "dialog-overlay") return false;
            if (!visible(window, element)) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
                style.position === "fixed" &&
                rect.width >= window.innerWidth - 2 &&
                rect.height >= window.innerHeight - 2
            );
        });
    const settingsDialog = document.querySelector(
        "[data-testid='settings-dialog']"
    );

    return {
        root: root !== null,
        sidebar: sidebar !== null,
        main: main !== null,
        language,
        title: document.title,
        unnamedButtons,
        unnamedFields,
        unnamedDialogs,
        unnamedMenuItems,
        menuItemCount: menuItems.length,
        duplicateIds,
        nestedInteractive,
        horizontalOverflow,
        busy,
        activeSessionCount: activeRows.length,
        groupedCorrectly,
        archivedVisible,
        sessionRowsFitSidebar,
        activeContextMatches,
        permissionIsValid,
        composerSubmitIsConsistent,
        composerActionsAreExclusive,
        composerIsVisible,
        composerFitsMain,
        dialogCount: dialogs.length,
        dialogsWithinViewport,
        dialogsHaveOverlay,
        menuOpen: menuContents.length > 0,
        menuCount: menuContents.length,
        menusWithinViewport,
        permissionMenuOpen: permissionOptions.length > 0,
        permissionOptionCount: permissionOptions.length,
        checkedPermissionOptions,
        permissionSelectionMatchesTrigger,
        rightSidebarOpen: rightSidebar !== null &&
            visible(window, rightSidebar),
        rightSidebarFitsViewport,
        overlayVisible,
        settingsOpen: settingsDialog !== null && visible(window, settingsDialog),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
    };
});

export const exploration = weighted([
    [8, uiClicks],
    [14, closeDialogs],
    [6, openSettings],
    [5, toggleRightSidebar],
    [4, openPermissionMenu],
    [4, openModelMenu],
    [4, openSessionContext],
    [4, openCreateProject],
    [4, settingsSections],
    [4, composerEditing],
    [3, sessionMenus],
    [2, escape],
    [1, viewports]
]);

export const applicationShellExists = always(() =>
    documentState.current.root &&
    documentState.current.sidebar &&
    documentState.current.main &&
    documentState.current.composerIsVisible
);

export const documentIsWellFormed = always(() =>
    documentState.current.title === "Jarvix" &&
    (
        documentState.current.language.startsWith("zh") ||
        documentState.current.language.startsWith("en")
    ) &&
    documentState.current.duplicateIds === 0 &&
    documentState.current.nestedInteractive === 0
);

export const controlsHaveAccessibleNames = always(() =>
    documentState.current.unnamedButtons === 0 &&
    documentState.current.unnamedFields === 0 &&
    documentState.current.unnamedDialogs === 0 &&
    documentState.current.unnamedMenuItems === 0
);

export const layoutDoesNotOverflow = always(() =>
    documentState.current.horizontalOverflow <= 1 &&
    documentState.current.sessionRowsFitSidebar &&
    documentState.current.composerFitsMain
);

export const oneActiveSessionAtMost = always(() =>
    documentState.current.activeSessionCount <= 1
);

export const sessionsStayGroupedAndArchivedStayHidden = always(() =>
    documentState.current.groupedCorrectly &&
    !documentState.current.archivedVisible
);

export const composerReflectsActiveSession = always(() =>
    documentState.current.busy ||
    documentState.current.activeContextMatches
);

export const composerPermissionIsValid = always(() =>
    documentState.current.permissionIsValid
);

export const composerSubmitIsSafe = always(() =>
    documentState.current.composerSubmitIsConsistent &&
    documentState.current.composerActionsAreExclusive
);

export const dialogsAreBoundedAndOverlaid = always(() =>
    documentState.current.dialogsWithinViewport &&
    documentState.current.dialogsHaveOverlay
);

export const menusAreBoundedAndDescribed = always(() =>
    documentState.current.menuCount <= 1 &&
    documentState.current.menusWithinViewport &&
    documentState.current.unnamedMenuItems === 0 &&
    (
        !documentState.current.menuOpen ||
        documentState.current.menuItemCount > 0
    ) &&
    (
        !documentState.current.permissionMenuOpen ||
        (
            documentState.current.permissionOptionCount === 4 &&
            documentState.current.checkedPermissionOptions === 1 &&
            documentState.current.permissionSelectionMatchesTrigger
        )
    )
);

export const rightSidebarMatchesViewport = always(() => {
    if (!documentState.current.rightSidebarFitsViewport) {
        return false;
    }
    if (!documentState.current.rightSidebarOpen) {
        return !documentState.current.overlayVisible;
    }
    return documentState.current.viewportWidth < 1280
        ? documentState.current.overlayVisible
        : !documentState.current.overlayVisible;
});
