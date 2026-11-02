import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.SHOT_DIR;
const pdf = (name: string) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.7 mock paper"),
});

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function noSeriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const serious = violations.filter((v) =>
    ["serious", "critical"].includes(v.impact ?? "")
  );
  expect(serious.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}

async function uploadAndGenerate(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("PDF file").setInputFiles(pdf(name));
  await expect(page.getByRole("region", { name: "Create an episode" })).toBeVisible();
  await page.getByText("Student", { exact: true }).click();
  await page.getByText(/Quick Brief/).click();
  await noSeriousViolations(page);
  await shot(page, "library-setup");
  await page.getByRole("button", { name: "Generate episode" }).click();
}

test("upload to playback in a real browser", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await uploadAndGenerate(page, "Attention Is All You Need.pdf");

  await expect(page.getByRole("region", { name: "Episode in progress" })).toBeVisible();
  await expect(page.getByText(/Writing and checking segment/).first()).toBeVisible();
  await noSeriousViolations(page);
  await shot(page, "library-progress");

  await page.waitForURL(/\/listen\/ep-/);
  await expect(page.getByRole("region", { name: "Script" })).toBeVisible();
  await noSeriousViolations(page);

  // Selecting a claim opens its evidence.
  await page.getByRole("button", { name: /replace recurrence entirely/ }).click();
  const evidence = page.getByRole("region", { name: "Evidence" });
  await expect(evidence.getByText(/Support score 0.94/)).toBeVisible();
  await expect(evidence.locator("mark")).toContainText("eschewing recurrence");
  await noSeriousViolations(page);
  await shot(page, "listening");

  // The placeholder audio really loads and plays in a browser.
  const audio = page.locator("audio");
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.duration))
    .toBeGreaterThan(5);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  const before = await audio.evaluate((a: HTMLAudioElement) => a.currentTime);
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThan(before + 0.3);

  // Selecting a sentence in segment 3 seeks there, and speed changes.
  await page.getByRole("button", { name: /big model reached/ }).click();
  await expect(page.getByRole("heading", { name: /Segment 3 of 3/ })).toBeVisible();
  await page.getByRole("button", { name: /Playback speed 1x/ }).click();
  await page.getByRole("button", { name: /Playback speed 1.25x/ }).click();
  expect(await audio.evaluate((a: HTMLAudioElement) => a.playbackRate)).toBe(1.5);

  expect(errors).toEqual([]);
});

test("keyboard only, from the Library to evidence", async ({ page }) => {
  await uploadAndGenerate(page, "paper.pdf");
  await page.waitForURL(/\/listen\/ep-/);
  await expect(page.getByRole("region", { name: "Script" })).toBeVisible();

  const claim = page.getByRole("button", { name: /big model reached/ });
  await claim.focus();
  await page.keyboard.press("e");
  const evidence = page.getByRole("region", { name: "Evidence" });
  await expect(evidence).toBeFocused();
  await expect(evidence.getByText(/28.4 BLEU, improving/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(claim).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /Segment 3 of 3/ })).toBeVisible();
});

test("the setup panel works by keyboard alone", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("PDF file").setInputFiles(pdf("paper.pdf"));
  await expect(page.getByRole("region", { name: "Create an episode" })).toBeVisible();

  await page.getByRole("radio", { name: "Student" }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("radio", { name: /Quick Brief/ }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("slider", { name: /Target length/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("6 min · about 900 words")).toBeVisible();
  await page.getByRole("button", { name: "Generate episode" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Episode in progress" })).toBeVisible();
});

test("failed document and failed run", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("PDF file").setInputFiles(pdf("scan_2019_report.pdf"));
  await expect(page.getByText(/Scanned papers are not supported yet/)).toBeVisible();
  await noSeriousViolations(page);

  await page.getByLabel("PDF file").setInputFiles({
    name: "notes.docx",
    mimeType: "application/msword",
    buffer: Buffer.from("x"),
  });
  await expect(page.getByText(/notes.docx was not uploaded/)).toBeVisible();

  await page.getByLabel("PDF file").setInputFiles(pdf("unverifiable.pdf"));
  await expect(page.getByRole("region", { name: "Create an episode" })).toBeVisible();
  await page.getByText("Student", { exact: true }).click();
  await page.getByText(/Quick Brief/).click();
  await page.getByRole("button", { name: "Generate episode" }).click();

  const card = page.getByRole("region", { name: "Episode could not be made" });
  await expect(card.getByText(/could not verify enough/)).toBeVisible();
  await noSeriousViolations(page);
  await shot(page, "library-failed");
  await expect(page).toHaveURL(/\/$/);
});
