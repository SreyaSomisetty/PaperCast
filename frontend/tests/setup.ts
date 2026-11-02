import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { resetMockApi } from "@/mocks/handlers";
import { server } from "./server";

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
  // jsdom has neither media playback nor object URLs.
  URL.createObjectURL = () => "blob:placeholder";
  URL.revokeObjectURL = () => {};
  HTMLMediaElement.prototype.play = function play() {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function pause() {
    this.dispatchEvent(new Event("pause"));
  };
  HTMLMediaElement.prototype.load = () => {};
});

beforeEach(() => {
  resetMockApi();
  sessionStorage.clear();
  for (const level of ["debug", "info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation(() => {});
  }
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.restoreAllMocks();
});

afterAll(() => server.close());
