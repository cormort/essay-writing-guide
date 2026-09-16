#!/usr/bin/env node
// 靜態守門員：不需要瀏覽器、不需要依賴，秒級跑完。
// 這些檢查都是「實際發生過」的問題：
//   - class=\" 反斜線逃脫殘留 → 標籤樣式整組失效（110 會考範例卡）
//   - 標題階層跳級 h2→h4 → 螢幕閱讀器與 SEO 都受影響
//   - 年度題目散落各處 → 108/110/114 三張卡與實際試題不符
//   - 外部連結失效（guwen repo 只有 22 篇，站上列了 30 篇）
//
// 用法：
//   node tools/check.mjs            # 本地檢查（不含網路）
//   node tools/check.mjs --links    # 另外逐一驗證外部連結（需要網路，較慢）
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = join(ROOT, 'index.html');
const html = readFileSync(htmlPath, 'utf8');
const papers = JSON.parse(readFileSync(join(ROOT, 'data', 'papers.json'), 'utf8'));

let passed = 0, failed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`PASS  ${name}${detail ? `  [${detail}]` : ''}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? `  [${detail}]` : ''}`); }
};

// 只取 <body> 的標記（避開 <style>/<script> 內容），供標籤配對與階層檢查使用
const bodyStart = html.indexOf('<body');
const bodyHtml = html.slice(bodyStart);
const withoutBlocks = bodyHtml
  .replace(/<script[\s\S]*?<\/script>/g, '<script></script>')
  .replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<!--[\s\S]*?-->/g, '');

console.log('=== A. 標記結構 ===');
{
  const VOID = new Set(['br', 'img', 'hr', 'meta', 'link', 'input', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);
  const stack = [];
  const errors = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m;
  while ((m = re.exec(withoutBlocks))) {
    const [, closing, rawTag, attrs] = m;
    const tag = rawTag.toLowerCase();
    if (VOID.has(tag)) continue;
    if (!closing) { stack.push({ tag, attrs, at: m.index }); continue; }
    if (!stack.length) {
      if (tag === 'html' || tag === 'body') continue;   // 從 <body 切片，結尾的 </body></html> 屬正常
      errors.push(`多餘的 </${tag}>`); continue;
    }
    if (stack[stack.length - 1].tag === tag) { stack.pop(); continue; }
    const idx = stack.map((s) => s.tag).lastIndexOf(tag);
    if (idx === -1) { errors.push(`沒有對應開標籤的 </${tag}>`); continue; }
    while (stack.length - 1 > idx) errors.push(`未閉合 <${stack.pop().tag}>（在 </${tag}> 之前）`);
    stack.pop();
  }
  stack.forEach((s) => errors.push(`未閉合 <${s.tag}>`));
  ok(`HTML 標籤全部配對（檢查 ${(withoutBlocks.match(/<[a-zA-Z]/g) || []).length} 個標籤）`,
    errors.length === 0, errors.slice(0, 5).join('；') || '0 個問題');
}
{
  // 反斜線逃脫殘留：class=\"、href=\" 之類（曾讓 6 個標籤失去樣式）
  const bad = (withoutBlocks.match(/\\"/g) || []).length;
  ok('標記屬性中沒有殘留的反斜線逃脫（class=\\"…\\"）', bad === 0, bad ? `${bad} 處` : '0 處');
}
{
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  ok(`沒有重複的 id（共 ${ids.length} 個）`, dup.length === 0, dup.join('、') || '0 個重複');
}
{
  const order = [...withoutBlocks.matchAll(/<h([1-6])[ >]/g)].map((m) => +m[1]);
  const skips = [];
  for (let i = 1; i < order.length; i++) if (order[i] - order[i - 1] > 1) skips.push(`h${order[i - 1]}→h${order[i]}`);
  ok(`標題階層沒有跳級（共 ${order.length} 個標題）`, skips.length === 0, skips.slice(0, 4).join('、') || '0 個跳級');
}
{
  const blank = [...html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)].map((m) => m[0]);
  const noRel = blank.filter((t) => !/rel="[^"]*noopener/.test(t));
  ok(`所有新視窗連結都有 rel="noopener"（共 ${blank.length} 個）`, noRel.length === 0, noRel.slice(0, 2).join(' ') || '0 個缺漏');
}

console.log('\n=== B. 內容一致性（data/papers.json 是單一真相） ===');
{
  const gsatYears = [...html.matchAll(/(\d{3})\s*學測/g)].map((m) => +m[1]);
  const missing = [];
  for (const p of papers.gsat) {
    for (const key of p.keys) if (!html.includes(key)) missing.push(`${p.year} 學測缺少「${key}」`);
  }
  ok(`學測 ${papers.gsat.length} 個年度的關鍵字都出現在頁面上`, missing.length === 0, missing.slice(0, 5).join('；') || '全部命中');
  const htmlYears = [...new Set(gsatYears)];
  const notInJson = htmlYears.filter((y) => !papers.gsat.some((p) => p.year === y));
  ok('頁面上的學測年度都在 papers.json 裡（沒有漏登記的年度）',
    notInJson.length === 0, notInJson.length ? `未登記：${notInJson.join('、')}` : `${htmlYears.length} 個年度都在清單內`);
}
{
  const missing = [];
  for (const p of papers.cap) {
    if (!html.includes(`${p.year} 年：`)) missing.push(`${p.year} 年沒有獨立卡片標題`);
    for (const key of p.keys) if (!html.includes(key)) missing.push(`${p.year} 年缺少「${key}」`);
  }
  ok(`會考 ${papers.cap.length} 個年度都有獨立卡片且關鍵字命中`, missing.length === 0, missing.slice(0, 5).join('；') || '全部命中');
  const htmlCapYears = [...new Set([...html.matchAll(/(\d{3}) 年：/g)].map((m) => +m[1]))];
  const notInJson = htmlCapYears.filter((y) => !papers.cap.some((p) => p.year === y));
  ok('頁面上的會考年度都在 papers.json 裡', notInJson.length === 0,
    notInJson.length ? `未登記：${notInJson.join('、')}` : `${htmlCapYears.length} 個年度都在清單內`);
}

console.log('\n=== C. SEO／分享／資源 ===');
{
  const need = ['<title>', 'name="description"', 'rel="canonical"', 'property="og:title"', 'property="og:image"', 'name="twitter:card"', 'application/ld+json'];
  const miss = need.filter((n) => !html.includes(n));
  ok('必要的 meta／結構化資料都在', miss.length === 0, miss.join('、') || `${need.length} 項齊全`);
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let valid = false, type = '';
  try { const j = JSON.parse(ld[1]); valid = true; type = j['@type']; } catch { /* noop */ }
  ok('JSON-LD 是可解析的合法 JSON', valid, type || '解析失敗');
  const img = html.match(/property="og:image" content="([^"]+)"/);
  const local = img && img[1].split('/').pop();
  const p = local ? join(ROOT, local) : null;
  ok(`og:image 指向的檔案存在且 < 300 KB（${local || '未設定'}）`,
    !!(p && existsSync(p) && statSync(p).size < 300 * 1024),
    p && existsSync(p) ? `${(statSync(p).size / 1024).toFixed(0)} KB` : '檔案不存在');
  ok('robots.txt 有指向 sitemap 且存在', existsSync(join(ROOT, 'robots.txt')) && readFileSync(join(ROOT, 'robots.txt'), 'utf8').includes('sitemap.xml'));
  ok('sitemap.xml 存在且指向本站', existsSync(join(ROOT, 'sitemap.xml')) && readFileSync(join(ROOT, 'sitemap.xml'), 'utf8').includes('essay-writing-guide'));
  const ga = html.includes('googletagmanager.com/gtag');
  const disclosed = html.includes('Google Analytics');
  ok('若使用 Google Analytics，頁面必須有追蹤揭露', !ga || disclosed, ga ? (disclosed ? '已揭露' : '缺少揭露') : '未使用 GA');
  ok('頁面聲明範文為教學示例（不是官方佳作）',
    html.includes('教學示例') && html.includes('不是</strong>大考中心公布的佳作'));
}

console.log('\n=== D. 對比度（小字白底需 ≥ 4.5:1，WCAG AA） ===');
{
  const lum = (hex) => {
    const c = hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05); };
  // 逐條 CSS 規則檢查：有底色就用底色算，沒有就當白底（(?<![-\w]) 排除 background-color/border-color）
  const rules = [...html.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const bad = [];
  const seen = new Set();
  for (const r of rules) {
    const fg = r.body.match(/(?<![-\w])color:\s*(#[0-9a-fA-F]{6})/);
    if (!fg) continue;
    const bg = r.body.match(/background(?:-color)?:\s*(#[0-9a-fA-F]{6})/);
    const f = fg[1].toLowerCase(), b = bg ? bg[1].toLowerCase() : '#ffffff';
    const rr = ratio(f, b);
    const key = `${f}|${b}`;
    if (rr < 4.5 && !seen.has(key)) { seen.add(key); bad.push(`${r.sel.split(',')[0]} ${f} on ${b} = ${rr.toFixed(2)}:1`); }
  }
  ok(`CSS 文字色對其底色都 ≥ 4.5:1（檢查 ${rules.filter((r) => /(?<![-\w])color:/.test(r.body)).length} 條規則）`,
    bad.length === 0, bad.slice(0, 6).join('；') || '全部合格');
  // 行內樣式（卡片裡的「💡 策略」提示都是行內 color）

  const inlineColors = [...new Set([...html.matchAll(/style="[^"]*(?<![-\w])color:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase()))];
  const badInline = inlineColors.filter((c) => ratio(c, '#ffffff') < 4.5).map((c) => `${c}（${ratio(c, '#ffffff').toFixed(2)}:1）`);
  ok(`行內樣式文字色對白底都 ≥ 4.5:1（檢查 ${inlineColors.length} 色）`, badInline.length === 0, badInline.join('、') || '全部合格');
}

console.log('\n=== E. 外部連結（--links 時才連網驗證） ===');
{
  const links = [...new Set([...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')))];
  if (!process.argv.includes('--links')) {
    console.log(`SKIP  ${links.length} 個外部連結未驗證（加上 --links 可連網檢查）`);
  } else {
    const bad = [];
    for (const url of links) {
      try {
        const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'user-agent': 'essay-guide-link-check' } });
        if (!res.ok) bad.push(`${res.status} ${url}`);
      } catch (e) { bad.push(`ERR ${url}`); }
    }
    ok(`所有外部連結都活著（共 ${links.length} 個）`, bad.length === 0, bad.slice(0, 5).join('；') || '0 個失效');
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
