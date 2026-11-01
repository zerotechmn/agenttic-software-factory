// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Home } from "../../src/web/pages/Home.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Home page", () => {
  it("shows API online when health succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, product: "House App", time: "t" }), { status: 200 })));
    render(<MemoryRouter><Home /></MemoryRouter>);
    expect(await screen.findByText(/API online/)).toBeInTheDocument();
  });
});
