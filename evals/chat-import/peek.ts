/**
 * 看测试库最近几轮浮现了什么（UI 上看不到 <now>）：每轮的线索 + 浮上来的条目。
 *
 *   bun evals/chat-import/peek.ts [--n 5] [--db ~/.psyche/test/psyche.db]
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const args = process.argv.slice(2);
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const db = new Database(opt("--db") ?? join(homedir(), ".psyche/test/psyche.db"), { readonly: true });
const n = Number(opt("--n") ?? 5);

const rows = db
  .query(`SELECT at, json_extract(payload, '$.ref') AS ref, json_extract(payload, '$.source') AS source, json_extract(payload, '$.score') AS score, json_extract(payload, '$.cue') AS cue
          FROM events WHERE kind = 'surfaced' ORDER BY id DESC LIMIT 200`)
  .all() as { at: number; ref: string; source: string; score: number; cue: string }[];
// 同一次浮现写在同一毫秒附近：按线索 + 时间归成一轮
const turns: { at: number; cue: string; items: typeof rows }[] = [];
for (const r of rows) {
  const t = turns.at(-1);
  if (t && t.cue === r.cue && Math.abs(t.at - r.at) < 5000) t.items.push(r);
  else turns.push({ at: r.at, cue: r.cue, items: [r] });
}
const textOf = (ref: string) => {
  if (ref.startsWith("hunch:")) return "（预感）";
  const e = db.query(`SELECT archive_no, text FROM p_experience WHERE event_id = ?`).get(ref) as { archive_no: string; text: string } | null;
  if (e) return `[${e.archive_no}] ${e.text}`;
  const s = db.query(`SELECT archive_no, shelf, fields FROM p_shelf WHERE root = ?`).get(ref) as { archive_no: string; shelf: string; fields: string } | null;
  return s ? `[${s.archive_no}]（${s.shelf}）${JSON.parse(s.fields).text}` : ref;
};
for (const t of turns.slice(0, n).reverse()) {
  console.log(`\n${new Date(t.at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}　线索：${t.cue.replace(/\n/g, " ⏎ ").slice(0, 80)}`);
  for (const i of t.items.reverse()) console.log(`  ✦ ${i.source} ${i.score} ${textOf(i.ref).slice(0, 120)}`);
}
if (!turns.length) console.log("还没有浮现过");
