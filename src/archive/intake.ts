/**
 * 入库口（archive.md §一）：harness 上报对话/工具、传感器上报感知、Agent 经工具写自己的选择。
 * 梦写整理结果走编目自己的口子，不经这里。
 *
 * 做两件库房不做的事：
 * 1. 校验 kind 与 payload（kinds.ts）。
 * 2. 大块内容自动转进资料库：工具返回超过阈值时，payload 里只留哈希（原文完整存，但不撑大事件表）。
 */
import type { EventStore, LinkInput, PsycheEvent } from "../store/events.ts";
import { validate } from "./kinds.ts";

export const INLINE_LIMIT = 2000;

export interface IntakeItem {
  kind: string;
  source: string;
  payload: Record<string, unknown>;
  at?: number;
  idem?: string;
  links?: LinkInput[];
}

export function intake(store: EventStore, item: IntakeItem): PsycheEvent {
  const spec = validate(item.kind, item.payload, item.links);
  let payload = item.payload;
  if (item.kind === "tool.result" && typeof payload.text === "string" && payload.text.length > INLINE_LIMIT) {
    const { text, ...rest } = payload;
    payload = { ...rest, result: { hash: store.putMaterial(text as string), mime: "text/plain" }, size: (text as string).length };
  }
  if (item.kind === "tool.call" && payload.args !== undefined) {
    const json = JSON.stringify(payload.args);
    if (json.length > INLINE_LIMIT) {
      const { args, ...rest } = payload;
      payload = { ...rest, argsRef: { hash: store.putMaterial(json, "application/json"), mime: "application/json" } };
    }
  }
  return store.append({ kind: item.kind, class: spec.class, source: item.source, payload, at: item.at, idem: item.idem, links: item.links });
}
