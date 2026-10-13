/**
 * ULID：事件的内部 id。全局唯一、按生成时间可排序（events.md §五）。
 *
 * 同一毫秒内单调递增：随机部分 +1，保证按 id 排序 = 按写入顺序排序。
 * 投影按 id 顺序重放，靠的就是这一点。
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let lastTime = -1;
let lastRandom: number[] = [];

function encodeTime(ms: number): string {
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[ms % 32] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

function randomDigits(): number[] {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b % 32);
}

function increment(digits: number[]): number[] {
  const next = [...digits];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i] < 31) {
      next[i]++;
      return next;
    }
    next[i] = 0;
  }
  throw new Error("ULID 随机部分溢出（同一毫秒内生成过多）");
}

export function ulid(now: number = Date.now()): string {
  if (now <= lastTime) {
    // 时钟没走或回拨：沿用上一个时间戳，随机部分递增，保持单调
    lastRandom = increment(lastRandom);
    now = lastTime;
  } else {
    lastTime = now;
    lastRandom = randomDigits();
  }
  return encodeTime(now) + lastRandom.map((d) => ALPHABET[d]).join("");
}
