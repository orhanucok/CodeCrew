import { promises as fs } from "node:fs";
import * as path from "node:path";

export async function detectStyle(root: string, content: string): Promise<string> {
  const has = async (name: string) => fs.access(path.join(root, name)).then(() => true, () => false);
  const notes = ["Do not rewrite unrelated code."];
  if (await has("tsconfig.json")) notes.unshift("Use TypeScript.");
  if (await has("tailwind.config.js") || await has("tailwind.config.ts") || await has("tailwind.config.mjs")) notes.push("Use Tailwind classes if appropriate.");
  if (await has("biome.json")) notes.push("Follow the existing Biome formatting rules.");
  if (await has(".prettierrc") || await has(".prettierrc.json")) notes.push("Follow the existing Prettier formatting rules.");
  if (await has(".eslintrc") || await has(".eslintrc.json") || await has("eslint.config.js")) notes.push("Follow the existing ESLint rules.");
  notes.push(content.includes("export const ") || content.includes("export function ") ? "Prefer named exports." : "Follow the existing export style.");
  notes.push((content.match(/;/g)?.length ?? 0) > content.split(/\r?\n/).length / 3 ? "Use semicolons." : "Follow the existing semicolon style.");
  return notes.join(" ");
}
