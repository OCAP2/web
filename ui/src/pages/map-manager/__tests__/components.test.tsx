import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { I18nProvider } from "../../../hooks/useLocale";
import { StatusStrip } from "../components";
import type { ToolInfo, HealthCheck, JobInfo } from "../types";

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
      <I18nProvider locale="en">
        <StatusStrip tools={tools} jobs={[]} health={[]} onCancel={() => {}} />
      </I18nProvider>
    ));
    // 3 found out of 4
    expect(container.textContent).toContain("3/4 tools");
  });

  it("shows 'No active imports' when no running jobs", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <StatusStrip tools={makeTools()} jobs={[]} health={[]} onCancel={() => {}} />
      </I18nProvider>
    ));
    expect(container.textContent).toContain("No active imports");
  });

  it("shows active job world name when running", () => {
    const job = makeJob({ status: "running" });
    const { container } = render(() => (
      <I18nProvider locale="en">
        <StatusStrip tools={makeTools()} jobs={[job]} health={[]} onCancel={() => {}} />
      </I18nProvider>
    ));
    expect(container.textContent).toContain("Altis");
  });

  it("shows past job count", () => {
    const jobs: JobInfo[] = [
      makeJob({ id: "j1", status: "done" }),
      makeJob({ id: "j2", status: "failed" }),
    ];
    const { container } = render(() => (
      <I18nProvider locale="en">
        <StatusStrip tools={makeTools()} jobs={jobs} health={[]} onCancel={() => {}} />
      </I18nProvider>
    ));
    expect(container.textContent).toContain("2 past");
  });

  it("shows pending badge count", () => {
    const jobs: JobInfo[] = [
      makeJob({ id: "j1", status: "pending" }),
      makeJob({ id: "j2", status: "pending" }),
    ];
    const { container } = render(() => (
      <I18nProvider locale="en">
        <StatusStrip tools={makeTools()} jobs={jobs} health={[]} onCancel={() => {}} />
      </I18nProvider>
    ));
    expect(container.textContent).toContain("2");
  });

  it("shows optional missing count", () => {
    const tools = makeTools();
    // gdaldem is missing + optional
    const { container } = render(() => (
      <I18nProvider locale="en">
        <StatusStrip tools={tools} jobs={[]} health={[]} onCancel={() => {}} />
      </I18nProvider>
    ));
    expect(container.textContent).toContain("1 optional missing");
  });

  it("opens tools dropdown on click", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <StatusStrip tools={makeTools()} jobs={[]} health={[]} onCancel={() => {}} />
      </I18nProvider>
    ));
    // Click the tools button (first button)
    const toolsBtn = container.querySelectorAll("button")[0];
    fireEvent.click(toolsBtn);
    expect(container.textContent).toContain("CLI Tools");
    expect(container.textContent).toContain("pmtiles");
    expect(container.textContent).toContain("tippecanoe");
  });

  it("opens jobs dropdown on click", () => {
    const jobs: JobInfo[] = [makeJob({ id: "j1", status: "done", worldName: "Tanoa" })];
    const { container } = render(() => (
      <I18nProvider locale="en">
        <StatusStrip tools={makeTools()} jobs={jobs} health={[]} onCancel={() => {}} />
      </I18nProvider>
    ));
    // Jobs button is the last button in the strip (not the cancel button)
    const buttons = container.querySelectorAll("button");
    const jobsBtn = buttons[buttons.length - 1];
    fireEvent.click(jobsBtn);
    expect(container.textContent).toContain("History");
    expect(container.textContent).toContain("Tanoa");
    expect(container.textContent).toContain("DONE");
  });

  it("shows 'No job history' in empty jobs dropdown", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <StatusStrip tools={makeTools()} jobs={[]} health={[]} onCancel={() => {}} />
      </I18nProvider>
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
      <I18nProvider locale="en">
        <StatusStrip tools={makeTools()} jobs={jobs} health={[]} onCancel={() => {}} />
      </I18nProvider>
    ));
    const buttons = container.querySelectorAll("button");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(container.textContent).toContain("GDAL not found");
    expect(container.textContent).toContain("FAILED");
  });

  it("shows tool paths in tools dropdown for found tools", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <StatusStrip tools={makeTools()} jobs={[]} health={[]} onCancel={() => {}} />
      </I18nProvider>
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
      <I18nProvider locale="en">
        <StatusStrip tools={tools} jobs={[]} health={[]} onCancel={() => {}} />
      </I18nProvider>
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
      <I18nProvider locale="en">
        <StatusStrip tools={makeTools()} jobs={jobs} health={[]} onCancel={() => {}} />
      </I18nProvider>
    ));
    const buttons = container.querySelectorAll("button");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(container.textContent).toContain("Queued");
    expect(container.textContent).toContain("Livonia");
    expect(container.textContent).toContain("Tanoa");
    expect(container.textContent).toContain("Pending");
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
      <I18nProvider locale="en">
        <StatusStrip tools={makeTools()} jobs={jobs} health={[]} onCancel={() => {}} />
      </I18nProvider>
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
      <I18nProvider locale="en">
        <StatusStrip tools={makeTools()} jobs={jobs} health={[]} onCancel={onCancel} />
      </I18nProvider>
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
      <I18nProvider locale="en">
        <StatusStrip tools={makeTools()} jobs={jobs} health={[]} onCancel={() => {}} />
      </I18nProvider>
    ));
    const buttons = container.querySelectorAll("button");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(container.textContent).toContain("Queued");
    expect(container.textContent).toContain("History");
    expect(container.textContent).toContain("Livonia");
    expect(container.textContent).toContain("DONE");
    expect(container.textContent).toContain("FAILED");
  });

  it("closes dropdown on outside click", () => {
    const { container } = render(() => (
      <I18nProvider locale="en">
        <div>
          <div data-testid="outside">outside</div>
          <StatusStrip tools={makeTools()} jobs={[]} health={[]} onCancel={() => {}} />
        </div>
      </I18nProvider>
    ));
    // Open tools dropdown
    const toolsBtn = container.querySelectorAll("button")[0];
    fireEvent.click(toolsBtn);
    expect(container.textContent).toContain("CLI Tools");

    // Click outside
    const outside = container.querySelector("[data-testid='outside']")!;
    fireEvent.mouseDown(outside);
    expect(container.textContent).not.toContain("CLI Tools");
  });

  it("shows 'Environment issue' when health check fails", () => {
    const health: HealthCheck[] = [
      { id: "maps_writable", label: "Maps directory writable", ok: false, error: "permission denied" },
    ];
    const { container } = render(() => (
      <I18nProvider locale="en">
        <StatusStrip tools={makeTools()} jobs={[]} health={health} onCancel={() => {}} />
      </I18nProvider>
    ));
    expect(container.textContent).toContain("Environment issue");
  });

  it("shows ENVIRONMENT section in tools dropdown with health errors", () => {
    const health: HealthCheck[] = [
      { id: "maps_writable", label: "Maps directory writable", ok: false, error: "maps dir not writable" },
    ];
    const { container } = render(() => (
      <I18nProvider locale="en">
        <StatusStrip tools={makeTools()} jobs={[]} health={health} onCancel={() => {}} />
      </I18nProvider>
    ));
    const toolsBtn = container.querySelectorAll("button")[0];
    fireEvent.click(toolsBtn);
    expect(container.textContent).toContain("Environment");
    expect(container.textContent).toContain("Maps directory writable");
    expect(container.textContent).toContain("maps dir not writable");
  });

  it("shows passing health check in tools dropdown", () => {
    const health: HealthCheck[] = [
      { id: "maps_writable", label: "Maps directory writable", ok: true },
    ];
    const { container } = render(() => (
      <I18nProvider locale="en">
        <StatusStrip tools={makeTools()} jobs={[]} health={health} onCancel={() => {}} />
      </I18nProvider>
    ));
    const toolsBtn = container.querySelectorAll("button")[0];
    fireEvent.click(toolsBtn);
    expect(container.textContent).toContain("Environment");
    expect(container.textContent).toContain("Maps directory writable");
    expect(container.textContent).not.toContain("Environment issue");
  });

  it("shows failed badge when there are failed jobs", () => {
    const jobs: JobInfo[] = [
      makeJob({ id: "j1", status: "failed", error: "boom" }),
    ];
    const { container } = render(() => (
      <I18nProvider locale="en">
        <StatusStrip tools={makeTools()} jobs={jobs} health={[]} onCancel={() => {}} />
      </I18nProvider>
    ));
    // Should show failed count badge and "1 past" with failed styling
    expect(container.textContent).toContain("1");
    expect(container.textContent).toContain("1 past");
  });

  it("hides 'optional missing' label when health is failing", () => {
    const health: HealthCheck[] = [
      { id: "maps_writable", label: "Maps directory writable", ok: false, error: "permission denied" },
    ];
    const { container } = render(() => (
      <I18nProvider locale="en">
        <StatusStrip tools={makeTools()} jobs={[]} health={health} onCancel={() => {}} />
      </I18nProvider>
    ));
    // "optional missing" should not appear when health is failing
    expect(container.textContent).not.toContain("optional missing");
    expect(container.textContent).toContain("Environment issue");
  });
});
