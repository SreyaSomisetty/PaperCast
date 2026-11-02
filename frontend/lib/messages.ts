// Plain-language messages for failed documents and runs (spec Table 10).
import type { ErrorCode } from "@/types/api";

export type NextAction = "retry" | "changeSettings" | "reupload" | "chooseFile";

export interface FailureMessage {
  message: string;
  actions: NextAction[];
  hint?: string;
}

const CHOOSE_FILE: NextAction[] = ["chooseFile"];

export const FAILURE_MESSAGES: Record<ErrorCode, FailureMessage> = {
  NOTHING_APPROVED: {
    message:
      "We could not verify enough of this paper to make audio we can stand behind.",
    actions: ["changeSettings", "chooseFile"],
  },
  PLAN_INVALID: {
    message: "We could not plan an episode for this paper.",
    actions: ["retry"],
    hint: "If this repeats, report it with the run id.",
  },
  LLM_TIMEOUT: {
    message: "The language model took too long to respond.",
    actions: ["retry"],
  },
  RETRIEVAL_ERROR: {
    message: "We could not search this paper's text.",
    actions: ["reupload"],
  },
  VERIFICATION_ERROR: {
    message: "Something went wrong while checking or recording the episode.",
    actions: ["retry"],
    hint: "The approved script is kept.",
  },
  RENDER_ERROR: {
    message: "Something went wrong while checking or recording the episode.",
    actions: ["retry"],
    hint: "The approved script is kept.",
  },
  NOT_PDF: { message: "PaperCast accepts PDF files only.", actions: CHOOSE_FILE },
  FILE_TOO_LARGE: {
    message: "This file is too large. The limit is 20 MB.",
    actions: CHOOSE_FILE,
  },
  EMPTY_FILE: { message: "This file is empty.", actions: CHOOSE_FILE },
  CORRUPT_PDF: {
    message: "This PDF could not be read. It may be damaged.",
    actions: CHOOSE_FILE,
  },
  EMPTY_DOCUMENT: {
    message:
      "This PDF has no selectable text. Scanned papers are not supported yet.",
    actions: CHOOSE_FILE,
  },
};

const UNKNOWN_FAILURE: FailureMessage = {
  message: "Something went wrong. Please try again.",
  actions: ["retry"],
};

export function failureFor(code: string | null | undefined): FailureMessage {
  if (code && code in FAILURE_MESSAGES) {
    return FAILURE_MESSAGES[code as ErrorCode];
  }
  return UNKNOWN_FAILURE;
}

export const ACTION_LABEL: Record<NextAction, string> = {
  retry: "Try again",
  changeSettings: "Try another mode",
  reupload: "Upload the paper again",
  chooseFile: "Choose another paper",
};
