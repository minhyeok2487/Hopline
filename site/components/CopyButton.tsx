"use client";

import { useState } from "react";
import { Icon } from "./Icon";

export function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        let ok = false;
        try {
          await navigator.clipboard.writeText(text);
          ok = true;
        } catch {
          // Clipboard API blocked (permissions, older webviews): fall back to a hidden textarea.
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.cssText = "position:fixed;opacity:0";
          document.body.appendChild(ta);
          ta.select();
          ok = document.execCommand("copy");
          ta.remove();
        }
        if (ok) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-dim transition hover:border-[#33435e] hover:text-fg"
    >
      <Icon name={copied ? "check" : "copy"} className="h-3.5 w-3.5" />
      {copied ? done : label}
    </button>
  );
}
