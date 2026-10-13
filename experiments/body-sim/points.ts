/** 选来对比的真实心跳唤醒轮次（时间为 UTC；本地 = +8） */
const LIFE = `${process.env.HOME}/.roxy/agent/sessions/life`;
const BACKUPS = `${process.env.HOME}/.agent-continuity-mcp/data/agents/roy/backups`;

export const POINTS = [
  {
    id: "10-09 14:38",
    note: "下午，连续第二次心跳，她一个多小时没说话",
    t: Date.parse("2026-10-09T06:38:05.010Z"),
    at: "5a2dedf8",
    session: `${LIFE}/2026-10-09T00-28-51-211Z_01a11e10-0e8b-73a2-aa13-2dd965bfcda8.jsonl`,
    db: `${BACKUPS}/memory.pre-dream-2026-10-09.db`,
  },
  {
    id: "10-10 19:30",
    note: "傍晚，她 16:57 锁屏后一直没回来",
    t: Date.parse("2026-10-10T11:30:16.634Z"),
    at: "64e302e0",
    session: `${LIFE}/2026-10-10T02-57-52-749Z_01a123be-da6d-78dc-950e-9a9f8b1065c6.jsonl`,
    db: `${BACKUPS}/memory.pre-dream-2026-10-10.db`,
  },
  {
    id: "10-12 11:23",
    note: "论文冲突的第二天上午",
    t: Date.parse("2026-10-12T03:23:51.033Z"),
    at: "a0bad9ad",
    session: `${LIFE}/2026-10-10T02-57-52-749Z_01a123be-da6d-78dc-950e-9a9f8b1065c6.jsonl`,
    db: `${BACKUPS}/memory.pre-dream-2026-10-12.db`,
  },
  {
    id: "10-12 22:52",
    note: "深夜，当天最后一次心跳",
    t: Date.parse("2026-10-12T14:52:58.626Z"),
    at: "1bab4fbe",
    session: `${LIFE}/2026-10-12T12-52-29-702Z_01a1302b-f586-72bc-8e83-97266beca6a9.jsonl`,
    db: `${BACKUPS}/memory.pre-dream-2026-10-12.db`,
  },
];
