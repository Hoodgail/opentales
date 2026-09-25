import { OpenTalesClient } from "@opentales/sdk";
import type {
  ApplyRenameSymbolInput,
  RenameSymbolInput,
} from "$lib/rename-symbol-ui";

const api = new OpenTalesClient({
  baseUrl: import.meta.env.VITE_API_URL ?? "http://localhost:4000",
  token:
    typeof localStorage !== "undefined"
      ? (localStorage.getItem("opentales.token") ?? undefined)
      : undefined,
});

export function syncStoryIdeToken(token: string | undefined) {
  api.setToken(token);
}

export const storyIde = {
  previewRenameSymbol(projectId: string, input: RenameSymbolInput) {
    return api.previewRenameSymbol(projectId, input);
  },
  applyRenameSymbol(projectId: string, input: ApplyRenameSymbolInput) {
    return api.applyRenameSymbol(projectId, input);
  },
};
