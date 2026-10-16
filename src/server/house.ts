/**
 * 门口（P1，notes/design/soma2.md §八.1）：请求按 agent 分给各人的 app。
 *
 * 说明是谁：`x-psyche-agent` 头，或 `?agent=<id>`。只住一个人时可以不说（一代的客户端、考卷照旧）。
 * 每人的 app 自己验 token（createApp 的 bearerAuth），所以 A 的 token 进不了 B 的门。
 */
export const AGENT_HEADER = "x-psyche-agent";

type Fetch = (req: Request) => Response | Promise<Response>;

export function agentOf(req: Request): string | undefined {
  return req.headers.get(AGENT_HEADER)?.trim() || new URL(req.url).searchParams.get("agent")?.trim() || undefined;
}

export function createHouse(residents: Map<string, Fetch>): Fetch {
  const only = residents.size === 1 ? [...residents.keys()][0] : undefined;
  return (req) => {
    if (new URL(req.url).pathname === "/health") return Response.json({ ok: true });
    const id = agentOf(req) ?? only;
    if (!id) return Response.json({ error: `这里住着不止一个人：用 ${AGENT_HEADER} 头或 ?agent=<id> 说明是谁` }, { status: 400 });
    const fetch = residents.get(id);
    if (!fetch) return Response.json({ error: `这里没有住 ${id}` }, { status: 404 });
    return fetch(req);
  };
}
