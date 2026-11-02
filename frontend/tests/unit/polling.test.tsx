import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEpisode } from "@/lib/api";
import { usePollEpisode } from "@/lib/polling";
import { completedEpisode, episodeAtStep } from "@/mocks/fixtures/episode";

vi.mock("@/lib/api", () => ({ getEpisode: vi.fn(), getDocument: vi.fn() }));
const fetchEpisode = vi.mocked(getEpisode);

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe("usePollEpisode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchEpisode.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("UT-UI-07 polls every 2 s, grows to 5 s after 30 s, stops on COMPLETED", async () => {
    fetchEpisode.mockResolvedValue(episodeAtStep(1));
    const { rerender } = renderHook(() => usePollEpisode("ep-1", () => {}));

    await advance(0);
    expect(fetchEpisode).toHaveBeenCalledTimes(1);
    await advance(2000);
    expect(fetchEpisode).toHaveBeenCalledTimes(2);
    await advance(2000);
    expect(fetchEpisode).toHaveBeenCalledTimes(3);

    await advance(26_000); // now at 30 s
    const at30s = fetchEpisode.mock.calls.length;
    expect(at30s).toBe(16);

    await advance(60_000);
    const inMinute = fetchEpisode.mock.calls.length - at30s;
    expect(inMinute).toBeGreaterThanOrEqual(12); // 60 s / 5 s
    expect(inMinute).toBeLessThanOrEqual(14); // a few shorter steps first

    fetchEpisode.mockResolvedValue(completedEpisode());
    await advance(5000);
    const stopped = fetchEpisode.mock.calls.length;
    await advance(60_000);
    expect(fetchEpisode).toHaveBeenCalledTimes(stopped);
    rerender();
  });

  it("UT-UI-08 shows a banner after three errors, keeps polling, and recovers", async () => {
    fetchEpisode.mockRejectedValue(new Error("offline"));
    const updates: string[] = [];
    const { result } = renderHook(() =>
      usePollEpisode("ep-1", (e) => updates.push(e.status))
    );

    await advance(0);
    await advance(2000);
    expect(result.current.showBanner).toBe(false);
    await advance(2000);
    expect(result.current.showBanner).toBe(true);

    fetchEpisode.mockResolvedValue(episodeAtStep(1));
    await advance(2000);
    expect(result.current.showBanner).toBe(false);
    expect(updates).toEqual(["GENERATING"]);
  });

  it("pauses while hidden and resumes at once when shown", async () => {
    fetchEpisode.mockResolvedValue(episodeAtStep(1));
    let visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibility as DocumentVisibilityState
    );
    renderHook(() => usePollEpisode("ep-1", () => {}));
    await advance(0);

    visibility = "hidden";
    await advance(2000);
    await advance(60_000);
    expect(fetchEpisode).toHaveBeenCalledTimes(1);

    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fetchEpisode).toHaveBeenCalledTimes(2);
  });

  it("stops after 15 minutes and can keep waiting", async () => {
    fetchEpisode.mockResolvedValue(episodeAtStep(1));
    const { result } = renderHook(() => usePollEpisode("ep-1", () => {}));

    await advance(16 * 60_000);
    expect(result.current.timedOut).toBe(true);
    const stopped = fetchEpisode.mock.calls.length;
    await advance(60_000);
    expect(fetchEpisode).toHaveBeenCalledTimes(stopped);

    act(() => result.current.keepWaiting());
    await advance(0);
    expect(result.current.timedOut).toBe(false);
    expect(fetchEpisode).toHaveBeenCalledTimes(stopped + 1);
  });

  it("aborts the request on unmount", async () => {
    fetchEpisode.mockResolvedValue(episodeAtStep(1));
    const { unmount } = renderHook(() => usePollEpisode("ep-1", () => {}));
    await advance(0);
    unmount();
    expect(fetchEpisode.mock.calls[0][1]?.aborted).toBe(true);
    await advance(10_000);
    expect(fetchEpisode).toHaveBeenCalledTimes(1);
  });
});
