/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { TransportError } from "@openteam/client";
import { renderToStaticMarkup } from "react-dom/server";
import { HealthView, EventConnectionView, ProbeListView } from "../src/FoundationApp.tsx";

describe("foundation Event connection view", () => {
  test("shows connected, replay count, and last cursor state", () => {
    const html = renderToStaticMarkup(
      <EventConnectionView state={{ status: "connected", replayed: 2, lastCursor: "evt_2" }} />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("Event stream connected");
    expect(html).toContain("Events replayed/received: 2");
    expect(html).toContain("Last Event cursor");
    expect(html).toContain("evt_2");
  });

  test("shows a typed connection error without rendering a blank page", () => {
    const html = renderToStaticMarkup(
      <EventConnectionView
        state={{
          status: "error",
          error: new TransportError({ message: "Unable to connect" }),
        }}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Event stream unavailable");
  });
});

describe("foundation probe list view", () => {
  test("shows an accessible error with retry", () => {
    const html = renderToStaticMarkup(<ProbeListView state="error" retry={() => {}} />);

    expect(html).toContain('role="alert"');
    expect(html).toContain("Foundation probes are unavailable");
    expect(html).toContain("Try again");
  });

  test("renders server-backed probes without write controls", () => {
    const html = renderToStaticMarkup(
      <ProbeListView
        state="success"
        probes={[
          {
            id: "prb_01JABC",
            message: "Foundation probe",
            createdAt: "2026-11-24T09:00:00.000Z",
          },
        ]}
      />,
    );

    expect(html).toContain("Foundation probe");
    expect(html).toContain("<ul");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
  });

  test("shows an explicit empty state", () => {
    const html = renderToStaticMarkup(<ProbeListView state="success" probes={[]} />);

    expect(html).toContain("No foundation probes yet");
  });

  test("announces loading accessibly", () => {
    const html = renderToStaticMarkup(<ProbeListView state="loading" />);

    expect(html).toContain('role="status"');
    expect(html).toContain("Loading foundation probes");
  });
});

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
