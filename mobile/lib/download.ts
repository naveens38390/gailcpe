/**
 * Excel/PDF are generated server-side from published data; this is the one
 * place the app pulls a file down. Web triggers the browser's native save via
 * a Blob + object URL. Native downloads into the cache directory, then hands
 * off to the OS share sheet — Expo has no direct "save to device" primitive.
 */

import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";

import { API_BASE_URL, tokenStore } from "./api";

export async function downloadExport(path: string, filename: string): Promise<void> {
  const token = await tokenStore.get();
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  if (Platform.OS === "web") {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Could not generate that file (${response.status}).`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
    return;
  }

  const destination = new File(Paths.cache, filename);
  const file = await File.downloadFileAsync(url, destination, { headers, idempotent: true });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri);
  }
}
