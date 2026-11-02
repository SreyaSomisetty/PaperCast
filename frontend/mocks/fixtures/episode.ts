// Fixture episodes for every run status. These are also the proposed
// `EpisodeView` contract to review with the orchestration owner.
import type {
  ClaimEvidence,
  DocumentSummary,
  EpisodeView,
  ErrorCode,
  RunStatus,
  ScriptSegment,
  SegmentStatus,
} from "@/types/api";

export const attentionDocument: DocumentSummary = {
  document_id: "doc-attention",
  title: "Attention Is All You Need",
  pages: 15,
  sections: 7,
  status: "ready",
  stage: null,
  error_code: null,
  passages_indexed: 212,
  latest_episode: null,
};

const passage = (
  chunk_id: string,
  page: number,
  section_title: string,
  paragraph: number,
  text: string,
  score: number
) => ({
  chunk_id,
  page,
  section_id: section_title,
  section_title,
  paragraph,
  text,
  score,
  document_id: attentionDocument.document_id,
  dense_score: 0.74,
  lexical_score: 0.61,
});

export const evidence = {
  "c-0012": passage(
    "c-0012",
    2,
    "1 Introduction",
    4,
    "In this work we propose the Transformer, a model architecture eschewing recurrence and instead relying entirely on an attention mechanism to draw global dependencies between input and output.",
    0.82
  ),
  "c-0013": passage(
    "c-0013",
    2,
    "1 Introduction",
    5,
    "This inherently sequential nature precludes parallelization within training examples, which becomes critical at longer sequence lengths.",
    0.71
  ),
  "c-0031": passage(
    "c-0031",
    3,
    "3 Model Architecture",
    1,
    "Self-attention relates different positions of a single sequence in order to compute a representation of the sequence.",
    0.69
  ),
  "c-0147": passage(
    "c-0147",
    8,
    "6 Results",
    2,
    "On the WMT 2014 English-to-German translation task, our model achieves 28.4 BLEU, improving over the existing best results.",
    0.81
  ),
};

type Sentence = ScriptSegment["turns"][number]["sentences"][number];
const claim = (text: string, ...evidence_ids: string[]): Sentence => ({
  text,
  kind: "claim",
  evidence_ids,
});
const line = (text: string, kind: Sentence["kind"]): Sentence => ({
  text,
  kind,
  evidence_ids: [],
});

const approvedSegments: EpisodeView["segments"] = [
  {
    segment_id: "item-01",
    item_id: "item-01",
    topic: "Why recurrence was a bottleneck",
    status: "APPROVED",
    attempt: 0,
    turns: [
      {
        speaker: "host_b",
        sentences: [
          line(
            "So why did the authors want to move away from recurrent networks?",
            "question"
          ),
        ],
      },
      {
        speaker: "host_a",
        sentences: [
          claim(
            "The authors point out that recurrence limits parallel training within examples.",
            "c-0013"
          ),
        ],
      },
    ],
  },
  {
    segment_id: "item-02",
    item_id: "item-02",
    topic: "Self-attention in plain words",
    status: "APPROVED",
    attempt: 1,
    turns: [
      {
        speaker: "host_a",
        sentences: [
          line(
            "In general, attention lets a model weigh how much each word matters when it reads another word.",
            "background"
          ),
          claim("The authors replace recurrence entirely with self-attention.", "c-0012"),
        ],
      },
      {
        speaker: "host_b",
        sentences: [line("And that is what makes training faster?", "question")],
      },
      {
        speaker: "host_a",
        sentences: [
          claim(
            "The authors suggest it allows much more parallel computation during training.",
            "c-0013"
          ),
        ],
      },
    ],
  },
  {
    segment_id: "item-03",
    item_id: "item-03",
    topic: "What the results showed",
    status: "APPROVED",
    attempt: 0,
    turns: [
      {
        speaker: "host_a",
        sentences: [
          claim(
            "On English-to-German translation the big model reached 28.4 BLEU.",
            "c-0147"
          ),
        ],
      },
    ],
  },
];

const checks: EpisodeView["checks"] = [
  {
    claim_id: "cl-0101",
    status: "supported",
    hedged: false,
    support_score: 0.91,
    reason: "The passage says sequential processing precludes parallelization.",
    sentence_ref: { segment_id: "item-01", turn_index: 1, sentence_index: 0 },
  },
  {
    claim_id: "cl-0207",
    status: "supported",
    hedged: false,
    support_score: 0.94,
    reason: "The passage states the model uses attention only, without recurrence.",
    sentence_ref: { segment_id: "item-02", turn_index: 0, sentence_index: 1 },
  },
  {
    claim_id: "cl-0208",
    status: "partial",
    hedged: true,
    support_score: 0.72,
    reason: "The source implies this, so the qualifier was restored.",
    sentence_ref: { segment_id: "item-02", turn_index: 2, sentence_index: 0 },
  },
  {
    claim_id: "cl-0301",
    status: "supported",
    hedged: false,
    support_score: 0.97,
    reason: "The score and task match the passage exactly.",
    sentence_ref: { segment_id: "item-03", turn_index: 0, sentence_index: 0 },
  },
];

export function completedEpisode(
  overrides: Partial<EpisodeView> = {}
): EpisodeView {
  return {
    episode_id: "ep-1",
    run_id: "r-7f3a",
    status: "COMPLETED",
    error_code: null,
    profile: "student",
    mode: "quick_brief",
    format: "two_host",
    document: attentionDocument,
    progress: { items_total: 3, items_done: 3, current_item_id: null },
    plan: approvedSegments.map((s, i) => ({
      item_id: s.item_id,
      order: i + 1,
      topic: s.topic,
      role: "explain",
    })),
    segments: approvedSegments,
    script_version: 3,
    checks,
    evidence,
    audio: null, // text-to-speech is not integrated, so placeholder audio plays
    rejected: [],
    removed_claims: [
      {
        segment_id: "item-03",
        text: "The model trained in a single hour.",
        reason: "No supporting evidence was found in the paper.",
      },
    ],
    updated_at: "2026-11-05T19:06:40Z",
    ...overrides,
  };
}

const withStatus = (
  statuses: SegmentStatus[]
): EpisodeView["segments"] =>
  approvedSegments.slice(0, statuses.length).map((segment, i) => ({
    ...segment,
    status: statuses[i],
  }));

// The steps a successful run moves through, one per poll.
const RUN_STEPS: { status: RunStatus; done: number; segments: SegmentStatus[] }[] =
  [
    { status: "PLANNING", done: 0, segments: [] },
    { status: "GENERATING", done: 0, segments: ["VERIFYING"] },
    { status: "GENERATING", done: 1, segments: ["APPROVED", "NEEDS_REVISION"] },
    { status: "GENERATING", done: 2, segments: ["APPROVED", "APPROVED", "VERIFYING"] },
    { status: "RENDERING", done: 3, segments: ["APPROVED", "APPROVED", "APPROVED"] },
  ];

export const RUN_STEP_COUNT = RUN_STEPS.length;

export function episodeAtStep(step: number): EpisodeView {
  const at = RUN_STEPS[step];
  if (!at) return completedEpisode();
  return completedEpisode({
    status: at.status,
    audio: null,
    script_version: null,
    progress: {
      items_total: 3,
      items_done: at.done,
      current_item_id: approvedSegments[at.done]?.item_id ?? null,
    },
    plan: at.status === "PLANNING" ? null : completedEpisode().plan,
    segments: withStatus(at.segments),
    checks: [],
    removed_claims: [],
  });
}

export function failedEpisode(code: ErrorCode): EpisodeView {
  return completedEpisode({
    run_id: "r-2c91",
    status: "FAILED",
    error_code: code,
    audio: null,
    script_version: null,
    progress: { items_total: 3, items_done: 0, current_item_id: null },
    segments: withStatus(["REMOVED", "REMOVED", "REMOVED"]),
    checks: [],
    removed_claims: [],
    rejected: approvedSegments.map((s) => ({
      item_id: s.item_id,
      topic: s.topic,
      reason: "Claims failed verification after two revisions.",
    })),
  });
}

// An approved script holding claims that must never reach it, used to check
// that the client shows them rather than hiding a pipeline bug.
export function episodeWithViolations(): EpisodeView {
  const episode = completedEpisode();
  return {
    ...episode,
    checks: [
      { ...checks[0], status: "unsupported" },
      { ...checks[1], status: "contradicted" },
      checks[2],
    ],
  };
}

const spanOf = (text: string, cited: string): [number, number] => {
  const start = text.indexOf(cited);
  return [start, start + cited.length];
};

export const claimEvidence: Record<string, ClaimEvidence[]> = {
  "cl-0101": [
    { evidence: evidence["c-0013"], retrieval_score: 0.71, support_score: 0.91, bbox: null },
  ],
  "cl-0207": [
    {
      evidence: evidence["c-0012"],
      retrieval_score: 0.82,
      support_score: 0.94,
      bbox: null,
      cited_span: spanOf(evidence["c-0012"].text, "eschewing recurrence"),
    },
    { evidence: evidence["c-0031"], retrieval_score: 0.69, support_score: 0.6, bbox: null },
  ],
  "cl-0208": [
    { evidence: evidence["c-0013"], retrieval_score: 0.71, support_score: 0.72, bbox: null },
  ],
  "cl-0301": [
    { evidence: evidence["c-0147"], retrieval_score: 0.81, support_score: 0.97, bbox: null },
  ],
};
