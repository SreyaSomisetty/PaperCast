import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateEpisodePanel } from "@/components/library/CreateEpisodePanel";
import { LibraryScreen } from "@/components/library/LibraryScreen";
import { RunFailedCard } from "@/components/library/RunFailedCard";
import { API_BASE } from "@/lib/config";
import { ACTION_LABEL, FAILURE_MESSAGES } from "@/lib/messages";
import { MODES } from "@/lib/modes";
import { failedEpisode } from "@/mocks/fixtures/episode";
import type { ErrorCode } from "@/types/api";
import { server } from "../server";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/",
}));
vi.mock("@/lib/config", async (original) => ({
  ...(await original<typeof import("@/lib/config")>()),
  POLL_MS: 5,
  POLL_MAX_MS: 5,
}));

const pdf = (name = "paper.pdf", body = "%PDF-1.7 body") =>
  new File([body], name, { type: "application/pdf" });

async function upload(user: ReturnType<typeof userEvent.setup>, file = pdf()) {
  await user.upload(screen.getByLabelText("PDF file"), file);
}

async function generate(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("region", { name: "Create an episode" });
  await user.click(screen.getByRole("radio", { name: "Student" }));
  await user.click(screen.getByRole("radio", { name: /Quick Brief/ }));
  await user.click(screen.getByRole("button", { name: "Generate episode" }));
}

describe("Library screen", () => {
  beforeEach(() => push.mockClear());

  it("runs from upload to the Listening screen", async () => {
    const user = userEvent.setup();
    render(<LibraryScreen />);

    await upload(user);
    await screen.findByRole("region", { name: "Create an episode" });
    const documents = screen.getByRole("region", { name: "Your documents" });
    expect(within(documents).getByText("paper")).toBeVisible();
    expect(within(documents).getByText("Ready")).toBeVisible();
    expect(within(documents).getByText("212 passages indexed", { exact: false })).toBeVisible();

    await generate(user);
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/listen\/ep-/)));
    expect(sessionStorage.getItem("papercast.lastEpisode")).toContain("ep-");
  });

  it("UT-UI-02 never sends a rejected file", async () => {
    const sent = vi.fn();
    server.use(http.post(`${API_BASE}/documents`, () => { sent(); return HttpResponse.json({}); }));
    const user = userEvent.setup({ applyAccept: false });
    render(<LibraryScreen />);

    await upload(user, pdf("notes.pdf", "not a pdf"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/notes\.pdf was not uploaded/);
    expect(sent).not.toHaveBeenCalled();
  });

  it("UT-UI-03 shows why a document failed", async () => {
    const user = userEvent.setup();
    render(<LibraryScreen />);

    await upload(user, pdf("scan_2019.pdf"));

    expect(await screen.findByText(/Scanned papers are not supported yet/)).toBeVisible();
    const chip = screen.getByText("Extract").closest("li");
    expect(chip).toHaveTextContent("failed");
  });

  it("names the problem when the server rejects an upload", async () => {
    server.use(
      http.post(`${API_BASE}/documents`, () =>
        HttpResponse.json({ code: "CORRUPT_PDF", message: "bad" }, { status: 400 })
      )
    );
    const user = userEvent.setup();
    render(<LibraryScreen />);

    await upload(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be read/);
  });

  it("shows a 4xx from Generate inline and keeps the setup panel", async () => {
    server.use(
      http.post(`${API_BASE}/episodes`, () =>
        HttpResponse.json({ code: "X", message: "This paper is not ready yet." }, { status: 409 })
      )
    );
    const user = userEvent.setup();
    render(<LibraryScreen />);

    await upload(user);
    await generate(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("This paper is not ready yet.");
    expect(screen.getByRole("region", { name: "Create an episode" })).toBeVisible();
  });

  it("shows the failed-run card and no Listening screen", async () => {
    const user = userEvent.setup();
    render(<LibraryScreen />);

    await upload(user, pdf("unverifiable.pdf"));
    await generate(user);

    const card = await screen.findByRole("region", { name: "Episode could not be made" });
    expect(card).toHaveTextContent(FAILURE_MESSAGES.NOTHING_APPROVED.message);
    expect(push).not.toHaveBeenCalled();

    await user.click(within(card).getByRole("button", { name: "Try another mode" }));
    expect(await screen.findByRole("region", { name: "Create an episode" })).toBeVisible();
  });
});

describe("Create an episode panel", () => {
  const renderPanel = (onGenerate = vi.fn()) => {
    render(
      <CreateEpisodePanel
        documentId="doc-1"
        title="Paper"
        busy={false}
        notice={null}
        onGenerate={onGenerate}
      />
    );
    return onGenerate;
  };

  it("UT-UI-04 enables Generate only after a profile and mode are chosen", async () => {
    const user = userEvent.setup();
    renderPanel();
    const generate = screen.getByRole("button", { name: "Generate episode" });

    expect(generate).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "Researcher" }));
    expect(generate).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: /Deep Dive/ }));
    expect(generate).toBeEnabled();
  });

  it.each(MODES)("UT-UI-05 slider matches Table 9 for $label", async (mode) => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("radio", { name: new RegExp(mode.label) }));

    const slider = screen.getByRole("slider", { name: /Target length/ });
    expect(slider).toHaveAttribute("min", String(mode.minMinutes));
    expect(slider).toHaveAttribute("max", String(mode.maxMinutes));
    expect(slider).toHaveValue(String(mode.defaultMinutes));
    expect(
      screen.getByText(
        `${mode.defaultMinutes} min · about ${mode.defaultMinutes * 150} words`
      )
    ).toBeVisible();
  });

  it("sends target_minutes only when the listener set it", async () => {
    const user = userEvent.setup();
    const onGenerate = renderPanel();
    await user.click(screen.getByRole("radio", { name: "Student" }));
    await user.click(screen.getByRole("radio", { name: /Quick Brief/ }));
    await user.click(screen.getByRole("button", { name: "Generate episode" }));

    expect(onGenerate).toHaveBeenCalledWith({
      document_id: "doc-1",
      profile: "student",
      mode: "quick_brief",
      format: "two_host",
    });
  });

  it("remembers the last choices for the session", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <CreateEpisodePanel documentId="d" title="P" busy={false} notice={null} onGenerate={vi.fn()} />
    );
    await user.click(screen.getByRole("radio", { name: "Researcher" }));
    unmount();

    renderPanel();
    expect(await screen.findByRole("radio", { name: "Researcher" })).toBeChecked();
  });

  it("keeps Phase 2 options visible but disabled", () => {
    renderPanel();
    expect(screen.getByRole("radio", { name: /Single narrator/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Describe figures/ })).toBeDisabled();
  });
});

describe("Failed run card", () => {
  const codes = Object.keys(FAILURE_MESSAGES).slice(0, 6) as ErrorCode[];

  it.each(codes)("UT-UI-15 shows the message and action for %s", (code) => {
    render(<RunFailedCard episode={failedEpisode(code)} onAction={vi.fn()} />);

    const failure = FAILURE_MESSAGES[code];
    expect(screen.getByRole("alert")).toHaveTextContent(failure.message);
    for (const action of failure.actions) {
      expect(screen.getByRole("button", { name: ACTION_LABEL[action] })).toBeVisible();
    }
    expect(screen.getByText(/Run r-2c91/)).toBeVisible();
  });
});
