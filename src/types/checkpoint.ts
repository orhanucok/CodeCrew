import { MatchKind } from "./patch";

export interface CheckpointFile {
  filePath: string;
  beforeContent: string;
  afterContent: string;
  beforeHash: string;
  afterHash: string;
  existedBefore: boolean;
  matchKinds: MatchKind[];
}

export interface Checkpoint {
  id: string;
  timestamp: number;
  summary: string;
  files: CheckpointFile[];
}
