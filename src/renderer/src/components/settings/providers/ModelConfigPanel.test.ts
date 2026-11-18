import { expect, test, vi } from "vitest";
import { containNestedFormSubmit } from "./ModelConfigPanel.tsx";

test("contains model-editor submits inside the provider dialog", () => {
    const event = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
    };

    containNestedFormSubmit(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
});
