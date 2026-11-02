import { Label } from "@/components/common/Label";
import type { SentenceVM } from "@/types/view";

export const sentenceDomId = (key: string) => `sentence-${key}`;

export function SentenceLine({
  sentence,
  speaker,
  active,
  selected,
  onSelect,
}: {
  sentence: SentenceVM;
  speaker: string | null; // shown on the first sentence of a turn
  active: boolean;
  selected: boolean;
  onSelect: (sentence: SentenceVM) => void;
}) {
  const isClaim = sentence.kind === "claim";
  return (
    <div
      className={`flex gap-1 rounded px-2 py-1 text-sm ${
        active ? "border-l-4 border-navy bg-idle-soft" : "border-l-4 border-transparent"
      }`}
    >
      {speaker && <span className="shrink-0 font-semibold">{speaker}:</span>}
      <div className="min-w-0">
        <button
          type="button"
          id={sentenceDomId(sentence.key)}
          data-sentence={sentence.key}
          aria-current={active ? "true" : undefined}
          aria-pressed={isClaim ? selected : undefined}
          onClick={() => onSelect(sentence)}
          className="rounded text-left hover:underline"
        >
          {sentence.text}
        </button>
        <Label
          badge={sentence.badge}
          isClaim={isClaim}
          page={sentence.evidence[0]?.label}
        />
      </div>
    </div>
  );
}
