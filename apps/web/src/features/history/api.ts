import type {
  HistoryConversation,
  HistoryIndex,
  HistoryVault,
} from "@arogya/contracts";
import type { ServerHistoryAccess } from "@/features/history/local-history";
import { ApiError, getApiBaseUrl } from "@/lib/api";

export function historyOrigin() {
  return new URL(
    getApiBaseUrl() || window.location.origin,
    window.location.origin,
  ).href.replace(/\/$/, "");
}
async function call<T>(
  path: string,
  token: string,
  method = "GET",
  payload?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${historyOrigin()}/api/v1/history/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: signal || AbortSignal.timeout(12000),
    cache: "no-store",
    credentials: "omit",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      data.detail || "history_request_failed",
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
function key(access: ServerHistoryAccess) {
  if (access.origin !== historyOrigin())
    throw new Error(
      "The server address changed. History access is tied to its original server.",
    );
  return access.access_token;
}
export const enrollHistory = (sessionToken: string, historyKey: string) =>
  call<HistoryVault>("vault", sessionToken, "POST", {
    allow_server_storage: true,
    client_access_token: historyKey,
    retention_days: 30,
  });
export const readServerHistory = (
  access: ServerHistoryAccess,
  signal?: AbortSignal,
) => call<HistoryIndex>("conversations", key(access), "GET", undefined, signal);
export const copyConversation = (
  access: ServerHistoryAccess,
  value: HistoryConversation,
  signal: AbortSignal,
) =>
  call<HistoryConversation>(
    `conversations/${value.id}`,
    key(access),
    "PUT",
    value,
    signal,
  );
export const deleteServerConversation = (
  access: ServerHistoryAccess,
  id: string,
  signal?: AbortSignal,
) =>
  call<void>(`conversations/${id}`, key(access), "DELETE", undefined, signal);
export const revokeServerHistory = (access: ServerHistoryAccess) =>
  call<void>("vault", key(access), "DELETE");
