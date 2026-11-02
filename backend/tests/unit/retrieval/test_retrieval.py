"""Retrieval unit tests (spec Table 23, UT-RET-01 to UT-RET-18).

These check the rules in the design, such as ordering, thresholds, exclusion,
de-duplication, and staleness. They use the fake embedder from `conftest.py`, so
they say nothing about the quality of a real model.
"""
from __future__ import annotations

import importlib
import json
import subprocess
import sys
import threading
from pathlib import Path

import numpy as np
import pytest

from app.core.config import get_retrieval_settings
from app.core.schemas import Document, DocumentChunk, SourceLocation
from app.schemas.retrieval import (
    IndexStatus,
    RetrievalError,
    RetrievalErrorCode,
)
from app.services import retrieval, store
from app.services.retrieval import embedder, fusion, index_store, lexical
from app.services.retrieval.fusion import Candidate
from app.services.retrieval.telemetry import counters
from tests.conftest import FakeEmbedder

retrieve_module = importlib.import_module("app.services.retrieval.retrieve")

_REPEATED = "The attention mechanism replaces recurrence in this architecture."


def _chunk(
    chunk_id: str,
    text: str,
    section: str = "Results",
    page: int = 1,
    paragraph: int = 1,
) -> DocumentChunk:
    return DocumentChunk(
        chunk_id=chunk_id,
        text=text,
        location=SourceLocation(page=page, section=section, paragraph=paragraph),
    )


def _document(*chunks: DocumentChunk, document_id: str = "doc-1") -> Document:
    return Document(
        document_id=document_id, filename="paper.pdf", chunks=list(chunks)
    )


@pytest.fixture
def paper() -> Document:
    return _document(
        _chunk("c-0001", "We propose a new network architecture.", "Abstract", 1),
        _chunk("c-0002", _REPEATED, "Abstract", 1, 2),
        _chunk("c-0010", "Recurrent layers process tokens sequentially.", "Intro", 2),
        _chunk("c-0020", "Self-attention relates positions of a sequence.", "Model", 3),
        _chunk("c-0030", "The model reached 28.4 BLEU on English-to-German.", "Results", 8),
        _chunk("c-0031", "Training cost fell to one quarter.", "Results", 8, 2),
        _chunk("c-0041", _REPEATED, "Conclusion", 10),
        _chunk("c-0050", "Smith et al. attention survey, 2015.", "References", 12),
        _chunk("c-0051", "   ", "Results", 12),
    )


def _candidate(chunk_id: str, score: float, page: int = 1, **kwargs) -> Candidate:
    defaults = {
        "row": 0,
        "dense": score,
        "lexical": 0.0,
        "terms": frozenset({chunk_id}),
        "in_section": False,
    }
    return Candidate(
        chunk_id=chunk_id, page=page, score=score, **{**defaults, **kwargs}
    )


def _index_path(document: Document) -> Path:
    return index_store.index_dir(document.document_id)


# --------------------------------------------------------------------------- #
# Index build
# --------------------------------------------------------------------------- #
def test_ut_ret_01_build_index_writes_files_and_row(paper: Document) -> None:
    info = retrieval.build_index(paper)

    assert info.status is IndexStatus.READY
    assert info.chunk_count == 7  # 9 chunks less one empty, one reference
    assert info.model_id == "fake-embedder"
    assert {p.name for p in _index_path(paper).iterdir()} == {
        "vectors.faiss",
        "embeddings.npy",
        "lexical.json",
        "meta.json",
    }
    assert retrieval.get_index_info(paper.document_id) == info


def test_ut_ret_02_rebuild_is_identical(paper: Document) -> None:
    first = retrieval.build_index(paper)
    vectors = np.load(_index_path(paper) / "embeddings.npy")

    second = retrieval.build_index(paper, force=True)

    assert second.content_hash == first.content_hash
    assert np.array_equal(np.load(_index_path(paper) / "embeddings.npy"), vectors)


@pytest.mark.parametrize(
    "title",
    ["References", "REFERENCES", "7 References", "7. References", "VII. References",
     "Bibliography"],
)
def test_ut_ret_03_reference_sections_are_excluded(title: str) -> None:
    document = _document(
        _chunk("c-1", "Attention helps translation."),
        _chunk("c-2", "Smith et al. 2015.", title),
    )

    info = retrieval.build_index(document)

    meta = json.loads((_index_path(document) / "meta.json").read_text())
    assert [row["chunk_id"] for row in meta["rows"]] == ["c-1"]
    assert info.excluded_count == 1


def test_section_starting_with_a_roman_letter_is_not_mistaken_for_a_number() -> None:
    document = _document(
        _chunk("c-1", "Attention helps translation."),
        _chunk("c-2", "Citation counts rose.", "Citations and references"),
    )

    assert retrieval.build_index(document).chunk_count == 2


def test_ut_ret_04_all_empty_document_raises() -> None:
    document = _document(_chunk("c-1", "  "), _chunk("c-2", ""))

    with pytest.raises(RetrievalError) as caught:
        retrieval.build_index(document)

    assert caught.value.code is RetrievalErrorCode.EMPTY_DOCUMENT


# --------------------------------------------------------------------------- #
# Query results
# --------------------------------------------------------------------------- #
def test_ut_ret_05_at_most_k_sorted_with_ranks(paper: Document) -> None:
    out = retrieval.retrieve(paper, "attention model architecture", k=3)

    assert 0 < len(out) <= 3
    assert [p.rank for p in out] == list(range(1, len(out) + 1))
    assert [p.score for p in out] == sorted((p.score for p in out), reverse=True)


def test_default_k_comes_from_settings(
    paper: Document, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PAPERCAST_RETRIEVAL_K", "1")
    get_retrieval_settings.cache_clear()

    assert len(retrieval.retrieve(paper, "attention model architecture")) == 1


def test_ut_ret_06_passages_match_their_chunks(paper: Document) -> None:
    chunks = {c.chunk_id: c for c in paper.chunks}

    out = retrieval.retrieve(paper, "attention model architecture")

    assert out
    for passage in out:
        chunk = chunks[passage.chunk_id]
        assert passage.document_id == paper.document_id
        assert passage.text == chunk.text
        assert passage.location == chunk.location
        assert passage.page == chunk.location.page
        assert passage.section_id == chunk.location.section
        assert passage.section_title == chunk.location.section
        assert passage.paragraph == chunk.location.paragraph


@pytest.mark.parametrize(
    ("query", "k"),
    [("ab", 5), ("  ab  ", 5), ("valid query", 0), ("valid query", 21)],
)
def test_ut_ret_07_invalid_input_raises(paper: Document, query: str, k: int) -> None:
    with pytest.raises(RetrievalError) as caught:
        retrieval.retrieve(paper, query, k=k)

    assert caught.value.code is RetrievalErrorCode.INVALID_QUERY


def test_long_query_is_shortened_at_a_word_boundary(
    paper: Document, fake_embedder: FakeEmbedder, monkeypatch: pytest.MonkeyPatch
) -> None:
    encoded: list[str] = []
    original = fake_embedder.encode

    def spy(texts: list[str]) -> np.ndarray:
        encoded.extend(texts)
        return original(texts)

    retrieval.build_index(paper)
    monkeypatch.setattr(fake_embedder, "encode", spy)
    query = "The model reached 28.4 BLEU on English-to-German translation " * 10

    out = retrieval.retrieve(paper, query)

    assert out[0].chunk_id == "c-0030"
    assert counters["queries_shortened"] == 1
    assert len(encoded[0]) <= 200
    assert encoded[0].endswith(("translation", "The", "model", "reached", "28.4",
                                "BLEU", "on", "English-to-German"))


def test_query_of_exactly_the_limit_is_left_alone() -> None:
    query = "x" * 200

    assert retrieve_module._shorten(query) == query
    assert counters["queries_shortened"] == 0


def test_long_query_with_no_spaces_is_still_shortened() -> None:
    assert retrieve_module._shorten("x" * 500) == "x" * 200


def test_ut_ret_08_no_match_returns_empty_list(paper: Document) -> None:
    assert retrieval.retrieve(paper, "banana bread recipe") == []
    assert counters["queries_empty"] == 1


def test_ut_ret_09_unknown_document_id_raises() -> None:
    with pytest.raises(RetrievalError) as caught:
        retrieval.retrieve("no-such-document", "attention")

    assert caught.value.code is RetrievalErrorCode.DOCUMENT_NOT_FOUND


def test_document_id_resolves_through_the_store(paper: Document) -> None:
    store.save_document(paper)

    by_id = retrieval.retrieve(paper.document_id, "attention model architecture")

    assert by_id == retrieval.retrieve(paper, "attention model architecture")


def test_exact_number_ranks_its_passage_first(paper: Document) -> None:
    out = retrieval.retrieve(paper, "28.4 BLEU English-to-German")

    assert out[0].chunk_id == "c-0030"
    assert out[0].lexical_score > 0


# --------------------------------------------------------------------------- #
# Fusion
# --------------------------------------------------------------------------- #
def test_ut_ret_10_weighted_matches_formula_and_clamps() -> None:
    out = fusion.weighted(np.array([0.5, 1.0]), np.array([1.0, 1.0]), w=0.7)
    np.testing.assert_allclose(out, [0.65, 1.0])

    assert fusion.weighted(np.array([1.5]), np.array([1.5]))[0] == 1.0


def test_ut_ret_16_tokenizer_keeps_numbers_and_hyphens() -> None:
    assert lexical.tokenize("Self-attention reached 28.4 BLEU") == [
        "self-attention",
        "reached",
        "28.4",
        "bleu",
    ]


def test_ut_ret_17_weak_bm25_gives_zero_lexical_scores() -> None:
    class WeakIndex:
        def scores(self, _query: str) -> np.ndarray:
            return np.array([0.4, 0.2])

        def terms(self, _row: int) -> frozenset[str]:
            return frozenset({"attention"})

    out = fusion.lexical_scores(WeakIndex(), "attention", [0, 1])

    assert out.tolist() == [0.0, 0.0]


def test_lexical_score_is_scaled_by_term_coverage() -> None:
    bm25 = lexical.BM25Index.build(
        ["attention model", "attention", "cats", "dogs", "birds"], k1=1.5, b=0.75
    )

    out = fusion.lexical_scores(bm25, "attention model", [0, 1])

    assert out[0] == pytest.approx(1.0)
    assert 0 < out[1] <= 0.5


def test_bm25_on_a_tiny_corpus_stays_non_negative() -> None:
    bm25 = lexical.BM25Index.build(["attention"], k1=1.5, b=0.75)

    assert bm25.scores("attention").tolist() == [0.0]
    assert bm25.top("attention", 5) == []


def test_document_with_no_lexical_tokens_still_indexes(paper: Document) -> None:
    document = _document(_chunk("c-1", "the of and"), _chunk("c-2", "to in"))

    assert retrieval.build_index(document).chunk_count == 2
    assert retrieval.retrieve(document, "the of and") is not None


# --------------------------------------------------------------------------- #
# Selection
# --------------------------------------------------------------------------- #
def test_ut_ret_11_section_results_first_others_fill_slots() -> None:
    candidates = [
        _candidate("c-1", 0.9),
        _candidate("c-2", 0.8),
        _candidate("c-3", 0.7),
        _candidate("c-4", 0.6),
        _candidate("c-5", 0.5, in_section=True),
        _candidate("c-6", 0.4, in_section=True),
    ]

    kept, _ = fusion.select(candidates, k=3, floor=0.1, dedup_threshold=0.9)

    # Both section passages are kept though they score lower, one slot is filled
    # from elsewhere, and the output remains sorted by score.
    assert [c.chunk_id for c in kept] == ["c-1", "c-5", "c-6"]


def test_section_filter_end_to_end(paper: Document) -> None:
    out = retrieval.retrieve(paper, "attention model", k=5, sections=["Results"])

    assert out
    results = {c.chunk_id for c in paper.chunks if c.location.section == "Results"}
    chosen = {p.chunk_id for p in out if p.section_id == "Results"}
    assert chosen <= results


def test_below_floor_candidates_are_dropped_even_in_section() -> None:
    kept, _ = fusion.select(
        [_candidate("c-1", 0.05, in_section=True)],
        k=5,
        floor=0.1,
        dedup_threshold=0.9,
    )

    assert kept == []


def test_ut_ret_12_near_duplicates_not_both_returned(paper: Document) -> None:
    out = retrieval.retrieve(paper, "attention mechanism replaces recurrence", k=5)

    assert not {"c-0002", "c-0041"} <= {p.chunk_id for p in out}
    assert counters["dedup_removed"] >= 1


def test_ut_ret_13_identical_scores_order_by_page_then_chunk_id() -> None:
    candidates = [
        _candidate("c-3", 0.5, page=2),
        _candidate("c-2", 0.5, page=1),
        _candidate("c-1", 0.5, page=2),
    ]

    for ordering in (candidates, candidates[::-1]):
        kept, _ = fusion.select(ordering, k=3, floor=0.1, dedup_threshold=0.9)
        assert [c.chunk_id for c in kept] == ["c-2", "c-1", "c-3"]


def test_repeated_queries_give_identical_results(paper: Document) -> None:
    first = retrieval.retrieve(paper, "attention model architecture")
    index_store.clear_cache()

    assert retrieval.retrieve(paper, "attention model architecture") == first


# --------------------------------------------------------------------------- #
# Staleness and recovery
# --------------------------------------------------------------------------- #
def test_ut_ret_14_model_change_rebuilds_once(paper: Document) -> None:
    retrieval.build_index(paper)
    embedder.set_embedder(FakeEmbedder(model_id="other-model"))

    retrieval.retrieve(paper, "attention model")
    retrieval.retrieve(paper, "attention model")

    assert counters["index_rebuilds_stale"] == 1
    assert counters["index_cache_hits"] == 1
    assert retrieval.get_index_info(paper.document_id).model_id == "other-model"


def test_ut_ret_15_missing_file_triggers_one_rebuild(paper: Document) -> None:
    retrieval.build_index(paper)
    expected = retrieval.retrieve(paper, "attention model")
    index_store.clear_cache()
    (_index_path(paper) / "embeddings.npy").unlink()
    builds = counters["index_builds"]

    assert retrieval.retrieve(paper, "attention model") == expected
    assert counters["index_builds"] == builds + 1


def test_mismatched_row_counts_are_corrupt(paper: Document) -> None:
    retrieval.build_index(paper)
    path = _index_path(paper) / "embeddings.npy"
    np.save(path, np.load(path)[:-1])

    with pytest.raises(RetrievalError) as caught:
        index_store.read(paper.document_id)

    assert caught.value.code is RetrievalErrorCode.INDEX_CORRUPT


def test_ut_ret_18_concurrent_builds_run_once(
    paper: Document, fake_embedder: FakeEmbedder
) -> None:
    results = []
    threads = [
        threading.Thread(target=lambda: results.append(retrieval.build_index(paper)))
        for _ in range(4)
    ]

    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(results) == 4
    assert counters["index_builds"] == 1
    assert fake_embedder.encoded == 7


def test_changed_chunk_text_rebuilds_and_returns_new_text(paper: Document) -> None:
    retrieval.build_index(paper)
    changed = paper.model_copy(deep=True)
    changed.chunks[4].text = "The model reached 31.7 BLEU on English-to-German."

    out = retrieval.retrieve(changed, "31.7 BLEU English-to-German")

    assert counters["index_rebuilds_stale"] == 1
    assert out[0].text == changed.chunks[4].text


def test_failed_build_records_status_and_error(
    paper: Document, monkeypatch: pytest.MonkeyPatch, fake_embedder: FakeEmbedder
) -> None:
    def fail(_texts: list[str]) -> np.ndarray:
        raise RuntimeError("model exploded")

    monkeypatch.setattr(fake_embedder, "encode", fail)

    with pytest.raises(RetrievalError) as caught:
        retrieval.build_index(paper)

    assert caught.value.code is RetrievalErrorCode.EMBEDDING_ERROR
    info = retrieval.get_index_info(paper.document_id)
    assert info.status is IndexStatus.FAILED
    assert "model exploded" in info.error


def test_failed_write_leaves_previous_index_intact(
    paper: Document, monkeypatch: pytest.MonkeyPatch
) -> None:
    retrieval.build_index(paper)
    before = (_index_path(paper) / "meta.json").read_text()

    def fail(_self: lexical.BM25Index, _path: Path) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(lexical.BM25Index, "save", fail)

    with pytest.raises(RetrievalError):
        retrieval.build_index(paper, force=True)

    assert (_index_path(paper) / "meta.json").read_text() == before
    leftovers = [
        p.name
        for p in _index_path(paper).parent.iterdir()
        if p.name.startswith(f".{paper.document_id}-")
    ]
    assert leftovers == []


def test_faiss_is_imported_after_the_embedding_libraries() -> None:
    """Importing faiss first segfaults on the first encode on Apple Silicon.

    Runs in a fresh process, because this test process has already imported
    everything. Importing the package must not load faiss on its own, and
    `load_faiss` must load the embedding libraries first.
    """
    script = (
        "import sys\n"
        "from app.services import retrieval\n"
        "from app.services.retrieval import embedder\n"
        "assert 'faiss' not in sys.modules\n"
        "embedder.load_faiss()\n"
        "assert 'sentence_transformers' in sys.modules\n"
        "assert 'faiss' in sys.modules\n"
    )

    result = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        cwd=Path(__file__).resolve().parents[3],
    )

    assert result.returncode == 0, result.stderr


def test_cache_evicts_least_recently_used(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PAPERCAST_RETRIEVAL_CACHE_SIZE", "1")
    get_retrieval_settings.cache_clear()
    first = _document(_chunk("c-1", "attention model"), document_id="doc-a")
    second = _document(_chunk("c-1", "attention model"), document_id="doc-b")

    retrieval.retrieve(first, "attention model")
    retrieval.retrieve(second, "attention model")
    retrieval.retrieve(first, "attention model")

    assert counters["index_cache_misses"] == 3
