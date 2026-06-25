export interface FileFingerprint {
  filePath: string;
  contentHash: string;
  mtimeMs: number;
  size: number;
  dirty: boolean;
  selection: { startLine: number; startCharacter: number; endLine: number; endCharacter: number };
}

export interface TaskContext {
  instruction: string;
  command: "fix" | "explain" | "improve" | "addTypes" | "writeTests";
  filePath: string;
  fileContent: string;
  selectedCode: string;
  selectedRange: FileFingerprint["selection"];
  problems: string[];
  projectSummary: string;
  styleNote: string;
  fingerprint: FileFingerprint;
}
