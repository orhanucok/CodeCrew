import { Risk } from "./run";

export interface DiffReview {
  summary: string;
  risk: Risk;
  confidence: "High" | "Medium";
  cost: number;
  changedFiles: string[];
  whatChanged: string;
  why: string;
  riskReason: string;
}
