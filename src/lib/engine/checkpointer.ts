import { deepClone, uid } from "@/lib/utils";
import type { Checkpoint, GraphState } from "./types";

/**
 * Teaching equivalent of LangGraph's InMemorySaver.
 * Stores one checkpoint per super-step, per thread. Like the real one,
 * it lives in memory only (refresh the page and it's gone) — in production
 * you would use SqliteSaver / PostgresSaver.
 */
export class MemoryCheckpointer {
  private threads = new Map<string, Checkpoint[]>();

  put(cp: Omit<Checkpoint, "id" | "createdAt"> & { id?: string }): Checkpoint {
    const full: Checkpoint = { ...cp, id: cp.id ?? uid("ckpt"), createdAt: Date.now(), values: deepClone(cp.values) };
    const list = this.threads.get(cp.threadId) ?? [];
    list.push(full);
    this.threads.set(cp.threadId, list);
    return full;
  }

  /** graph.get_state_history(config) — newest first, like LangGraph */
  history(threadId: string): Checkpoint[] {
    return [...(this.threads.get(threadId) ?? [])].reverse();
  }

  /** graph.get_state(config) */
  latest(threadId: string): Checkpoint | undefined {
    const list = this.threads.get(threadId);
    return list?.[list.length - 1];
  }

  get(threadId: string, id: string): Checkpoint | undefined {
    return this.threads.get(threadId)?.find((c) => c.id === id);
  }

  threadIds() {
    return [...this.threads.keys()];
  }

  clear(threadId?: string) {
    if (threadId) this.threads.delete(threadId);
    else this.threads.clear();
  }

  /** graph.update_state(config, values) — creates a new checkpoint (a fork point) */
  update(threadId: string, values: GraphState, apply: (state: GraphState, update: GraphState) => GraphState, fromId?: string): Checkpoint | undefined {
    const base = fromId ? this.get(threadId, fromId) : this.latest(threadId);
    if (!base) return undefined;
    const next = apply(deepClone(base.values), values);
    return this.put({
      threadId,
      step: base.step,
      values: next,
      next: base.next,
      parentId: base.id,
      source: "update",
      writers: ["update_state"],
    });
  }
}
