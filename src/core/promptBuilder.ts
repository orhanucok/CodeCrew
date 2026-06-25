import { TaskContext } from "../types/context";

const PATCH_RULES = `Return only a Search/Replace patch.
Format each edit exactly as:
FILE: relative/path.ts
<<<<<<< SEARCH
exact old code
=======
new code
>>>>>>> REPLACE

For a new file use:
CREATE FILE: relative/path.ts
[file content]

Keep patches small. Do not rewrite full files unless creating a file. Do not modify unrelated code.
Never touch .env files, lock files, node_modules, or .git. Never delete files.`;

export function buildPrompt(context: TaskContext): string {
  const details = `Task: ${context.instruction}
Command: ${context.command}
File: ${context.filePath}
Selected range: ${context.selectedRange.startLine + 1}:${context.selectedRange.startCharacter + 1}-${context.selectedRange.endLine + 1}:${context.selectedRange.endCharacter + 1}
Selection:
${context.selectedCode || "(no selection; use the current file and Problems)"}
Problems:
${context.problems.join("\n") || "(none)"}
Project: ${context.projectSummary}
Style: ${context.styleNote}
Current file:
${context.fileContent}`;
  if (context.command === "explain") return `Explain the selected code clearly and briefly. Do not return a patch.\n${details}`;
  return `${PATCH_RULES}\n${details}`;
}
