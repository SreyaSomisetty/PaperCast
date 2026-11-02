// Verification labels (spec Table 11). Every label combines an icon, a word, and
// a color, so status never depends on color alone.
import type { Badge } from "@/types/view";

const LABELS: Record<
  Exclude<Badge, "none">,
  { icon: string; word: string; style: string; page: boolean }
> = {
  supported: {
    icon: "✓",
    word: "Supported",
    style: "bg-ok-soft text-ok",
    page: true,
  },
  qualified: {
    icon: "~",
    word: "Qualified",
    style: "bg-warn-soft text-warn",
    page: true,
  },
  partial: {
    icon: "◐",
    word: "Partially supported",
    style: "border border-warn text-warn",
    page: true,
  },
  unsupported: {
    icon: "✕",
    word: "Unsupported",
    style: "bg-bad-soft text-bad",
    page: false,
  },
  contradicted: {
    icon: "✕",
    word: "Contradicted",
    style: "bg-bad-soft text-bad",
    page: false,
  },
  background: {
    icon: "",
    word: "Background",
    style: "bg-idle-soft text-idle",
    page: false,
  },
};

const pillClass =
  "ml-1 inline-block rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap";

export function Label({
  badge,
  isClaim,
  page,
}: {
  badge: Badge;
  isClaim: boolean;
  page?: string;
}) {
  if (badge === "none") {
    if (!isClaim) return null; // questions and transitions carry no label
    return <span className={`${pillClass} bg-idle-soft text-idle`}>Not checked</span>;
  }
  const { icon, word, style, page: showsPage } = LABELS[badge];
  return (
    <span className={`${pillClass} ${style}`}>
      {icon && <span aria-hidden="true">{icon} </span>}
      {word}
      {showsPage && page ? ` · ${page}` : ""}
    </span>
  );
}
