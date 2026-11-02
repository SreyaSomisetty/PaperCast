import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { ListeningScreen } from "@/components/listening/ListeningScreen";
import { API_BASE } from "@/lib/config";
import {
  claimEvidence,
  completedEpisode,
  episodeAtStep,
  episodeWithViolations,
  failedEpisode,
} from "@/mocks/fixtures/episode";
import type { EpisodeView } from "@/types/api";
import { server } from "../server";

vi.mock("next/navigation", () => ({ usePathname: () => "/listen/ep-1" }));

const serve = (episode: EpisodeView) =>
  server.use(http.get(`${API_BASE}/episodes/:id`, () => HttpResponse.json(episode)));

const audioElement = () => document.querySelector("audio") as HTMLAudioElement;

const withAudio = () =>
  completedEpisode({
    audio: {
      episode_url: "/audio/ep-1/episode.mp3",
      export_url: "/episodes/ep-1/export",
      duration_ms: 300_000,
      segments: [
        { segment_id: "item-01", url: "", start_ms: 0, duration_ms: 74_000, turn_starts_ms: [0, 30_000] },
        { segment_id: "item-02", url: "", start_ms: 74_000, duration_ms: 77_000, turn_starts_ms: [74_000, 110_000, 125_000] },
        { segment_id: "item-03", url: "", start_ms: 151_000, duration_ms: 149_000, turn_starts_ms: [151_000] },
      ],
    },
  });

async function open(episode: EpisodeView = completedEpisode()) {
  serve(episode);
  render(<ListeningScreen episodeId="ep-1" />);
  await screen.findByRole("region", { name: "Script" });
}

describe("Listening screen", () => {
  it("lists approved segments with speakers and labels", async () => {
    await open();
    const script = screen.getByRole("region", { name: "Script" });

    expect(within(script).getByText("2 · Self-attention in plain words")).toBeVisible();
    expect(within(script).getAllByText("Maya:").length).toBeGreaterThan(0);
    expect(within(script).getAllByText("Leo:").length).toBeGreaterThan(0);
    expect(within(script).getAllByText(/Supported · p\.2/)).toHaveLength(2);
    expect(within(script).getByText(/Qualified · p\.2/)).toBeVisible();
    expect(within(script).getByText("Background")).toBeVisible();
  });

  it("UT-UI-11 shows a red label rather than hiding a claim that should be gone", async () => {
    await open(episodeWithViolations());
    const script = screen.getByRole("region", { name: "Script" });

    expect(within(script).getByText("Unsupported")).toBeVisible();
    expect(within(script).getByText("Contradicted")).toBeVisible();
    expect(within(script).getByText("Not checked")).toBeVisible();
    expect(console.error).toHaveBeenCalledWith(
      "ui.invariant.violation",
      expect.objectContaining({ kind: "unsupported_in_approved" })
    );
  });

  it("UT-UI-12 selecting a claim fills the evidence panel, fetching once", async () => {
    const calls = vi.fn();
    await open();
    server.use(
      http.get(`${API_BASE}/claims/:id/evidence`, ({ params }) => {
        calls();
        return HttpResponse.json(claimEvidence[params.id as string]);
      })
    );
    const user = userEvent.setup();
    const claim = screen.getByRole("button", { name: /replace recurrence entirely/i });

    await user.click(claim);

    const panel = screen.getByRole("region", { name: "Evidence" });
    expect(await within(panel).findByText(/eschewing recurrence/)).toBeVisible();
    expect(within(panel).getByText(/page 2/i)).toBeVisible();
    expect(within(panel).getByText(/paragraph 4/i)).toBeVisible();
    expect(within(panel).getByText(/1 Introduction/)).toBeVisible();
    expect(within(panel).getByText(/support score 0\.94/i)).toBeVisible();
    expect(within(panel).getByText(/retrieval score 0\.82/i)).toBeVisible();
    expect(within(panel).getByText(/attention only, without recurrence/)).toBeVisible();
    expect(within(panel).getByRole("link", { name: /open in pdf/i })).toHaveAttribute(
      "href",
      expect.stringMatching(/\/documents\/doc-attention\/pdf#page=2$/)
    );
    expect(panel.querySelector("mark")).toHaveTextContent(/eschewing recurrence/);

    await user.click(screen.getByRole("button", { name: /big model reached/i }));
    await within(panel).findByText(/28\.4 BLEU, improving/);
    await user.click(claim);
    await within(panel).findByText(/eschewing recurrence/);
    expect(calls).toHaveBeenCalledTimes(2); // the repeat came from the cache
  });

  it("lets the listener move to another cited passage", async () => {
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /replace recurrence entirely/i }));
    const panel = screen.getByRole("region", { name: "Evidence" });

    await user.click(await within(panel).findByRole("button", { name: /p\.3/ }));

    expect(within(panel).getByText(/Self-attention relates/)).toBeVisible();
  });

  it("selecting a sentence seeks to it, and the highlight follows the audio", async () => {
    await open(withAudio());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /big model reached/i }));
    expect(audioElement().currentTime).toBe(151);

    audioElement().currentTime = 110;
    fireEvent.timeUpdate(audioElement());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /makes training faster/i })).toHaveAttribute(
        "aria-current",
        "true"
      )
    );
    expect(screen.getByRole("heading", { level: 2, name: /Segment 2 of 3/ })).toBeVisible();
  });

  it("offers skip, speed, a segment timeline, and Download", async () => {
    await open(withAudio());
    const user = userEvent.setup();
    const player = screen.getByRole("region", { name: "Player" });

    await user.click(within(player).getByRole("button", { name: "Forward 15s" }));
    expect(audioElement().currentTime).toBe(15);
    await user.click(within(player).getByRole("button", { name: "Back 15s" }));
    expect(audioElement().currentTime).toBe(0);

    await user.click(within(player).getByRole("button", { name: /Playback speed 1x/ }));
    expect(audioElement().playbackRate).toBe(1.25);

    await user.click(within(player).getByRole("button", { name: /Go to segment 3/ }));
    expect(audioElement().currentTime).toBe(151);

    await user.click(within(player).getByRole("button", { name: "Play" }));
    expect(within(player).getByRole("button", { name: "Pause" })).toBeVisible();

    expect(within(player).getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      `${API_BASE}/episodes/ep-1/export`
    );
    expect(audioElement().src).toBe(`${API_BASE}/audio/ep-1/episode.mp3`);
  });

  it("falls back to placeholder audio when none has been recorded", async () => {
    await open();
    expect(screen.getByText(/Silent placeholder audio/)).toBeVisible();
    expect(screen.getByText("Download unavailable")).toBeVisible();
    await waitFor(() => expect(audioElement().src).toBe("blob:placeholder"));
  });

  it("supports the keyboard map", async () => {
    await open(withAudio());
    const user = userEvent.setup();
    const audio = audioElement();

    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "Pause" })).toBeVisible();
    await user.keyboard(" ");

    await user.keyboard("{ArrowRight}");
    expect(audio.currentTime).toBe(15);
    await user.keyboard("{ArrowLeft}");
    expect(audio.currentTime).toBe(0);

    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(audio.currentTime).toBe(74);

    const claim = screen.getByRole("button", { name: /big model reached/i });
    claim.focus();
    await user.keyboard("e");
    const panel = screen.getByRole("region", { name: "Evidence" });
    expect(panel).toHaveFocus();
    expect(await within(panel).findByText(/28\.4 BLEU, improving/)).toBeVisible();
    expect(audio.currentTime).toBe(74); // E opens evidence without moving playback

    await user.keyboard("{Escape}");
    expect(claim).toHaveFocus();

    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "Pause" })).toBeVisible();
  });

  it("stops following when the listener scrolls by hand", async () => {
    await open();
    const follow = screen.getByRole("checkbox", { name: "Follow along" });
    expect(follow).toBeChecked();

    fireEvent.wheel(screen.getByTestId("script-scroll"));

    expect(follow).not.toBeChecked();
  });

  it("can show claims only", async () => {
    await open();
    const user = userEvent.setup();

    await user.click(screen.getByRole("checkbox", { name: "Claims only" }));

    expect(screen.queryByText(/So why did the authors/)).not.toBeInTheDocument();
    expect(screen.getByText(/replace recurrence entirely/)).toBeVisible();
  });

  it("counts removed claims and expands them", async () => {
    await open();
    const user = userEvent.setup();

    expect(screen.getByText(/1 claim was removed during verification/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "show" }));
    expect(screen.getByText(/trained in a single hour/)).toBeVisible();
  });

  it("keeps the dashed Phase 2 panels in place", async () => {
    await open();
    expect(screen.getByRole("region", { name: /Ask or steer, planned/ })).toBeVisible();
    expect(screen.getByRole("region", { name: /Check-in, planned/ })).toBeVisible();
  });

  it("UT-UI-15 never presents a failed run as an episode", async () => {
    serve(failedEpisode("NOTHING_APPROVED"));
    render(<ListeningScreen episodeId="ep-1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not verify enough/);
    expect(screen.queryByRole("region", { name: "Script" })).not.toBeInTheDocument();
  });

  it("does not show a script before the run completes", async () => {
    serve(episodeAtStep(3));
    render(<ListeningScreen episodeId="ep-1" />);

    expect(await screen.findByText("This episode is still being made.")).toBeVisible();
    expect(screen.queryByRole("region", { name: "Script" })).not.toBeInTheDocument();
  });

  it("explains an unknown episode", async () => {
    render(<ListeningScreen episodeId="ep-missing" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not find/);
  });
});
