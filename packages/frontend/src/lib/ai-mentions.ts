import type { AiAgentProjectReference } from "@opentales/sdk";
import { ai } from "$lib/stores/ai.svelte";
import { manuscript } from "$lib/stores/manuscript.svelte";

/** `@` mention suggestions over the project's manuscript and file tree. */
export type AutocompleteItem = {
  id: string;
  type: AiAgentProjectReference["type"];
  label: string;
  detail: string;
  path?: string;
  searchText: string;
  scoreBoost?: number;
};


export function extractLineRange(query: string): {
  suffix: string;
  startLine?: number;
  endLine?: number;
} {
  const hashIndex = query.lastIndexOf("#");
  if (hashIndex === -1) return { suffix: "" };
  const linePart = query.slice(hashIndex + 1);
  const match = linePart.match(/^(\d+)(?:-(\d*))?$/);
  if (!match) return { suffix: "" };
  const startLine = Number(match[1]);
  const parsedEnd = match[2] ? Number(match[2]) : undefined;
  const endLine = parsedEnd && startLine < parsedEnd ? parsedEnd : undefined;
  return {
    suffix: `#${startLine}${endLine ? `-${endLine}` : ""}`,
    startLine,
    endLine,
  };
}


export function projectReferenceSuggestions(
  rawQuery: string,
  projectId: string | null,
): AutocompleteItem[] {
  const { baseQuery } = autocompleteQueryParts(rawQuery);
  const items: AutocompleteItem[] = [
    {
      id: projectId ?? "structure",
      type: "structure",
      label: "story-structure",
      detail: "Story structure",
      searchText: "story structure logline outline climax obstacles plot",
      scoreBoost: 3,
    },
    ...ai.fileTree.folders.map((folder) => ({
      id: folder.id,
      type: "folder" as const,
      label: folder.path,
      detail: "Folder",
      path: folder.path,
      searchText: `${folder.name} ${folder.path}`,
      scoreBoost: 2,
    })),
    ...ai.fileTree.docs.map((doc) => ({
      id: doc.id,
      type: "doc" as const,
      label: doc.path ?? doc.title,
      detail: `Doc · ${doc.kind}`,
      path: doc.path ?? doc.title,
      searchText: `${doc.title} ${doc.path ?? ""} ${doc.kind}`,
      scoreBoost: 4,
    })),
    ...ai.fileTree.assets.map((asset) => ({
      id: asset.id,
      type: "asset" as const,
      label: asset.path,
      detail: `Asset · ${asset.kind}`,
      path: asset.path,
      searchText: `${asset.name} ${asset.path} ${asset.kind} ${asset.mimeType}`,
      scoreBoost: 1,
    })),
    ...manuscript.chapters.map((chapter) => ({
      id: chapter.id,
      type: "chapter" as const,
      label: `chapters/${chapter.number}-${slugify(chapter.title)}`,
      detail: `Chapter ${chapter.number}`,
      searchText: `${chapter.title} chapter ${chapter.number} ${chapter.summary}`,
      scoreBoost: 4,
    })),
    ...manuscript.characters.map((character) => ({
      id: character.id,
      type: "character" as const,
      label: `characters/${slugify(character.name)}`,
      detail: "Character",
      searchText: `${character.name} ${character.role} ${character.traits.join(" ")}`,
      scoreBoost: 3,
    })),
    ...manuscript.locations.map((location) => ({
      id: location.id,
      type: "location" as const,
      label: `locations/${slugify(location.name)}`,
      detail: "Location",
      searchText: `${location.name} ${location.type}`,
      scoreBoost: 3,
    })),
    ...manuscript.acts.map((act) => ({
      id: act.id,
      type: "act" as const,
      label: `acts/${slugify(act.title)}`,
      detail: "Act",
      searchText: `${act.title} act`,
      scoreBoost: 2,
    })),
    ...manuscript.structure.obstacles.map((obstacle) => ({
      id: obstacle.id,
      type: "obstacle" as const,
      label: `obstacles/${slugify(obstacle.title)}`,
      detail: `Obstacle · ${obstacle.type.toLowerCase()}`,
      searchText: `${obstacle.title} ${obstacle.type}`,
      scoreBoost: 2,
    })),
  ];
  return items
    .map((item) => ({ item, score: fuzzyScore(baseQuery, item) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      const aDepth = a.item.label.split("/").length;
      const bDepth = b.item.label.split("/").length;
      if (aDepth !== bDepth) return aDepth - bDepth;
      return a.item.label.localeCompare(b.item.label);
    })
    .slice(0, 8)
    .map((entry) => entry.item);
}

function autocompleteQueryParts(query: string): { baseQuery: string } {
  const hashIndex = query.lastIndexOf("#");
  if (hashIndex === -1) return { baseQuery: query };
  const linePart = query.slice(hashIndex + 1);
  return /^\d*(?:-\d*)?$/.test(linePart)
    ? { baseQuery: query.slice(0, hashIndex) }
    : { baseQuery: query };
}

function fuzzyScore(query: string, item: AutocompleteItem): number {
  const q = query.trim().toLowerCase();
  if (!q) return item.scoreBoost ?? 1;
  const haystack = `${item.label} ${item.searchText}`.toLowerCase();
  if (/[*?]/.test(q))
    return globMatches(q, haystack) ? 200 + (item.scoreBoost ?? 0) : 0;
  if (haystack.includes(q)) return 100 + q.length + (item.scoreBoost ?? 0);
  let score = item.scoreBoost ?? 0;
  let cursor = 0;
  for (const char of q) {
    const found = haystack.indexOf(char, cursor);
    if (found === -1) return 0;
    score += found === cursor ? 6 : 2;
    cursor = found + 1;
  }
  return score;
}

function globMatches(pattern: string, value: string): boolean {
  const source = pattern
    .split("")
    .map((char) => {
      if (char === "*") return ".*";
      if (char === "?") return ".";
      return char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    })
    .join("");
  return new RegExp(source).test(value);
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "untitled"
  );
}

