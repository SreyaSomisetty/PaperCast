"use client";

import { useEffect, useState } from "react";
import { MODES, modeOption, PROFILES } from "@/lib/modes";
import { LAST_CHOICES_KEY, readSession, writeSession } from "@/lib/session";
import type { EpisodeRequest, Mode, Profile } from "@/types/api";
import { LengthSlider } from "./LengthSlider";

interface Choices {
  profile: Profile | null;
  mode: Mode | null;
}

const chipClass =
  "cursor-pointer rounded-full border border-navy px-3 py-1 text-sm text-navy has-[:checked]:bg-navy has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus";

function Chip({
  name,
  label,
  checked,
  onSelect,
}: {
  name: string;
  label: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label className={chipClass}>
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      {label}
    </label>
  );
}

export function CreateEpisodePanel({
  documentId,
  title,
  busy,
  notice,
  onGenerate,
}: {
  documentId: string;
  title: string;
  busy: boolean;
  notice: string | null;
  onGenerate: (request: EpisodeRequest) => void;
}) {
  const [choices, setChoices] = useState<Choices>({ profile: null, mode: null });
  const [minutes, setMinutes] = useState<number | null>(null); // null = default

  useEffect(() => {
    const saved = readSession<Choices>(LAST_CHOICES_KEY);
    if (saved) setChoices(saved);
  }, []);

  const update = (next: Choices) => {
    setChoices(next);
    writeSession(LAST_CHOICES_KEY, next);
  };

  const mode = choices.mode ? modeOption(choices.mode) : null;
  const profile = PROFILES.find((p) => p.value === choices.profile);

  return (
    <section
      aria-label="Create an episode"
      className="space-y-4 rounded-lg bg-card p-4 shadow-sm"
    >
      <div>
        <h2 className="text-sm font-semibold">Create an episode</h2>
        <p className="text-xs text-muted">{title}</p>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Listener profile</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {PROFILES.map((p) => (
            <Chip
              key={p.value}
              name="profile"
              label={p.label}
              checked={choices.profile === p.value}
              onSelect={() => update({ ...choices, profile: p.value })}
            />
          ))}
        </div>
        {profile && <p className="mt-1 text-xs text-muted">{profile.hint}</p>}
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium">Mode</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {MODES.map((m) => (
            <Chip
              key={m.value}
              name="mode"
              label={`${m.label} · ${m.defaultMinutes} min`}
              checked={choices.mode === m.value}
              onSelect={() => {
                update({ ...choices, mode: m.value });
                setMinutes(null);
              }}
            />
          ))}
        </div>
      </fieldset>

      {mode && (
        <LengthSlider
          mode={mode}
          minutes={minutes ?? mode.defaultMinutes}
          onChange={setMinutes}
        />
      )}

      <fieldset>
        <legend className="text-sm font-medium">Format</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          <Chip name="format" label="Two-host dialogue" checked onSelect={() => {}} />
          <label className="cursor-not-allowed rounded-full border border-line px-3 py-1 text-sm text-muted">
            <input type="radio" name="format" disabled className="sr-only" />
            Single narrator · Phase 2
          </label>
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" disabled />
          Describe figures, tables and equations aloud (not available in Phase 1)
        </label>
      </fieldset>

      {notice && (
        <p role="alert" className="rounded bg-bad-soft px-3 py-2 text-sm text-bad">
          {notice}
        </p>
      )}

      <div>
        <button
          type="button"
          disabled={!choices.profile || !choices.mode || busy}
          onClick={() =>
            onGenerate({
              document_id: documentId,
              profile: choices.profile as Profile,
              mode: choices.mode as Mode,
              format: "two_host",
              ...(minutes === null ? {} : { target_minutes: minutes }),
            })
          }
          className="rounded bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Starting…" : "Generate episode"}
        </button>
        <p className="mt-2 text-xs text-muted">
          Audio is rendered only after every segment passes verification.
        </p>
      </div>
    </section>
  );
}
