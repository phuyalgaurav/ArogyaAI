import type { HistoryConversation } from "@arogya/contracts";

export interface LocalHistoryIndex {
  conversations: HistoryConversation[];
  deleted_ids: string[];
  pending_deleted_ids: string[];
  current_id: string | null;
  storage: "private_file" | "indexeddb";
}
export interface ServerHistoryAccess {
  origin: string;
  access_token: string;
  expires_at: string;
  pending_delete?: boolean;
}
export class LocalHistory {
  private worker: Worker;
  private sequence = 0;
  private failed: Error | null = null;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor() {
    this.worker = new Worker("/history-worker.js");
    this.worker.onmessage = (event) => {
      const request = this.pending.get(event.data.id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(event.data.id);
      if (event.data.error) request.reject(new Error(event.data.error));
      else request.resolve(event.data.result);
    };
    this.worker.onerror = () => {
      this.failed = new Error(
        "Local SQLite could not start. Check browser storage and reload.",
      );
      this.fail(
        new Error(
          "Local SQLite could not start. Check browser storage and reload.",
        ),
      );
    };
  }
  private fail(error: Error) {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
  request<T>(action: string, data?: unknown): Promise<T> {
    if (this.failed) return Promise.reject(this.failed);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Local history storage timed out."));
      }, 45000);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.worker.postMessage({ id, action, data });
    });
  }
  close() {
    this.worker.terminate();
    this.fail(new Error("History storage closed."));
  }
}
