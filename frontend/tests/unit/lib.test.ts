import { describe, expect, it } from "vitest";
import { estimateSentenceStarts, indexAt } from "@/lib/audioSync";
import { FAILURE_MESSAGES, failureFor } from "@/lib/messages";
import { checkPdf } from "@/lib/pdfCheck";
import { placeholderManifest, silentWav } from "@/lib/placeholderAudio";
import { chipsFor } from "@/lib/stages";
import { badgeFor, toViewModel } from "@/lib/viewModel";
import { counters } from "@/lib/logger";
import { flowReducer, initialFlow, type FlowEvent } from "@/lib/flowReducer";
import {
  attentionDocument,
  completedEpisode,
  episodeWithViolations,
} from "@/mocks/fixtures/episode";
import type { ClaimCheck, ClaimStatus } from "@/types/api";

const pdf = (body = "%PDF-1.7 body", name = "paper.pdf", type = "application/pdf") =>
  new File([body], name, { type });

describe("pdfCheck", () => {
  it("UT-UI-01 rejects a text file renamed to .pdf", async () => {
    const result = await checkPdf(pdf("plain text", "notes.pdf"));
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.message).toMatch(/%PDF-/);
  });

  it("UT-UI-02 rejects a 21 MB PDF with the size message", async () => {
    const file = pdf();
    Object.defineProperty(file, "size", { value: 21 * 1024 * 1024 });
    const result = await checkPdf(file);
    expect(!result.ok && result.message).toMatch(/20 MB/);
  });

  it("rejects other file types and empty files, and accepts a real PDF", async () => {
    const docx = await checkPdf(pdf("x", "notes.docx", "application/msword"));
    expect(!docx.ok && docx.message).toMatch(/notes\.docx was not uploaded/);
    const empty = await checkPdf(pdf(""));
    expect(!empty.ok && empty.message).toMatch(/empty/);
    expect(await checkPdf(pdf())).toEqual({ ok: true });
  });
});

describe("flowReducer", () => {
  const run = (events: FlowEvent[]) =>
    events.reduce(
      (acc, event) => {
        const flow = flowReducer(acc.flow, event);
        return { flow, states: [...acc.states, flow.state] };
      },
      { flow: initialFlow, states: [] as string[] }
    );

  it("UT-UI-06 walks the happy path in Figure 4 order", () => {
    const { states, flow } = run([
      { type: "UPLOAD_STARTED", fileName: "p.pdf" },
      { type: "UPLOAD_ACCEPTED", documentId: "d" },
      { type: "DOCUMENT_READY", documentId: "d" },
      { type: "SUBMIT" },
      { type: "EPISODE_ACCEPTED", episodeId: "e" },
      { type: "EPISODE_COMPLETED" },
    ]);
    expect(states).toEqual([
      "uploading",
      "processing",
      "docReady",
      "submitting",
      "generating",
      "listening",
    ]);
    expect(flow.events).toHaveLength(6);
  });

  it("stays idle on a rejected file, and returns to docReady on a 4xx", () => {
    const rejected = run([{ type: "FILE_REJECTED", message: "no" }]).flow;
    expect(rejected.state).toBe("idle");
    expect(rejected.notice).toBe("no");

    const refused = run([
      { type: "DOCUMENT_SELECTED", documentId: "d" },
      { type: "SUBMIT" },
      { type: "SUBMIT_REJECTED", message: "not ready" },
    ]).flow;
    expect(refused.state).toBe("docReady");
    expect(refused.notice).toBe("not ready");
  });

  it("ignores a late document poll after the listener moved on", () => {
    const { flow } = run([
      { type: "DOCUMENT_SELECTED", documentId: "other" },
      { type: "DOCUMENT_READY", documentId: "late" },
    ]);
    expect(flow.documentId).toBe("other");
  });
});

describe("stage chips", () => {
  it("UT-UI-03 marks Extract failed for a document with no text", () => {
    const chips = chipsFor({
      ...attentionDocument,
      status: "failed",
      stage: "extract",
      error_code: "EMPTY_DOCUMENT",
    });
    expect(chips.Extract).toBe("failed");
    expect(chips.Index).toBe("pending");
    expect(failureFor("EMPTY_DOCUMENT").message).toMatch(/Scanned papers/);
  });

  it("lights Generate and Verify together, and fails the right stage", () => {
    const generating = chipsFor(attentionDocument, {
      status: "GENERATING",
      error_code: null,
    });
    expect(generating).toMatchObject({
      Plan: "done",
      Generate: "running",
      Verify: "running",
      Render: "pending",
    });
    const failed = chipsFor(attentionDocument, {
      status: "FAILED",
      error_code: "NOTHING_APPROVED",
    });
    expect(failed).toMatchObject({
      Plan: "done",
      Generate: "done",
      Verify: "failed",
      Render: "pending",
    });
  });
});

describe("view model", () => {
  it("UT-UI-09 keeps only approved segments, with keys matching sentence_ref", () => {
    const episode = completedEpisode();
    const hidden = {
      ...episode.segments[0],
      segment_id: "item-09",
      status: "REMOVED" as const,
    };
    const vm = toViewModel({ ...episode, segments: [...episode.segments, hidden] });

    expect(vm.map((s) => s.id)).toEqual(["item-01", "item-02", "item-03"]);
    const claims = vm.flatMap((s) =>
      s.turns.flatMap((t) => t.sentences.filter((x) => x.kind === "claim"))
    );
    const refs = episode.checks.map(
      ({ sentence_ref: r }) => `${r.segment_id}.t${r.turn_index}.s${r.sentence_index}`
    );
    expect(claims.map((c) => c.key)).toEqual(refs);
    expect(claims.every((c) => c.badge !== "none" && c.claimId)).toBe(true);
    expect(claims[0].evidence[0].label).toBe("p.2");
  });

  const check = (status: ClaimStatus, hedged = false) =>
    ({ status, hedged }) as ClaimCheck;

  it("UT-UI-10 maps every row of Table 11", () => {
    expect(badgeFor("claim", check("supported"))).toBe("supported");
    expect(badgeFor("claim", check("supported", true))).toBe("qualified");
    expect(badgeFor("claim", check("partial", true))).toBe("qualified");
    expect(badgeFor("claim", check("partial"))).toBe("partial");
    expect(badgeFor("claim", check("unsupported"))).toBe("unsupported");
    expect(badgeFor("claim", check("contradicted"))).toBe("contradicted");
    expect(badgeFor("claim")).toBe("none");
    expect(badgeFor("background")).toBe("background");
    expect(badgeFor("question")).toBe("none");
    expect(badgeFor("transition")).toBe("none");
  });

  it("UT-UI-11 logs a violation once per sentence across rebuilds", () => {
    const episode = { ...episodeWithViolations(), episode_id: "ep-violations" };
    const before = counters.get("ui.invariant_violations") ?? 0;

    toViewModel(episode);
    toViewModel(episode);

    // unsupported, contradicted, and one claim with no check at all
    expect(counters.get("ui.invariant_violations")).toBe(before + 3);
  });

  it("records a cited chunk the episode has no evidence for", () => {
    const episode = { ...completedEpisode(), episode_id: "ep-unknown", evidence: {} };
    const vm = toViewModel(episode);
    expect(vm[0].turns[1].sentences[0].evidence[0].label).toBe("p.?");
    expect(console.error).toHaveBeenCalledWith(
      "ui.invariant.violation",
      expect.objectContaining({ kind: "unknown_chunk_id" })
    );
  });
});

describe("audio sync", () => {
  it("UT-UI-13 finds the turn for a time", () => {
    const starts = [0, 74000, 151000];
    expect([0, 74000, 200000].map((t) => indexAt(starts, t))).toEqual([0, 1, 2]);
    expect(indexAt(starts, 73999)).toBe(0);
  });

  it("UT-UI-14 places sentences inside exact turn starts", () => {
    const segment = completedEpisode().segments[1];
    const audio = {
      segment_id: segment.segment_id,
      url: "",
      start_ms: 74000,
      duration_ms: 77000,
      turn_starts_ms: [74000, 110000, 125000],
    };
    const starts = estimateSentenceStarts(segment, audio);

    expect(starts.get("item-02.t0.s0")).toBe(74000);
    expect(starts.get("item-02.t1.s0")).toBe(110000);
    expect(starts.get("item-02.t2.s0")).toBe(125000);
    const values = [...starts.values()];
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(Math.max(...values)).toBeLessThan(151000);
  });

  it("estimates turn starts when the manifest does not have one per turn", () => {
    const segment = completedEpisode().segments[1];
    const starts = estimateSentenceStarts(segment, {
      segment_id: segment.segment_id,
      url: "",
      start_ms: 1000,
      duration_ms: 9000,
      turn_starts_ms: [],
    });
    expect(starts.get("item-02.t0.s0")).toBe(1000);
    expect(starts.size).toBe(4);
  });

  it("builds a placeholder manifest at 150 words per minute", async () => {
    const { durationMs, segments } = placeholderManifest(completedEpisode());
    expect(segments).toHaveLength(3);
    expect(segments[1].start_ms).toBe(segments[0].duration_ms);
    expect(segments[0].turn_starts_ms[0]).toBe(0);
    expect(durationMs).toBeGreaterThan(0);

    const wav = silentWav(1000);
    expect(wav.size).toBe(44 + 4000);
    const head = new Uint8Array(await wav.slice(0, 4).arrayBuffer());
    expect(String.fromCharCode(...head)).toBe("RIFF");
  });
});

describe("messages", () => {
  it("has a message and a next step for every error code", () => {
    for (const failure of Object.values(FAILURE_MESSAGES)) {
      expect(failure.message).toBeTruthy();
      expect(failure.actions.length).toBeGreaterThan(0);
    }
    expect(failureFor("SOMETHING_NEW").actions).toEqual(["retry"]);
  });
});
