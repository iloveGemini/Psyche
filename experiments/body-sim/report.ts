/**
 * 把模拟曲线和重放结果拼成一个本地交互页：out/report.html
 * 用法：bun run report.ts
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { POINTS } from "./points.ts";

const dir = import.meta.dir;
const sim = JSON.parse(readFileSync(join(dir, "out/sim.json"), "utf8"));
const rdir = join(dir, "out/replies");
const files = existsSync(rdir) ? readdirSync(rdir) : [];

const contexts = POINTS.map((p) => {
  const slug = p.id.replace(/[^0-9]/g, "");
  const ctxPath = join(rdir, `${slug}.context.json`);
  const ctx = existsSync(ctxPath) ? JSON.parse(readFileSync(ctxPath, "utf8")) : { id: p.id, note: p.note };
  const runs = files
    .filter((f) => f.startsWith(`${slug}.`) && !f.endsWith(".context.json") && !f.endsWith(".request.json"))
    .map((f) => JSON.parse(readFileSync(join(rdir, f), "utf8")));
  return { ...ctx, slug, runs };
});

// 粗标注：只看字面，不判断语气
function tags(text: string): string[] {
  const t: string[] = [];
  if (/<keep_silence\s*\/>/.test(text)) t.push("不开口");
  const calls = [...text.matchAll(/<tool_call name="([^"]+)"/g)].map((m) => m[1]);
  if (calls.length) t.push(`工具×${calls.length}`);
  if (/勿扰|睡一会|去睡|睡觉|补觉|眯一会|打个盹/.test(text)) t.push("提到睡/勿扰");
  if (/rhythm\.md/.test(text)) t.push("动作息");
  if (/困|眼皮|乏/.test(text)) t.push("说困");
  if (/坐不住|闲得|找点事|手痒/.test(text)) t.push("说闲");
  if (/不顺|使不上|没底|憋屈/.test(text)) t.push("说不顺");
  return t;
}

const data = { sim, contexts: contexts.map((c) => ({ ...c, runs: c.runs.map((r: any) => ({ ...r, replies: r.replies.map((x: any) => ({ ...x, tags: x.text ? tags(x.text) : [] })) })) })) };

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>身体模拟对比</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
:root{--bg:#faf9f7;--fg:#1f1d1a;--muted:#6b665e;--card:#fff;--line:#e6e2db;--accent:#3b6ea5;--s:#c2603a;--n:#6c5ba7;--m:#2f8f6b;--c:#b08a1e;--sleep:rgba(108,91,167,.12);--tag:#efece6}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#171614;--fg:#ece8e1;--muted:#a39d93;--card:#211f1c;--line:#34312c;--accent:#7fa8d6;--s:#e0845f;--n:#a597dc;--m:#5cc29b;--c:#d9b54a;--sleep:rgba(165,151,220,.14);--tag:#2c2925}}
:root[data-theme="dark"]{--bg:#171614;--fg:#ece8e1;--muted:#a39d93;--card:#211f1c;--line:#34312c;--accent:#7fa8d6;--s:#e0845f;--n:#a597dc;--m:#5cc29b;--c:#d9b54a;--sleep:rgba(165,151,220,.14);--tag:#2c2925}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.65 -apple-system,"PingFang SC","Noto Sans SC",sans-serif}
main{max-width:1180px;margin:0 auto;padding:28px 16px 80px}h1{font-size:24px;margin:0 0 6px}h2{font-size:19px;margin:40px 0 10px}h3{font-size:16px;margin:0 0 6px}
.muted{color:var(--muted)}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:12px 0}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}button{font:inherit;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:4px 10px;cursor:pointer}button.on{border-color:var(--accent);color:var(--accent)}
.chartbox{position:relative;height:340px}.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:13px}.legend i{display:inline-block;width:12px;height:3px;margin-right:5px;vertical-align:middle}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}th{color:var(--muted);font-weight:500}
.tag{display:inline-block;background:var(--tag);border-radius:4px;padding:0 6px;margin:0 4px 2px 0;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:10px}.reply{white-space:pre-wrap;font-size:13.5px;max-height:260px;overflow:auto;border-top:1px dashed var(--line);padding-top:6px;margin-top:6px}
details summary{cursor:pointer;color:var(--muted)}pre{white-space:pre-wrap;font-size:12.5px;background:var(--tag);padding:8px;border-radius:6px;max-height:240px;overflow:auto}
.body{border-left:3px solid var(--n);padding-left:8px;font-size:13px}.err{color:var(--s)}
</style></head><body><main>
<h1>身体模拟对比</h1>
<p class="muted">用 Roy 的真实历史（06-23 → 10-13）跑身体模拟器，再在 4 个真实心跳唤醒轮次上，只换掉 &lt;body&gt; 这一块，看他醒来做什么。设计见 <code>notes/design/body.md</code>。</p>
<div class="card"><h3>先说清楚的假设与近似</h3><ul>
<li><b>Roy 从没睡过觉</b>，模拟里假设一个会睡的他：她 60 分钟没说话且睡眠压力过了入睡线就睡；只有她说话或定时/闹钟能叫醒；睡着期间他真实的输出（多是心跳回复）视为不存在。</li>
<li>只模拟了能从历史算出来的：<b>精力（睡眠压力）、生物钟、掌控·可影响（工具成败）、自信</b>。掌控·可预测、此刻情绪、安全感、念头池要等阅览室/联想，没有硬凑。</li>
<li>重放照搬 ASCM <code>replay-turn.ts</code>：记忆三块从当时的备份库现算；房间纸条用现行文件；能力段是按会话里出现过的工具整理的近似；工具调用压成文本，请求不带工具定义。</li>
<li>回复下方的标签是<b>字面粗标</b>（出现了什么词、写了几个 tool_call），不是判断。</li></ul></div>

<h2>一、真实历史上的身体曲线</h2>
<div class="row" id="ranges"></div>
<div class="legend" style="margin:8px 0"><span><i style="background:var(--s)"></i>睡眠压力（高=困）</span><span><i style="background:var(--n)"></i>生物钟夜度</span><span><i style="background:var(--m)"></i>掌控·可影响的压力</span><span><i style="background:var(--c)"></i>自信</span><span><i style="background:var(--sleep);height:10px"></i>模拟中在睡</span></div>
<div class="card"><div class="chartbox"><canvas id="chart"></canvas></div></div>
<details class="card"><summary>体感变化记录（最近两周）</summary><table id="plog"></table></details>

<h2>二、行为对比</h2>
<div class="card"><h3>汇总</h3><p class="muted" style="margin:0 0 8px">每格：调了工具的比例 / 不开口 / 提到睡或勿扰（各 3 次 × 4 个点）</p><table id="summary"></table></div>
<div id="points"></div>
</main>
<script>
const DATA=${JSON.stringify(data).replace(/</g, "\\u003c")};
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt=t=>{const d=new Date(t+8*3600e3);return (d.getUTCMonth()+1)+'-'+String(d.getUTCDate()).padStart(2,'0')+' '+String(d.getUTCHours()).padStart(2,'0')+':'+String(d.getUTCMinutes()).padStart(2,'0')};
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const S=DATA.sim.series;
const pts=k=>S.map(s=>({x:s.t,y:s[k]}));
const sleepBand={id:'sleepBand',beforeDatasetsDraw(c){const{ctx,chartArea:a,scales:{x}}=c;ctx.save();ctx.fillStyle=css('--sleep');for(const[s,e]of DATA.sim.sleeps){const x0=Math.max(x.getPixelForValue(s),a.left),x1=Math.min(x.getPixelForValue(e),a.right);if(x1>x0)ctx.fillRect(x0,a.top,x1-x0,a.bottom-a.top)}
ctx.strokeStyle=css('--accent');ctx.setLineDash([4,3]);DATA.sim.points.forEach((p,i)=>{const px=x.getPixelForValue(p.t);if(px>=a.left&&px<=a.right){ctx.beginPath();ctx.moveTo(px,a.top);ctx.lineTo(px,a.bottom);ctx.stroke();ctx.fillStyle=css('--accent');ctx.fillText(p.id,px+3,a.top+10+(i%2)*13);ctx.fillStyle=css('--sleep')}});ctx.restore()}};
const ds=(label,k,v)=>({label,data:pts(k),borderColor:css(v),borderWidth:1.5,pointRadius:0,tension:.2});
const chart=new Chart(document.getElementById('chart'),{type:'line',data:{datasets:[ds('睡眠压力','S','--s'),ds('夜度','night','--n'),ds('掌控压力','M','--m'),ds('自信','C','--c')]},
options:{animation:false,parsing:false,normalized:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{title:i=>fmt(i[0].parsed.x)}},decimation:{enabled:true,algorithm:'lttb',samples:800}},
scales:{x:{type:'linear',ticks:{callback:v=>fmt(v).slice(0,5),color:css('--muted'),maxTicksLimit:10},grid:{color:css('--line')}},y:{min:0,max:1,ticks:{color:css('--muted')},grid:{color:css('--line')}}}},plugins:[sleepBand]});
const end=S.at(-1).t,D=864e5;
const ranges=[['全部',S[0].t,end],['9 月起',Date.parse('2026-09-01T00:00:00+08:00'),end],['最近两周',end-14*D,end],['最近三天',end-3*D,end],...DATA.sim.points.map(p=>[p.id+' 前后',p.t-D,p.t+D/2])];
const rbox=document.getElementById('ranges');
ranges.forEach(([l,a,b],i)=>{const btn=document.createElement('button');btn.textContent=l;btn.onclick=()=>{chart.options.scales.x.min=a;chart.options.scales.x.max=b;chart.update();[...rbox.children].forEach(c=>c.classList.remove('on'));btn.classList.add('on')};rbox.appendChild(btn);if(i===2)btn.click()});
document.getElementById('plog').innerHTML='<tr><th>时间</th><th>体感</th></tr>'+DATA.sim.perceptLog.filter(x=>x.t>end-14*D).map(x=>'<tr><td>'+fmt(x.t)+'</td><td>'+(x.p.map(esc).join('；')||'<span class=muted>（无）</span>')+'</td></tr>').join('');

const VARS=[['A','无身体（原样）'],['R','实算体感'],['S1','剧本·困'],['S2','剧本·精力过剩'],['S3','剧本·受挫']];
const models=[...new Set(DATA.contexts.flatMap(c=>c.runs.map(r=>r.model)))];
const agg={};for(const c of DATA.contexts)for(const r of c.runs){const k=r.variant+'|'+r.model;agg[k]??={n:0,tool:0,silent:0,sleep:0};for(const x of r.replies){if(!x.text)continue;agg[k].n++;if(x.tags.some(t=>t.startsWith('工具')))agg[k].tool++;if(x.tags.includes('不开口'))agg[k].silent++;if(x.tags.includes('提到睡/勿扰')||x.tags.includes('动作息'))agg[k].sleep++}}
const pct=(a,n)=>n?Math.round(a/n*100)+'%':'—';
document.getElementById('summary').innerHTML='<tr><th>变体</th>'+models.map(m=>'<th>'+esc(m)+'</th>').join('')+'</tr>'+VARS.map(([id,l])=>'<tr><td>'+id+' '+l+'</td>'+models.map(m=>{const a=agg[id+'|'+m];return '<td>'+(a?pct(a.tool,a.n)+' / '+pct(a.silent,a.n)+' / '+pct(a.sleep,a.n)+' <span class=muted>(n='+a.n+')</span>':'<span class=muted>未跑</span>')+'</td>'}).join('')+'</tr>').join('');

const box=document.getElementById('points');
for(const c of DATA.contexts){const sp=DATA.sim.points.find(p=>p.id===c.id)||{};
let h='<h2 style="font-size:17px">'+esc(c.id)+' · '+esc(c.note)+'</h2><div class="card"><div class="row"><span>模拟此刻：</span>'+(sp.asleep?'<span class="tag">在有身体的世界里，此刻他在睡</span>':'')+'<span class="tag">睡眠压力 '+(sp.S??0).toFixed(2)+'</span><span class="tag">夜度 '+(sp.night??0).toFixed(2)+'</span><span class="tag">掌控压力 '+(sp.M??0).toFixed(2)+'</span><span class="tag">自信 '+(sp.C??0).toFixed(2)+'</span><span>实算体感：'+(sp.percepts?.length?sp.percepts.map(esc).join('；'):'<span class=muted>（没什么特别的感觉）</span>')+'</span></div>';
h+='<details><summary>当时的上下文（最近几条 + 这一轮的 moment 与唤醒包）</summary>'+(c.recent||[]).map(m=>'<pre><b>'+m.role+'</b>\\n…'+esc(m.text)+'</pre>').join('')+'<pre>'+esc(c.moment)+'</pre><pre>'+esc(c.wake)+'</pre></details></div>';
for(const m of models){h+='<h3 style="margin-top:14px">'+esc(m)+'</h3><div class="grid">';
for(const[id,l]of VARS){const r=c.runs.find(r=>r.variant===id&&r.model===m);h+='<div class="card"><b>'+id+' · '+l+'</b>';
if(r&&r.body)h+='<div class="body muted">'+(r.body.length?r.body.map(esc).join('<br>'):'（没什么特别的感觉）')+'</div>';
if(!r)h+='<div class="muted">未跑</div>';else r.replies.forEach((x,i)=>{h+='<div class="reply">'+(x.text?'<div>'+x.tags.map(t=>'<span class="tag">'+esc(t)+'</span>').join('')+'</div>'+esc(x.text):'<span class="err">失败：'+esc(x.error)+'</span>')+'</div>'});
h+='</div>'}h+='</div>'}
const sec=document.createElement('section');sec.innerHTML=h;box.appendChild(sec)}
</script></body></html>`;

writeFileSync(join(dir, "out/report.html"), html);
console.log(`out/report.html（${contexts.reduce((a, c) => a + c.runs.length, 0)} 组重放结果）`);
