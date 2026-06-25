export type Risk = "Low" | "Medium" | "High";

export interface RunRecord {
  id: string;
  timestamp: number;
  summary: string;
  changedFiles: string[];
  risk: Risk;
  cost: number;
  checkpointId?: string;
}
