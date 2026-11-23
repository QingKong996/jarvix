import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { ViewImageView } from "../../../../../runtime/tools/view.ts";
import { ViewImageToolCall } from "./ViewImageToolCall.tsx";

test("renders the image path and data URL", () => {
    const data: ViewImageView = {
        kind: "image.view_image",
        path: "/tmp/pixel.png",
        mimeType: "image/png",
        imageUrl: "data:image/png;base64,aW1hZ2U=",
        output: "",
        status: "completed"
    };

    const html = renderToStaticMarkup(<ViewImageToolCall data={data} />);

    expect(html).toContain("/tmp/pixel.png");
    expect(html).toContain('src="data:image/png;base64,aW1hZ2U="');
});
