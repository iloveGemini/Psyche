/**
 * 图：收进来的每张存两份 JPEG（`images/<id>.jpg` 长边 ≤ 2048、`<id>.thumb.jpg` 长边 ≤ 512，moments.md §八），
 * 用 macOS 自带的 sips 压，不加依赖。sips 认不出的当不是图，拒。
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { MomentsError, type ImageRef } from "./store.ts";

const run = promisify(execFile);
export const MAX_BYTES = 20 * 1024 * 1024;
export const FULL_EDGE = 2048;
export const THUMB_EDGE = 512;

/** 只缩不放：长边已经不超过 edge 的只转 JPEG */
async function shrink(src: string, out: string, edge: number, longest: number) {
  const resize = longest > edge ? ["-Z", String(edge)] : [];
  await run("sips", [...resize, "-s", "format", "jpeg", "-s", "formatOptions", "80", src, "--out", out], { timeout: 20_000 });
}

async function size(file: string): Promise<{ w?: number; h?: number }> {
  try {
    const { stdout } = await run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { timeout: 10_000 });
    const w = Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1]);
    const h = Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1]);
    return w && h ? { w, h } : {};
  } catch {
    return {};
  }
}

/** 收一张图（原始字节）：压成两份放进 dir，给回 id；thumbEdge 给头像用更小的 */
export async function saveImage(dir: string, bytes: Uint8Array, thumbEdge = THUMB_EDGE): Promise<ImageRef> {
  if (!bytes.length) throw new MomentsError("图是空的");
  if (bytes.length > MAX_BYTES) throw new MomentsError(`图太大（${Math.round(bytes.length / 1024 / 1024)}MB，上限 20MB）`);
  mkdirSync(dir, { recursive: true });
  const id = `i${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  const tmp = join(tmpdir(), `moments-${id}`);
  writeFileSync(tmp, bytes);
  try {
    const { w, h } = await size(tmp);
    if (!w || !h) throw new Error("not an image");
    await shrink(tmp, join(dir, `${id}.jpg`), FULL_EDGE, Math.max(w, h));
    await shrink(tmp, join(dir, `${id}.thumb.jpg`), thumbEdge, Math.max(w, h));
  } catch {
    for (const f of [`${id}.jpg`, `${id}.thumb.jpg`]) rmSync(join(dir, f), { force: true });
    throw new MomentsError("认不出这是一张图（支持 jpg / png / heic / gif / webp 等 macOS 能打开的）");
  } finally {
    rmSync(tmp, { force: true });
  }
  return { id, ...(await size(join(dir, `${id}.jpg`))) };
}

const ID = /^i[a-z0-9]+$/;

/** 读一张（thumb = 缩略）；id 不像样或没有 → null */
export function readImage(dir: string, id: string, thumb = false): Buffer | null {
  if (!ID.test(id)) return null;
  const file = join(dir, `${id}${thumb ? ".thumb" : ""}.jpg`);
  try {
    statSync(file);
    return readFileSync(file);
  } catch {
    return null;
  }
}
