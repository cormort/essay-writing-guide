#!/usr/bin/env node
// 由 index.html 產生各年度獨立頁面（cap/<年>/、gsat/<年>/）與 sitemap.xml。
// 單頁網站只有一個網址，搜尋「113 學測作文範文」時 Google 很難帶到那張卡片；
// 這裡把每個年度的卡片抽成獨立頁面，各有自己的標題、描述與 canonical。
//
// 內容只在 index.html 編輯，改完執行：
//   node tools/build-pages.mjs           # 重新產生頁面、sitemap、index.html 頁尾的年度連結
//   node tools/build-pages.mjs --check   # 只比對，產出與檔案不一致就失敗（CI 用）
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://cormort.github.io/essay-writing-guide/';
const CHECK = process.argv.includes('--check');

const indexPath = join(ROOT, 'index.html');
let index = readFileSync(indexPath, 'utf8');
const papers = JSON.parse(readFileSync(join(ROOT, 'data', 'papers.json'), 'utf8'));
const updated = papers.updated; // 用資料日期而非執行時間，產出才會穩定，CI 才比對得起來

const style = index.match(/<style>[\s\S]*?<\/style>/)[0];
const gtag = index.match(/<!-- Google tag \(gtag\.js\) -->[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/)[0];
// favicon 是內嵌 SVG，屬性值裡就有「>」，所以要比對到結尾的引號為止
const icon = index.match(/<link rel="icon" href="[^"]*">/)[0];
if (!icon.includes('</svg>')) throw new Error('favicon 標籤沒有完整擷取（會讓 <head> 之後的內容被當成正文顯示）');
const ogImage = index.match(/property="og:image" content="([^"]+)"/)[1];

const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// 依 id 取出整張卡片（含巢狀的 div）
function outerById(id) {
  const at = index.indexOf(` id="${id}"`);
  if (at < 0) throw new Error(`index.html 找不到 id="${id}"`);
  const start = index.lastIndexOf('<div', at);
  const re = /<\/?div\b[^>]*>/g;
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(index))) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return index.slice(start, re.lastIndex);
  }
  throw new Error(`id="${id}" 的 div 沒有閉合`);
}
const h3Of = (card) => strip(card.match(/<h3>([\s\S]*?)<\/h3>/)[1]);

// 卡片放進獨立頁面：標題升一級（頁面有 h1），頁內不存在的錨點改指回主頁
function adapt(card, idsOnPage) {
  return card
    .replace(/<h3>([\s\S]*?)<\/h3>/, '<h2>$1</h2>')
    .replace(/href="#([^"]+)"/g, (all, id) => (idsOnPage.includes(id) ? all : `href="../../#${id}"`));
}
function describe(cards) {
  const topic = cards.join('').match(/<span class="label label-body">題目<\/span>([\s\S]*?)<\/p>/);
  const text = topic ? strip(topic[1]) : strip(cards.join('').match(/<br>\s*([^<]{30,})<\/p>/)[1]);
  return text.length > 110 ? `${text.slice(0, 108)}……` : text;
}

const pages = [];
const capYears = papers.cap.map((p) => p.year);
for (const y of capYears) {
  const ids = [`g${y}`];
  const cards = ids.map(outerById);
  const topic = h3Of(cards[0]).replace(/^\d+ 年：/, '');
  pages.push({
    kind: 'cap', year: y, ids, cards, dir: `cap/${y}`,
    title: `${y} 會考作文「${topic}」範文與解析`,
    lead: `國中教育會考 ${y} 年寫作測驗：題目重點、範文與每段的寫作策略。`,
    home: 'Tab1', homeLabel: '會考專區', series: capYears,
  });
}
const gsatYears = papers.gsat.map((p) => p.year);
for (const y of gsatYears) {
  const ids = y === 115 ? ['s115', 's115i', 's115e'] : [`s${y}`, `s${y}e`];
  const cards = ids.map(outerById);
  const topic = y === 115
    ? `${h3Of(cards[1]).split('：')[1]}（知性題）／${h3Of(cards[2]).split('：')[1]}（情意題）`
    : h3Of(cards[0]).replace(/^\d+ 學測：/, '');
  pages.push({
    kind: 'gsat', year: y, ids, cards, dir: `gsat/${y}`,
    title: `${y} 學測國寫範文：${topic}`,
    lead: `學測國語文寫作能力測驗 ${y} 年：知性題分題範答與情意題完整範文，附每段的寫作策略。`,
    home: 'Tab2', homeLabel: '學測專區', series: gsatYears,
  });
}

function render(pg) {
  const url = `${SITE}${pg.dir}/`;
  const desc = describe(pg.cards);
  const fullTitle = `${pg.title}｜高分作文解題策略`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'LearningResource', name: pg.title, description: desc,
    inLanguage: 'zh-TW', url, educationalLevel: pg.kind === 'cap' ? '國中' : '高中', isAccessibleForFree: true,
    isPartOf: { '@type': 'LearningResource', name: '高分作文解題策略與實例分析', url: SITE },
    author: { '@type': 'Person', name: 'cormort' },
  };
  const i = pg.series.indexOf(pg.year);
  const link = (y, label) => `<a href="../${y}/">${label}</a>`;
  const nav = [
    i > 0 ? link(pg.series[i - 1], `← ${pg.series[i - 1]}`) : '',
    ...pg.series.map((y) => (y === pg.year ? `<a aria-current="page">${y}</a>` : link(y, y))),
    i < pg.series.length - 1 ? link(pg.series[i + 1], `${pg.series[i + 1]} →`) : '',
  ].filter(Boolean).join('\n ');
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
 <meta charset="UTF-8">
 <meta name="viewport" content="width=device-width, initial-scale=1.0">
 <title>${esc(fullTitle)}</title>
 <meta name="description" content="${esc(desc)}">
 <link rel="canonical" href="${url}">
 <meta name="theme-color" content="#2c3e50">
 <meta name="color-scheme" content="light">
 <meta property="og:title" content="${esc(fullTitle)}">
 <meta property="og:description" content="${esc(desc)}">
 <meta property="og:type" content="article">
 <meta property="og:url" content="${url}">
 <meta property="og:locale" content="zh_TW">
 <meta property="og:site_name" content="高分作文解題策略與實例分析">
 <meta property="og:image" content="${ogImage}">
 <meta name="twitter:card" content="summary_large_image">
 ${icon}
 <script type="application/ld+json">
 ${JSON.stringify(ld)}
 </script>
 ${style}
${gtag}
</head>
<body>
 <!-- 本頁由 tools/build-pages.mjs 從 index.html 產生，請勿直接編輯 -->
 <a class="skip-link" href="#main">跳至主要內容</a>
 <p class="subtitle"><a href="../../#${pg.home}">高分作文解題策略與實例分析</a> ／ ${pg.homeLabel}</p>
 <h1>${pg.title}</h1>
 <p class="subtitle">${pg.lead}</p>
 <div id="main" tabindex="-1">
${pg.cards.map((c) => adapt(c, pg.ids)).join('\n\n')}
 </div>
 <nav class="dimension-nav" aria-label="其他年度">
 ${nav}
 </nav>
 <p class="ref-tip">想先學拆題方法？回到主頁的 <a href="../../#${pg.home}">${pg.homeLabel}：四維矩陣</a>，或看 <a href="../../#Tab3">實戰演練</a>。</p>
 <footer class="site-footer">
 <p><strong>關於本站範文：</strong>各年度範文皆為<strong>教學示例</strong>（主筆依題意撰寫），<strong>不是</strong>大考中心或心測中心公布的佳作；歷屆題目以官方公告為準。</p>
 <p><strong>隱私與追蹤：</strong>本站使用 Google Analytics（gtag.js）統計瀏覽人次，未設定任何廣告或跨站追蹤；相關資料處理請見 <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google 隱私權政策</a>。</p>
 <p>最後更新：${updated}</p>
 </footer>
</body>
</html>
`;
}

const outputs = new Map();
for (const pg of pages) outputs.set(join(ROOT, pg.dir, 'index.html'), render(pg));

const urls = [SITE, ...pages.map((pg) => `${SITE}${pg.dir}/`)];
outputs.set(join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${u}</loc>
    <lastmod>${updated}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${u === SITE ? '1.0' : '0.8'}</priority>
  </url>`).join('\n')}
</urlset>
`);

// 主頁頁尾的年度連結（主頁連到各年度頁面，搜尋引擎才找得到）
const list = (kind, label) => `${label} ${pages.filter((p) => p.kind === kind).map((p) => `<a href="${p.dir}/">${p.year}</a>`).join('、')}`;
const block = `<!-- year-pages:start -->\n <p><strong>各年度單獨頁面：</strong>${list('cap', '會考')}；${list('gsat', '學測')}</p>\n <!-- year-pages:end -->`;
const newIndex = index.replace(/<!-- year-pages:start -->[\s\S]*?<!-- year-pages:end -->/, block);
if (newIndex === index && !index.includes(block)) throw new Error('index.html 找不到 year-pages 標記');
outputs.set(indexPath, newIndex);

let stale = [];
for (const [path, content] of outputs) {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (current === content) continue;
  stale.push(path.slice(ROOT.length + 1));
  if (!CHECK) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
}
if (CHECK) {
  if (stale.length) {
    console.log(`FAIL  年度頁面與 index.html 不同步（${stale.length} 個檔案）：${stale.slice(0, 5).join('、')}`);
    console.log('      請執行 node tools/build-pages.mjs 後一併提交。');
    process.exit(1);
  }
  console.log(`PASS  ${pages.length} 個年度頁面、sitemap 與主頁連結都和 index.html 同步`);
} else {
  console.log(`產生 ${pages.length} 個年度頁面；更新 ${stale.length} 個檔案${stale.length ? `：${stale.join('、')}` : ''}`);
}
