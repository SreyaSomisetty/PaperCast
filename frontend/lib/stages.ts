// Maps document and run status to the six stage chips of the Library screen.
import type {
  DocumentSummary,
  ErrorCode,
  LatestEpisode,
  RunStatus,
} from "@/types/api";

export type ChipState = "pending" | "running" | "done" | "failed";
export const STAGE_NAMES = [
  "Extract",
  "Index",
  "Plan",
  "Generate",
  "Verify",
  "Render",
] as const;
export type StageName = (typeof STAGE_NAMES)[number];
export type Chips = Record<StageName, ChipState>;

export const TERMINAL_RUN: ReadonlySet<RunStatus> = new Set([
  "COMPLETED",
  "FAILED",
]);

const FAILED_STAGE: Partial<Record<ErrorCode, StageName>> = {
  PLAN_INVALID: "Plan",
  LLM_TIMEOUT: "Generate",
  RETRIEVAL_ERROR: "Generate",
  NOTHING_APPROVED: "Verify",
  VERIFICATION_ERROR: "Verify",
  RENDER_ERROR: "Render",
};

function documentChips(doc: DocumentSummary): Pick<Chips, "Extract" | "Index"> {
  if (doc.status === "ready") return { Extract: "done", Index: "done" };
  if (doc.status === "failed") {
    return doc.stage === "index"
      ? { Extract: "done", Index: "failed" }
      : { Extract: "failed", Index: "pending" };
  }
  return doc.stage === "index"
    ? { Extract: "done", Index: "running" }
    : { Extract: "running", Index: "pending" };
}

// The loop alternates between Generate and Verify per segment, so GENERATING
// lights both.
const RUN_CHIPS: Record<
  Exclude<RunStatus, "FAILED">,
  Pick<Chips, "Plan" | "Generate" | "Verify" | "Render">
> = {
  PENDING: { Plan: "pending", Generate: "pending", Verify: "pending", Render: "pending" },
  PLANNING: { Plan: "running", Generate: "pending", Verify: "pending", Render: "pending" },
  GENERATING: { Plan: "done", Generate: "running", Verify: "running", Render: "pending" },
  APPROVED: { Plan: "done", Generate: "done", Verify: "done", Render: "pending" },
  RENDERING: { Plan: "done", Generate: "done", Verify: "done", Render: "running" },
  COMPLETED: { Plan: "done", Generate: "done", Verify: "done", Render: "done" },
};

function failedRunChips(code: ErrorCode | null) {
  const failed = (code && FAILED_STAGE[code]) || "Plan";
  const order = ["Plan", "Generate", "Verify", "Render"] as const;
  const at = order.indexOf(failed as (typeof order)[number]);
  return Object.fromEntries(
    order.map((name, i) => [
      name,
      i < at ? "done" : i === at ? "failed" : "pending",
    ])
  ) as Pick<Chips, "Plan" | "Generate" | "Verify" | "Render">;
}

export function chipsFor(
  doc: DocumentSummary,
  run?: Pick<LatestEpisode, "status" | "error_code"> | null
): Chips {
  const latest = run ?? doc.latest_episode;
  const runChips = !latest
    ? RUN_CHIPS.PENDING
    : latest.status === "FAILED"
      ? failedRunChips(latest.error_code)
      : RUN_CHIPS[latest.status];
  return { ...documentChips(doc), ...runChips };
}
