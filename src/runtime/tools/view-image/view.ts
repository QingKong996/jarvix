import {
    stringArgument,
    type ToolCallStatus
} from "../tool-view.ts";

export const VIEW_IMAGE_TOOL = "view_image";

export type ViewImageView = {
    kind: "image.view_image";
    path: string;
    mimeType: string;
    imageUrl: string;
    output: string;
    status: ToolCallStatus;
};

export function createViewImageToolCallViewData(
    name: string,
    arguments_: Record<string, unknown>,
    status: ToolCallStatus = "pending"
): ViewImageView | null {
    if (name !== VIEW_IMAGE_TOOL) {
        return null;
    }
    return {
        kind: "image.view_image",
        path: stringArgument(arguments_.path),
        mimeType: "",
        imageUrl: "",
        output: "",
        status
    };
}

export function isViewImageView(value: Record<string, unknown>): boolean {
    return value.kind === "image.view_image"
        && typeof value.path === "string"
        && typeof value.mimeType === "string"
        && typeof value.imageUrl === "string";
}
