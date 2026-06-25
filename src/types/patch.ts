export type MatchKind = "exact" | "line-ending" | "whitespace" | "fuzzy" | "create";

export interface SearchReplaceBlock {
  kind: "replace";
  filePath: string;
  search: string;
  replace: string;
}

export interface CreateFileBlock {
  kind: "create";
  filePath: string;
  content: string;
}

export type PatchBlock = SearchReplaceBlock | CreateFileBlock;

export interface ParsedPatch {
  blocks: PatchBlock[];
}

export interface VirtualFileChange {
  filePath: string;
  beforeContent: string;
  afterContent: string;
  matchKinds: MatchKind[];
  isNew: boolean;
  beforeHash?: string;
  beforeMtimeMs?: number;
  beforeSize?: number;
}
