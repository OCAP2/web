import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { StatusStrip } from "../components";
import type { ToolInfo, JobInfo } from "../types";

const makeTools = (overrides: Partial<ToolInfo>[] = []): ToolInfo[] => {
  const defaults: ToolInfo[] = [
    { name: "pmtiles", found: true, path: "/usr/bin/pmtiles", required: true },
    { name: "tippecanoe", found: true, path: "/usr/bin/tippecanoe", required: true },
    { name: "gdal_translate", found: true, path: "/usr/bin/gdal_translate", required: false },
    { name: "gdaldem", found: false, path: "", required: false },
  ];
  return overrides.length
    ? overrides.map((o, i) => ({ ...defaults[i % defaults.length], ...o }))
    : defaults;
};

const makeJob = (overrides: Partial<JobInfo> = {}): JobInfo => ({
  id: "job-1",
  worldName: "Altis",
  inputPath: "/tmp/altis.zip",
  outputDir: "/maps/Altis",
  tempDir: "/tmp/altis",
  status: "running",
  startedAt: "2024-01-01T00:00:00Z",
  stage: "render",
  stageNum: 2,
  totalStages: 7,
  ...overrides,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StatusStrip", () => {
  it("renders tool count", () => {
    const tools = makeTools();
    const { container } = render(() => (
      <StatusStrip tools={tools} jobs={[]} onCancel={() => {}} />
    ));
    // 3 found out of 4
    expect(container.textContent).toContain("3/4 tools");
  });

  it("shows 'No active imports' when no running jobs", () => {
    const { container } = render(() => (
      <StatusStrip tools={makeTools()} jobs={[]} onCancel={() => {}} />
    ));
    expect(container.textContent).toContain("No active imports");
  });

  it("shows active job world name when running", () => {
    const job = makeJob({ status: "running" });
    const { container } = render(() => (
      <StatusStrip tools={makeTools()} jobs={[job]} onCancel={() => {}} />
    ));
    expect(container.textContent).toContain("Altis");
  });

  it("shows past job count", () => {
    const jobs: JobInfo[] = [
      makeJob({ id: "j1", status: "done" }),
      makeJob({ id: "j2", status: "failed" }),
    ];
    const { container } = render(() => (
      <StatusStrip tools={makeTools()} jobs={jobs} onCancel={() => {}} />
    ));
    expect(container.textContent).toContain("2 past");
  });

  it("shows pending badge count", () => {
    const jobs: JobInfo[] = [
      makeJob({ id: "j1", status: "pending" }),
      makeJob({ id: "j2", status: "pending" }),
    ];
    const { container } = render(() => (
      <StatusStrip tools={makeTools()} jobs={jobs} onCancel={() => {}} />
    ));
    expect(container.textContent).toContain("2");
  });

  it("shows optional missing count", () => {
    const tools = makeTools();
    // gdaldem is missing + optional
    const { container } = render(() => (
      <StatusStrip tools={tools} jobs={[]} onCancel={() => {}} />
    ));
    expect(container.textContent).toContain("1 optional missing");
  });

  it("opens tools dropdown on click", () => {
    const { container } = render(() => (
      <StatusStrip tools={makeTools()} jobs={[]} onCancel={() => {}} />
    ));
    // Click the tools button (first button)
    const toolsBtn = container.querySelectorAll("button")[0];
    fireEvent.click(toolsBtn);
    expect(container.textContent).toContain("CLI TOOLS");
    expect(container.textContent).toContain("pmtiles");
    expect(container.textContent).toContain("tippecanoe");
  });

  it("opens jobs dropdown on click", () => {
    const jobs: JobInfo[] = [makeJob({ id: "j1", status: "done", worldName: "Tanoa" })];
    const { container } = render(() => (
      <StatusStrip tools={makeTools()} jobs={jobs} onCancel={() => {}} />
    ));
    // Jobs button is the last button in the strip (not the cancel button)
    const buttons = container.querySelectorAll("button");
    const jobsBtn = buttons[buttons.length - 1];
    fireEvent.click(jobsBtn);
    expect(container.textContent).toContain("HISTORY");
    expect(container.textContent).toContain("Tanoa");
    expect(container.textContent).toContain("DONE");
  });

  it("shows 'No job history' in empty jobs dropdown", () => {
    const { container } = render(() => (
      <StatusStrip tools={makeTools()} jobs={[]} onCancel={() => {}} />
    ));
    const buttons = container.querySelectorAll("button");
    const jobsBtn = buttons[buttons.length - 1];
    fireEvent.click(jobsBtn);
    expect(container.textContent).toContain("No job history");
  });

  it("shows failed job error in jobs dropdown", () => {
    const jobs: JobInfo[] = [
      makeJob({
        id: "j1",
        status: "failed",
        error: "GDAL not found",
        stage: "render",
        stageNum: 2,
      }),
    ];
    const { container } = render(() => (
      <StatusStrip tools={makeTools()} jobs={jobs} onCancel={() => {}} />
    ));
    const buttons = container.querySelectorAll("button");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(container.textContent).toContain("GDAL not found");
    expect(container.textContent).toContain("FAILED");
  });

  it("shows tool paths in tools dropdown for found tools", () => {
    const { container } = render(() => (
      <StatusStrip tools={makeTools()} jobs={[]} onCancel={() => {}} />
    ));
    const toolsBtn = container.querySelectorAll("button")[0];
    fireEvent.click(toolsBtn);
    expect(container.textContent).toContain("/usr/bin/pmtiles");
  });

  it("shows required/optional labels for missing tools", () => {
    const tools: ToolInfo[] = [
      { name: "pmtiles", found: false, path: "", required: true },
      { name: "gdal_translate", found: false, path: "", required: false },
    ];
    const { container } = render(() => (
      <StatusStrip tools={tools} jobs={[]} onCancel={() => {}} />
    ));
    const toolsBtn = container.querySelectorAll("button")[0];
    fireEvent.click(toolsBtn);
    expect(container.textContent).toContain("required");
    expect(container.textContent).toContain("optional");
  });

  it("shows pending jobs in QUEUED section of jobs dropdown", () => {
    const jobs: JobInfo[] = [
      makeJob({ id: "p1", status: "pending", worldName: "Livonia" }),
      makeJob({ id: "p2", status: "pending", worldName: "Tanoa" }),
    ];
    const { container } = render(() => (
      <StatusStrip tools={makeTools()} jobs={jobs} onCancel={() => {}} />
    ));
    const buttons = container.querySelectorAll("button");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(container.textContent).toContain("QUEUED");
    expect(container.textContent).toContain("Livonia");
    expect(container.textContent).toContain("Tanoa");
    expect(container.textContent).toContain("PENDING");
  });

  it("shows elapsed time for finished jobs", () => {
    const jobs: JobInfo[] = [
      makeJob({
        id: "j1",
        status: "done",
        startedAt: "2024-01-01T00:00:00Z",
        finishedAt: "2024-01-01T00:05:00Z",
      }),
    ];
    const { container } = render(() => (
      <StatusStrip tools={makeTools()} jobs={jobs} onCancel={() => {}} />
    ));
    const buttons = container.querySelectorAll("button");
    fireEvent.click(buttons[buttons.length - 1]);
    // Should show elapsed time (5 minutes)
    expect(container.textContent).toContain("5m");
  });

  it("calls onCancel when cancel button clicked for active job", () => {
    const onCancel = vi.fn();
    const jobs: JobInfo[] = [makeJob({ id: "active-1", status: "running" })];
    const { container } = render(() => (
      <StatusStrip tools={makeTools()} jobs={jobs} onCancel={onCancel} />
    ));
    // Cancel button should be visible for running job
    const cancelBtn = container.querySelector("[title='Cancel import']") as HTMLElement;
    expect(cancelBtn).not.toBeNull();
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledWith("active-1");
  });

  it("shows mixed pending and past jobs in dropdown", () => {
    const jobs: JobInfo[] = [
      makeJob({ id: "p1", status: "pending", worldName: "Livonia" }),
      makeJob({ id: "h1", status: "done", worldName: "Altis" }),
      makeJob({ id: "h2", status: "failed", worldName: "Stratis", error: "boom" }),
    ];
    const { container } = render(() => (
      <StatusStrip tools={makeTools()} jobs={jobs} onCancel={() => {}} />
    ));
    const buttons = container.querySelectorAll("button");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(container.textContent).toContain("QUEUED");
    expect(container.textContent).toContain("HISTORY");
    expect(container.textContent).toContain("Livonia");
    expect(container.textContent).toContain("DONE");
    expect(container.textContent).toContain("FAILED");
  });

  it("closes dropdown on outside click", () => {
    const { container } = render(() => (
      <div>
        <div data-testid="outside">outside</div>
        <StatusStrip tools={makeTools()} jobs={[]} onCancel={() => {}} />
      </div>
    ));
    // Open tools dropdown
    const toolsBtn = container.querySelectorAll("button")[0];
    fireEvent.click(toolsBtn);
    expect(container.textContent).toContain("CLI TOOLS");

    // Click outside
    const outside = container.querySelector("[data-testid='outside']")!;
    fireEvent.mouseDown(outside);
    expect(container.textContent).not.toContain("CLI TOOLS");
  });
});
