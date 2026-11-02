import { STAGE_NAMES, type ChipState, type Chips } from "@/lib/stages";

const STYLE: Record<ChipState, string> = {
  pending: "bg-idle-soft text-idle",
  running: "bg-warn-soft text-warn",
  done: "bg-ok-soft text-ok",
  failed: "bg-bad-soft text-bad",
};

const WORD: Record<ChipState, string> = {
  pending: "not started",
  running: "running",
  done: "done",
  failed: "failed",
};

function Icon({ state }: { state: ChipState }) {
  if (state === "running") {
    return (
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-warn border-t-transparent"
      />
    );
  }
  if (state === "done") return <span aria-hidden="true">✓</span>;
  if (state === "failed") return <span aria-hidden="true">✕</span>;
  return null;
}

export function StageChips({ chips }: { chips: Chips }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Processing stages">
      {STAGE_NAMES.map((name) => (
        <li
          key={name}
          className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${STYLE[chips[name]]}`}
        >
          <Icon state={chips[name]} />
          {name}
          <span className="sr-only">: {WORD[chips[name]]}</span>
        </li>
      ))}
    </ul>
  );
}
