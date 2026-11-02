// Listener choices and target lengths (spec Table 9, workbook Table 6.6).
import type { Mode, Profile } from "@/types/api";

export const WORDS_PER_MINUTE = 150;

export interface ModeOption {
  value: Mode;
  label: string;
  defaultMinutes: number;
  minMinutes: number;
  maxMinutes: number;
}

export const MODES: ModeOption[] = [
  { value: "quick_brief", label: "Quick Brief", defaultMinutes: 5, minMinutes: 3, maxMinutes: 7 },
  { value: "deep_dive", label: "Deep Dive", defaultMinutes: 20, minMinutes: 15, maxMinutes: 25 },
  { value: "discussion", label: "Discussion", defaultMinutes: 12, minMinutes: 10, maxMinutes: 15 },
  { value: "study_review", label: "Study / Review", defaultMinutes: 8, minMinutes: 5, maxMinutes: 10 },
];

export const PROFILES: { value: Profile; label: string; hint: string }[] = [
  {
    value: "student",
    label: "Student",
    hint: "Defines terms first and uses examples.",
  },
  {
    value: "researcher",
    label: "Researcher",
    hint: "Keeps exact terminology.",
  },
];

export const modeOption = (mode: Mode) =>
  MODES.find((m) => m.value === mode) as ModeOption;
