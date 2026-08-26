/**
 * Excel/PDF are generated server-side from published data; this is the one
 * place the app pulls a file down. Web triggers the browser's native save via
 * a Blob + object URL. Native downloads into the cache directory, then hands
 * off to the OS share sheet — Expo has no direct "save to device" primitive.
 */

import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";

import { API_BASE_URL, authHeader } from "./api";

/**
 * Longer than an ordinary API call allows for, because the server is building
 * a workbook or a PDF rather than reading a row — but still bounded. Without a
 * limit a stalled export leaves a button spinning with nothing to report.
 */
const EXPORT_TIMEOUT_MS = 60_000;

export async function downloadExport(path: string, filename: string): Promise<void> {
  const url = `${API_BASE_URL}${path}`;
  const headers = await authHeader();

  if (Platform.OS === "web") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, { headers, signal: controller.signal });
    } catch {
      throw new Error(
        "The file did not arrive in time. The pricing service may still be starting up — try again.",
      );
    } finally {
      clearTimeout(timer);
    }
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
