// ─── MapTool API types ───

export interface ToolInfo {
  name: string;
  found: boolean;
  path: string;
  required: boolean;
}

export type ToolSet = ToolInfo[];

export interface MapElevation {
  min: number;
  max: number;
  avg: number;
  stddev: number;
}

export interface MapInfo {
  name: string;
  worldSize?: number;
  status: "none" | "incomplete" | "complete";
  hasPreview?: boolean;
  elevation?: MapElevation;
  featureLayers?: string[];
  files?: Record<string, number>;
}

export interface JobInfo {
  id: string;
  worldName: string;
  inputPath: string;
  outputDir: string;
  tempDir: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  error?: string;
  startedAt: string;
  finishedAt?: string;
  stage?: string;
  stageNum?: number;
  totalStages?: number;
  message?: string;
}

export interface ProgressData {
  jobId: string;
  stage: string;
  stageNum: number;
  totalStages: number;
  message?: string;
}

export interface MapToolEvent {
  type: "progress" | "status";
  data?: ProgressData;
  job?: JobInfo;
}
