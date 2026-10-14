/** 字面匹配用的分词（浮现、recall 共用）。 */
/**
 * 实词（借 ASCM `keywordsOf` 的思路）：按词典切词，去掉虚词、代词、语气词、时间词，只留两个字以上的。
 * "那个耳机后来换了个新的" → 耳机、换、新的 → 耳机（"那个""后来"是虚的）。
 */
const SEG = new Intl.Segmenter("zh", { granularity: "word" });
const FUNCTION_CHARS = new Set("的了着过吧呢啊呀吗嘛是在有和跟与就也都还又没不要会能把被给对从到这那一个们我你他她它么怎什为所但然可以很太更最该说想知道觉得应该上下里而且或者如果因为然后现已经真好像点儿当啦哦呗嘞哈噢嗯喔哇".split(""));
const STOPWORDS = new Set(["什么", "怎么", "为什么", "这个", "那个", "我们", "你们", "他们", "可以", "不是", "就是", "还有", "然后", "但是", "所以", "现在", "已经", "觉得", "知道", "应该", "这样", "那样", "一下", "一点", "真的", "好像", "如果", "因为", "东西", "事情", "后来", "上回", "上次", "那次", "这次", "其实", "有点", "直接", "还是", "或者", "时候", "感觉", "今天", "昨天", "明天", "刚才"]);
export function keywords(s: string): string[] {
  const out = new Set<string>();
  for (const { segment: w, isWordLike } of SEG.segment(s)) {
    if (!isWordLike) continue;
    if (/^[A-Za-z0-9_.]{3,}$/.test(w)) out.add(w.toLowerCase());
    else if (/\p{Script=Han}/u.test(w) && Array.from(w).length >= 2 && !STOPWORDS.has(w) && !Array.from(w).every((c) => FUNCTION_CHARS.has(c))) out.add(w);
  }
  return [...out];
}

