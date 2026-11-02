import { WORDS_PER_MINUTE, type ModeOption } from "@/lib/modes";

export function LengthSlider({
  mode,
  minutes,
  onChange,
}: {
  mode: ModeOption;
  minutes: number;
  onChange: (minutes: number) => void;
}) {
  const words = minutes * WORDS_PER_MINUTE;
  return (
    <div>
      <label htmlFor="target-length" className="text-sm font-medium">
        Target length <span className="font-normal text-muted">(optional)</span>
      </label>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
        <span>{mode.minMinutes} min</span>
        <input
          id="target-length"
          type="range"
          min={mode.minMinutes}
          max={mode.maxMinutes}
          step={1}
          value={minutes}
          aria-valuetext={`${minutes} minutes, about ${words} words`}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-navy"
        />
        <span>{mode.maxMinutes} min</span>
        <output htmlFor="target-length" className="font-medium text-ink">
          {minutes} min · about {words} words
        </output>
      </div>
    </div>
  );
}
