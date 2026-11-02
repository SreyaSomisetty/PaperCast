// The web client's state machine (spec Figure 4). Every view renders from this
// state, and every transition comes from a user action or an API response, so
// the flow can be tested by feeding events without rendering anything.

export type FlowState =
  | "idle"
  | "uploading"
  | "processing"
  | "docReady"
  | "submitting"
  | "generating"
  | "listening"
  | "docFailed"
  | "runFailed";

export type FlowEvent =
  | { type: "FILE_REJECTED"; message: string }
  | { type: "UPLOAD_STARTED"; fileName: string }
  | { type: "UPLOAD_PROGRESS"; percent: number }
  | { type: "UPLOAD_ACCEPTED"; documentId: string }
  | { type: "UPLOAD_FAILED"; code: string; message: string }
  | { type: "DOCUMENT_READY"; documentId: string }
  | { type: "DOCUMENT_FAILED"; documentId: string; code: string | null }
  | { type: "DOCUMENT_SELECTED"; documentId: string }
  | { type: "PROCESSING_RESUMED"; documentId: string }
  | { type: "SUBMIT" }
  | { type: "SUBMIT_REJECTED"; message: string }
  | { type: "EPISODE_ACCEPTED"; episodeId: string }
  | { type: "EPISODE_COMPLETED" }
  | { type: "EPISODE_FAILED"; code: string | null }
  | { type: "CHANGE_SETTINGS" }
  | { type: "CHOOSE_ANOTHER_FILE" };

export interface Flow {
  state: FlowState;
  documentId: string | null;
  episodeId: string | null;
  fileName: string | null;
  uploadPercent: number;
  notice: string | null; // inline message that does not change the state
  errorCode: string | null;
  events: string[]; // last ten, for the debug panel
}

export const initialFlow: Flow = {
  state: "idle",
  documentId: null,
  episodeId: null,
  fileName: null,
  uploadPercent: 0,
  notice: null,
  errorCode: null,
  events: [],
};

function transition(flow: Flow, event: FlowEvent): Flow {
  switch (event.type) {
    case "FILE_REJECTED":
      return { ...flow, notice: event.message };
    case "UPLOAD_STARTED":
      return {
        ...initialFlow,
        state: "uploading",
        fileName: event.fileName,
      };
    case "UPLOAD_PROGRESS":
      return { ...flow, uploadPercent: event.percent };
    case "UPLOAD_ACCEPTED":
      return { ...flow, state: "processing", documentId: event.documentId };
    case "UPLOAD_FAILED":
      return {
        ...flow,
        state: "docFailed",
        errorCode: event.code,
        notice: event.message,
      };
    case "DOCUMENT_READY":
      if (flow.state !== "processing") return flow;
      return { ...flow, state: "docReady", documentId: event.documentId };
    case "DOCUMENT_FAILED":
      if (flow.state !== "processing") return flow;
      return { ...flow, state: "docFailed", errorCode: event.code };
    case "DOCUMENT_SELECTED":
      return {
        ...flow,
        state: "docReady",
        documentId: event.documentId,
        episodeId: null,
        errorCode: null,
        notice: null,
      };
    case "PROCESSING_RESUMED":
      return { ...flow, state: "processing", documentId: event.documentId };
    case "SUBMIT":
      return { ...flow, state: "submitting", notice: null };
    case "SUBMIT_REJECTED":
      return { ...flow, state: "docReady", notice: event.message };
    case "EPISODE_ACCEPTED":
      return { ...flow, state: "generating", episodeId: event.episodeId };
    case "EPISODE_COMPLETED":
      return { ...flow, state: "listening" };
    case "EPISODE_FAILED":
      return { ...flow, state: "runFailed", errorCode: event.code };
    case "CHANGE_SETTINGS":
      return { ...flow, state: "docReady", episodeId: null, errorCode: null };
    case "CHOOSE_ANOTHER_FILE":
      return { ...initialFlow, events: flow.events };
  }
}

export function flowReducer(flow: Flow, event: FlowEvent): Flow {
  const next = transition(flow, event);
  return { ...next, events: [...flow.events, event.type].slice(-10) };
}
