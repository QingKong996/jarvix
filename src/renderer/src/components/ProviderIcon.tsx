import { useState } from "react";
import { Cpu } from "lucide-react";
import { resolveProviderIcon } from "../provider-icons.ts";

export function ProviderIcon({ id, name }: { id: string; name: string }) {
    const [failedSource, setFailedSource] = useState<string>();
    const icon = resolveProviderIcon(id, name);
    if (!icon || failedSource === icon.url) {
        return <Cpu aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />;
    }

    if (!icon.colored) {
        return (
            <span
                aria-hidden="true"
                className="size-5 shrink-0 bg-current"
                style={{
                    maskImage: `url("${icon.url}")`,
                    WebkitMaskImage: `url("${icon.url}")`,
                    maskPosition: "center",
                    maskRepeat: "no-repeat",
                    maskSize: "contain"
                }}
            />
        );
    }

    return (
        <span className="flex size-5 shrink-0 items-center justify-center">
            <img
                key={id}
                src={icon.url}
                alt=""
                width={20}
                height={20}
                loading="lazy"
                onError={() => setFailedSource(icon.url)}
                className="size-5 object-contain"
            />
        </span>
    );
}
