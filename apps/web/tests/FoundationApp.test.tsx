/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HealthView } from "../src/FoundationApp.tsx";

describe("foundation health view", () => {
  test("announces loading accessibly", () => {
    const html = renderToStaticMarkup(<HealthView state="loading" />);

    expect(html).toContain('role="status"');
    expect(html).toContain("Checking database readiness");
  });

  test("shows an accessible error with retry", () => {
    const html = renderToStaticMarkup(<HealthView state="error" retry={() => {}} />);

    expect(html).toContain('role="alert"');
    expect(html).toContain("Database readiness is unavailable");
    expect(html).toContain("Try again");
  });

  test("shows server-backed readiness when available", () => {
    const html = renderToStaticMarkup(
      <HealthView state="success" health={{ status: "ok", version: "0.0.0" }} />,
    );

    expect(html).toContain("Database ready");
    expect(html).toContain("0.0.0");
  });
});
