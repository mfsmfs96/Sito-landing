/* ---------- Persisted preferences ---------- */
const store={
  get(k,d){try{return localStorage.getItem(k)??d}catch(e){return d}},
  set(k,v){try{localStorage.setItem(k,v)}catch(e){}}
};

/* ---------- Theme ---------- */
const themeToggle=document.querySelector("#themeToggle");
function applyTheme(t){
  if(t)document.documentElement.setAttribute("data-theme",t);
  else document.documentElement.removeAttribute("data-theme");
}
function effectiveTheme(){
  return savedTheme||(matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light");
}
let savedTheme=store.get("pulse-theme","dark");
applyTheme(savedTheme);
themeToggle.addEventListener("click",()=>{
  const current=effectiveTheme();
  savedTheme=current==="dark"?"light":"dark";
  store.set("pulse-theme",savedTheme);
  applyTheme(savedTheme);
  buildTradingViewWidgets();
});

/* ---------- Tabs ---------- */
const TABS=["indici","crypto","titoli","difesa","militare","armi","tech","radar","tv","mappa"];
let currentTab=TABS[0];
function activateTab(tab,persist=true){
  if(!TABS.includes(tab))return;
  currentTab=tab;
  document.querySelectorAll("#tabs .tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
  document.querySelectorAll(".tabpanel").forEach(p=>p.classList.toggle("active",p.id==="tab-"+tab));
  if(persist)store.set("pulse-tab",tab);
  if(NEWS_TAB_CATEGORY[tab])loadCategoryNews(NEWS_TAB_CATEGORY[tab]);
  if(tab==="radar")loadRadar();
}
document.querySelectorAll("#tabs .tab").forEach(btn=>{
  btn.addEventListener("click",()=>activateTab(btn.dataset.tab));
});
const NEWS_TAB_CATEGORY={difesa:"generale",militare:"militari",armi:"armamenti",tech:"tecnologia"};

/* ---------- TradingView widgets (indices, commodities, per-exchange movers) ---------- */
function mountTradingViewWidget(container,scriptSrc,config){
  container.innerHTML="";
  const wrap=document.createElement("div");
  wrap.className="tradingview-widget-container";
  wrap.style.height="100%";
  wrap.style.width="100%";
  const inner=document.createElement("div");
  inner.className="tradingview-widget-container__widget";
  inner.style.height="100%";
  inner.style.width="100%";
  wrap.appendChild(inner);
  const script=document.createElement("script");
  script.type="text/javascript";
  script.src=scriptSrc;
  script.async=true;
  script.text=JSON.stringify(config);
  wrap.appendChild(script);
  container.appendChild(wrap);
}

function buildTradingViewWidgets(){
  const theme=effectiveTheme();

  mountTradingViewWidget(
    document.querySelector("#tvMarketOverview"),
    "https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js",
    {
      colorTheme:theme,
      dateRange:"1D",
      showChart:false,
      locale:"it",
      isTransparent:true,
      showSymbolLogo:true,
      showFloatingTooltip:true,
      width:"100%",
      height:"100%",
      tabs:[
        {title:"Indici",symbols:[
          {s:"INDEX:FTSEMIB",d:"FTSE MIB"},
          {s:"EURONEXT:PX1",d:"CAC 40"},
          {s:"TVC:UKX",d:"FTSE 100"},
          {s:"FOREXCOM:DJI",d:"Dow Jones"},
          {s:"FOREXCOM:SPXUSD",d:"S&P 500"},
          {s:"FOREXCOM:NSXUSD",d:"Nasdaq 100"},
          {s:"TVC:HSI",d:"Hang Seng"}
        ]},
        {title:"Materie prime",symbols:[
          {s:"TVC:GOLD",d:"Oro"},
          {s:"TVC:SILVER",d:"Argento"},
          {s:"TVC:USOIL",d:"Petrolio WTI"},
          {s:"TVC:UKOIL",d:"Petrolio Brent"},
          {s:"TVC:NATURALGAS",d:"Gas naturale"},
          {s:"TVC:COPPER",d:"Rame"}
        ]}
      ]
    }
  );

  mountTradingViewWidget(
    document.querySelector("#tvScreener"),
    "https://s3.tradingview.com/external-embedding/embed-widget-screener.js",
    {
      width:"100%",
      height:"100%",
      defaultColumn:"performance",
      defaultScreen:"general",
      market:"italy",
      showToolbar:true,
      colorTheme:theme,
      locale:"it",
      isTransparent:true
    }
  );
}
buildTradingViewWidgets();

/* ---------- Clock ---------- */
const clock=document.querySelector("#clock");
function tickClock(){clock.textContent=new Date().toLocaleTimeString("it-IT")}
setInterval(tickClock,1000);
tickClock();

/* ---------- Crypto prices (Coinbase WebSocket, CoinGecko fallback + details) ---------- */
const PRODUCTS=["BTC-USD","ETH-USD","SOL-USD","XRP-USD","ADA-USD","DOGE-USD","LTC-USD"];
const COINGECKO_MAP={"BTC-USD":"bitcoin","ETH-USD":"ethereum","SOL-USD":"solana","XRP-USD":"ripple","ADA-USD":"cardano","DOGE-USD":"dogecoin","LTC-USD":"litecoin"};

const priceGrid=document.querySelector("#priceGrid");
const statusDot=document.querySelector("#statusDot");
const marketStatus=document.querySelector("#marketStatus");
const tickerTrack=document.querySelector("#tickerTrack");

const cards={};
const marketsData={};

function fmtPrice(price){
  return "$"+price.toLocaleString("en-US",{minimumFractionDigits:price<10?4:2,maximumFractionDigits:price<10?4:2});
}

PRODUCTS.forEach(sym=>{
  const el=document.createElement("div");
  el.className="price-card skeleton";
  el.innerHTML=`<div class="sym">${sym.replace("-","/")}</div><div class="val">—</div><div class="chg">—</div>
    <svg class="spark" viewBox="0 0 100 34" preserveAspectRatio="none"><path/></svg>`;
  el.addEventListener("click",()=>openCoinModal(sym));
  priceGrid.appendChild(el);
  cards[sym]={el,val:el.querySelector(".val"),chg:el.querySelector(".chg"),spark:el.querySelector(".spark path"),last:null};
});

function buildTicker(){
  const row=PRODUCTS.map(sym=>`
    <span class="ticker-item" data-tsym="${sym}">
      <span class="t-sym">${sym.replace("-","/")}</span>
      <span class="t-val">—</span>
      <span class="t-chg">—</span>
    </span>
  `).join("");
  tickerTrack.innerHTML=row+row;
}
buildTicker();
function updateTicker(sym,price,changePct){
  document.querySelectorAll(`.ticker-item[data-tsym="${sym}"]`).forEach(item=>{
    item.querySelector(".t-val").textContent=fmtPrice(price);
    if(isFinite(changePct)){
      const c=item.querySelector(".t-chg");
      c.textContent=(changePct>=0?"+":"")+changePct.toFixed(2)+"%";
      c.className="t-chg "+(changePct>=0?"up":"down");
    }
  });
}

function setMarketStatus(state,text){
  statusDot.className="dot "+state;
  marketStatus.textContent=text;
  marketStatus.style.color=state==="live"?"var(--up)":state==="error"?"var(--down)":"var(--muted)";
}

function updateCard(sym,price,changePct){
  const c=cards[sym];
  if(!c||!isFinite(price))return;
  c.el.classList.remove("skeleton");
  const prev=c.last;
  c.val.textContent=fmtPrice(price);
  if(isFinite(changePct)){
    c.chg.textContent=(changePct>=0?"+":"")+changePct.toFixed(2)+"%";
    c.chg.className="chg "+(changePct>=0?"up":"down");
  }
  if(prev!=null&&price!==prev){
    c.el.classList.remove("flash-up","flash-down");
    void c.el.offsetWidth;
    c.el.classList.add(price>prev?"flash-up":"flash-down");
  }
  c.last=price;
  updateTicker(sym,price,changePct);
}

function sparkPath(prices){
  if(!prices||prices.length<2)return"";
  const min=Math.min(...prices),max=Math.max(...prices);
  const range=(max-min)||1;
  const stepX=100/(prices.length-1);
  return prices.map((p,i)=>{
    const x=(i*stepX).toFixed(2);
    const y=(32-((p-min)/range)*30).toFixed(2);
    return (i===0?"M":"L")+x+","+y;
  }).join(" ");
}
function renderSparkline(sym,prices){
  const c=cards[sym];
  if(!c||!prices||prices.length<2)return;
  c.spark.setAttribute("d",sparkPath(prices));
  c.spark.setAttribute("class",prices[prices.length-1]>=prices[0]?"up":"down");
}

let ws=null,wsOpened=false,reconnectDelay=1000,pollTimer=null;

function startWebSocket(){
  ws=new WebSocket("wss://ws-feed.exchange.coinbase.com");
  const openTimeout=setTimeout(()=>{if(!wsOpened){ws.close();startPollingFallback()}},5000);
  ws.onopen=()=>{
    wsOpened=true;clearTimeout(openTimeout);
    ws.send(JSON.stringify({type:"subscribe",channels:[{name:"ticker",product_ids:PRODUCTS}]}));
    setMarketStatus("live","Live");
    reconnectDelay=1000;
    if(pollTimer){clearInterval(pollTimer);pollTimer=null}
  };
  ws.onmessage=ev=>{
    try{
      const msg=JSON.parse(ev.data);
      if(msg.type==="ticker"&&msg.product_id&&msg.price){
        const price=parseFloat(msg.price);
        const open=parseFloat(msg.open_24h);
        const changePct=open?((price-open)/open)*100:NaN;
        updateCard(msg.product_id,price,changePct);
      }
    }catch(e){}
  };
  ws.onclose=()=>{
    wsOpened=false;
    setMarketStatus("error","Riconnessione…");
    startPollingFallback();
    setTimeout(startWebSocket,reconnectDelay);
    reconnectDelay=Math.min(reconnectDelay*2,30000);
  };
  ws.onerror=()=>ws.close();
}

async function pollPricesOnce(){
  try{
    const ids=Object.values(COINGECKO_MAP).join(",");
    const res=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
    const data=await res.json();
    Object.entries(COINGECKO_MAP).forEach(([sym,id])=>{
      const entry=data[id];
      if(entry)updateCard(sym,entry.usd,entry.usd_24h_change||0);
    });
  }catch(e){}
}
function startPollingFallback(){
  if(pollTimer)return;
  pollPricesOnce();
  pollTimer=setInterval(pollPricesOnce,15000);
}

/* Richer market data (sparkline + stats) — independent of the WS/fallback price feed */
const MARKET_DETAILS_MS=5*60*1000;
async function loadMarketDetails(){
  try{
    const ids=Object.values(COINGECKO_MAP).join(",");
    const res=await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&sparkline=true&price_change_percentage=24h`);
    const rows=await res.json();
    const bySymId=Object.fromEntries(Object.entries(COINGECKO_MAP).map(([sym,id])=>[id,sym]));
    rows.forEach(row=>{
      const sym=bySymId[row.id];
      if(!sym)return;
      marketsData[sym]=row;
      renderSparkline(sym,row.sparkline_in_7d?.price);
      if(!wsOpened)updateCard(sym,row.current_price,row.price_change_percentage_24h);
    });
  }catch(e){}
}

pollPricesOnce();
startWebSocket();
loadMarketDetails();
setInterval(loadMarketDetails,MARKET_DETAILS_MS);

/* ---------- Fear & Greed gauge ---------- */
const fngArc=document.querySelector("#fngArc");
const fngNeedle=document.querySelector("#fngNeedle");
const fngValue=document.querySelector("#fngValue");
const fngLabel=document.querySelector("#fngLabel");
const FNG_LABELS_IT={
  "Extreme Fear":"Paura estrema","Fear":"Paura","Neutral":"Neutrale",
  "Greed":"Avidità","Extreme Greed":"Avidità estrema"
};
async function loadFearGreed(){
  try{
    const res=await fetch("https://api.alternative.me/fng/?limit=1");
    const data=await res.json();
    const point=data.data[0];
    const value=parseInt(point.value,10);
    const arcLen=157;
    fngArc.style.strokeDashoffset=arcLen*(1-value/100);
    fngArc.style.stroke=value<25?"var(--down)":value<50?"#ff9f0a":value<75?"#a8d34a":"var(--up)";
    fngNeedle.style.transform=`rotate(${-90+(value/100)*180}deg)`;
    fngValue.textContent=value;
    fngLabel.textContent=(FNG_LABELS_IT[point.value_classification]||point.value_classification);
  }catch(e){
    fngLabel.textContent="non disponibile";
  }
}
loadFearGreed();
setInterval(loadFearGreed,10*60*1000);

/* ---------- Coin detail modal ---------- */
const coinModal=document.querySelector("#coinModal");
const modalSym=document.querySelector("#modalSym");
const modalPrice=document.querySelector("#modalPrice");
const modalChg=document.querySelector("#modalChg");
const modalChart=document.querySelector("#modalChart");
const modalStats=document.querySelector("#modalStats");

function closeCoinModal(){coinModal.classList.remove("show")}
document.querySelector("#coinModalClose").addEventListener("click",closeCoinModal);
coinModal.addEventListener("click",e=>{if(e.target===coinModal)closeCoinModal()});

function fmtCompact(n){
  if(n==null)return"—";
  return new Intl.NumberFormat("it-IT",{notation:"compact",maximumFractionDigits:2}).format(n);
}
function openCoinModal(sym){
  const row=marketsData[sym];
  modalSym.textContent=sym.replace("-","/");
  if(!row){
    modalPrice.textContent=cards[sym]?.val.textContent||"—";
    modalChg.textContent="";
    modalChart.innerHTML="";
    modalStats.innerHTML='<div class="stat"><div class="stat-label">Dettagli</div><div class="stat-value">non ancora disponibili</div></div>';
    coinModal.classList.add("show");
    return;
  }
  const up=row.price_change_percentage_24h>=0;
  modalPrice.textContent=fmtPrice(row.current_price);
  modalChg.textContent=(up?"+":"")+row.price_change_percentage_24h.toFixed(2)+"% (24h)";
  modalChg.className="modal-chg "+(up?"up":"down");

  const prices=row.sparkline_in_7d?.price||[];
  if(prices.length>1){
    const min=Math.min(...prices),max=Math.max(...prices),range=(max-min)||1;
    const stepX=600/(prices.length-1);
    const linePath=prices.map((p,i)=>{
      const x=(i*stepX).toFixed(2);
      const y=(200-((p-min)/range)*180-10).toFixed(2);
      return (i===0?"M":"L")+x+","+y;
    }).join(" ");
    const areaPath=linePath+` L600,220 L0,220 Z`;
    const gradId="grad-"+sym.replace(/[^a-z]/gi,"");
    modalChart.innerHTML=`
      <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${up?"var(--up)":"var(--down)"}" stop-opacity=".25"/>
        <stop offset="100%" stop-color="${up?"var(--up)":"var(--down)"}" stop-opacity="0"/>
      </linearGradient></defs>
      <path class="area" d="${areaPath}" fill="url(#${gradId})"/>
      <path class="line ${up?"up":"down"}" d="${linePath}"/>
    `;
  }else{
    modalChart.innerHTML="";
  }

  modalStats.innerHTML=`
    <div class="stat"><div class="stat-label">Max 24h</div><div class="stat-value">${fmtPrice(row.high_24h)}</div></div>
    <div class="stat"><div class="stat-label">Min 24h</div><div class="stat-value">${fmtPrice(row.low_24h)}</div></div>
    <div class="stat"><div class="stat-label">Cap. di mercato</div><div class="stat-value">$${fmtCompact(row.market_cap)}</div></div>
    <div class="stat"><div class="stat-label">Volume 24h</div><div class="stat-value">$${fmtCompact(row.total_volume)}</div></div>
    <div class="stat"><div class="stat-label">All-time high</div><div class="stat-value">${fmtPrice(row.ath)}</div></div>
    <div class="stat"><div class="stat-label">Da ATH</div><div class="stat-value">${row.ath_change_percentage.toFixed(1)}%</div></div>
  `;
  coinModal.classList.add("show");
}

/* ---------- News (rss2json bridge, defense/security focus) ---------- */
const RSS2JSON="https://api.rss2json.com/v1/api.json?rss_url=";
const NEWS_REFRESH_MS=3*60*1000;

function googleNewsUrl(query,lang){
  const q=encodeURIComponent(query);
  return lang==="en"
    ?`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`
    :`https://news.google.com/rss/search?q=${q}&hl=it&gl=IT&ceid=IT:it`;
}

/* Curated international + Italian defense/security outlets (fetched once, shared across categories) */
const CURATED_DEFENSE_FEEDS=[
  "https://www.defensenews.com/arc/outboundfeeds/rss/",
  "https://breakingdefense.com/feed/",
  "https://www.twz.com/feed",
  "https://www.navalnews.com/feed/",
  "https://www.defenseone.com/rss/all/",
  "https://www.airandspaceforces.com/feed/",
  "https://theaviationist.com/feed/",
  "https://www.analisidifesa.it/feed/"
];

/* Extra Google News queries (IT + EN) that supplement each tab's coverage */
const CATEGORY_QUERIES={
  generale:[["difesa sicurezza militare mondo","it"],["defense security military world","en"]],
  militari:[["affari militari esercito forze armate NATO","it"],["military affairs armed forces NATO alliance","en"]],
  armamenti:[["armamenti missili armi carri armati vendita di armi","it"],["weapons missiles arms deal fighter jet tank","en"]],
  tecnologia:[["tecnologia militare droni intelligenza artificiale ipersonico","it"],["military technology drone hypersonic AI cyber defense","en"]]
};

/* Keywords used to bucket the curated pool into each sub-topic */
const CATEGORY_KEYWORDS={
  militari:["nato","alliance","alleanza","deployment","dispiegamento","exercise","esercitazione","budget","bilancio","treaty","trattato","sanction","sanzioni","troop","truppe","ministry","ministero","parliament","parlamento","summit","vertice","personnel","recruit","veteran","alliance"],
  armamenti:["missile","tank","carro armato","jet","caccia","fighter","submarine","sommergibile","frigate","fregata","destroyer","rifle","fucile","artillery","artiglieria","howitzer","warhead","testata","ammunition","munizioni","arms deal","weapon","arma","armi"],
  tecnologia:["drone","droni","artificial intelligence","intelligenza artificiale","cyber","satellite","space force","spaziali","hypersonic","ipersonico","radar","stealth","furtivo","quantum","quantistico","robot","autonomous","autonomo","laser"]
};

/* ---------- Defense-industry company tagging (informational only, not investment advice) ---------- */
const DEFENSE_COMPANIES=[
  {name:"Lockheed Martin",aliases:["lockheed martin","lockheed"],symbol:"NYSE:LMT"},
  {name:"RTX / Raytheon",aliases:["raytheon","rtx corporation","rtx corp"],symbol:"NYSE:RTX"},
  {name:"Northrop Grumman",aliases:["northrop grumman","northrop"],symbol:"NYSE:NOC"},
  {name:"General Dynamics",aliases:["general dynamics"],symbol:"NYSE:GD"},
  {name:"Boeing",aliases:["boeing"],symbol:"NYSE:BA"},
  {name:"L3Harris",aliases:["l3harris","l3 harris"],symbol:"NYSE:LHX"},
  {name:"Huntington Ingalls",aliases:["huntington ingalls"],symbol:"NYSE:HII"},
  {name:"Textron",aliases:["textron"],symbol:"NYSE:TXT"},
  {name:"Leidos",aliases:["leidos"],symbol:"NYSE:LDOS"},
  {name:"Kratos Defense",aliases:["kratos defense","kratos"],symbol:"NASDAQ:KTOS"},
  {name:"AeroVironment",aliases:["aerovironment"],symbol:"NASDAQ:AVAV"},
  {name:"Palantir",aliases:["palantir"],symbol:"NASDAQ:PLTR"},
  {name:"BAE Systems",aliases:["bae systems"],symbol:"LSE:BA."},
  {name:"Rheinmetall",aliases:["rheinmetall"],symbol:"XETR:RHM"},
  {name:"Thales",aliases:["thales"],symbol:"EURONEXT:HO"},
  {name:"Leonardo",aliases:["leonardo spa","leonardo s.p.a","leonardo drs"],symbol:"MIL:LDO"},
  {name:"Saab",aliases:["saab ab","saab group"],symbol:"OMXSTO:SAAB_B"},
  {name:"Elbit Systems",aliases:["elbit systems","elbit"],symbol:"NASDAQ:ESLT"},
  {name:"Kongsberg",aliases:["kongsberg"],symbol:"EURONEXT:KOG"},
  {name:"Fincantieri",aliases:["fincantieri"],symbol:"MIL:FCT"},
  {name:"Dassault Aviation",aliases:["dassault aviation"],symbol:"EURONEXT:AM"},
  {name:"Hensoldt",aliases:["hensoldt"],symbol:"XETR:HAG"},
  {name:"Airbus",aliases:["airbus"],symbol:"EURONEXT:AIR"},
  {name:"Babcock International",aliases:["babcock international"],symbol:"LSE:BAB"}
];
function tagCompanies(title){
  const t=title.toLowerCase();
  return DEFENSE_COMPANIES.filter(c=>c.aliases.some(a=>t.includes(a)));
}
const DEAL_KEYWORDS=["contract","deal","award","order","procurement","tender","agreement","acquisition","acquire","stake","invest","funding","billion","million","$","€","accordo","contratto","commessa","appalto","acquisizione","investimento","miliardi","milioni"];
function isDealNews(title){
  const t=title.toLowerCase();
  return DEAL_KEYWORDS.some(k=>t.includes(k));
}

function timeAgo(dateStr){
  const diff=Math.max(0,(Date.now()-new Date(dateStr).getTime())/1000);
  if(diff<60)return"ora";
  if(diff<3600)return Math.floor(diff/60)+" min fa";
  if(diff<86400)return Math.floor(diff/3600)+" h fa";
  return Math.floor(diff/86400)+" g fa";
}
function hostFromUrl(url){
  try{return new URL(url).hostname.replace(/^www\./,"")}catch(e){return""}
}
function renderNewsSkeleton(listEl,count=6){
  listEl.innerHTML=Array.from({length:count}).map(()=>`
    <li class="news-item skeleton">
      <span class="val" style="display:block;width:80%;height:16px"></span>
      <div class="meta"><span class="chg" style="width:60px;height:12px"></span></div>
    </li>
  `).join("");
}
function companyBadges(title){
  const companies=tagCompanies(title);
  if(!companies.length)return"";
  return `<div class="company-tags">`+companies.map(c=>
    `<a class="company-tag" href="https://www.tradingview.com/symbols/${encodeURIComponent(c.symbol.replace(":","-").replace(".",""))}/" target="_blank" rel="noopener noreferrer" title="Vedi quotazione ${c.name}">${c.name}</a>`
  ).join("")+`</div>`;
}
function renderNewsList(listEl,items){
  listEl.innerHTML=items.slice(0,24).map(item=>`
    <li class="news-item">
      <a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.title}</a>
      <div class="meta">
        <span class="src">${item.source}</span><span>${timeAgo(item.date)}</span>
        ${isDealNews(item.title)?'<span class="deal-badge">DEAL</span>':""}
      </div>
      ${companyBadges(item.title)}
    </li>
  `).join("");
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function fetchOne(feed,attempt=0){
  try{
    const res=await fetch(RSS2JSON+encodeURIComponent(feed));
    const data=await res.json();
    if(data.status!=="ok")throw new Error(data.message||"bad feed");
    return data.items.map(it=>({title:it.title,url:it.link,date:it.pubDate,source:hostFromUrl(it.link)}));
  }catch(e){
    if(attempt<2){await sleep(2500*(attempt+1));return fetchOne(feed,attempt+1)}
    return[];
  }
}
async function fetchFeeds(feeds){
  const results=[];
  for(const feed of feeds){
    results.push(fetchOne(feed));
    if(feeds.length>1)await sleep(250);
  }
  const items=(await Promise.all(results)).flat();
  items.sort((a,b)=>new Date(b.date)-new Date(a.date));
  return items;
}
function dedupeByUrl(items){
  const seen=new Set(),out=[];
  for(const item of items){
    const key=item.url.split("?")[0];
    if(seen.has(key))continue;
    seen.add(key);out.push(item);
  }
  return out;
}

/* Cache-aware loader: keeps showing the last successful result if a refresh fails,
   instead of blanking the list on a transient rss2json rate limit. */
const newsCache=new Map();
async function cachedNews(key,ttlMs,fetcher){
  const cached=newsCache.get(key);
  const now=Date.now();
  if(cached&&now-cached.ts<ttlMs)return{items:cached.items,ts:cached.ts};
  try{
    const items=await fetcher();
    if(items.length){newsCache.set(key,{items,ts:now});return{items,ts:now}}
    if(cached)return{items:cached.items,ts:cached.ts};
    return{items:[],ts:now};
  }catch(e){
    if(cached)return{items:cached.items,ts:cached.ts};
    return{items:[],ts:now};
  }
}

const CATEGORY_ELEMENTS={
  generale:{list:document.querySelector("#newsList-generale"),updated:document.querySelector("#newsUpdated-generale")},
  militari:{list:document.querySelector("#newsList-militari"),updated:document.querySelector("#newsUpdated-militari")},
  armamenti:{list:document.querySelector("#newsList-armamenti"),updated:document.querySelector("#newsUpdated-armamenti")},
  tecnologia:{list:document.querySelector("#newsList-tecnologia"),updated:document.querySelector("#newsUpdated-tecnologia")}
};

let curatedPool=null,curatedPoolPromise=null;
async function getCuratedPool(){
  if(curatedPool)return curatedPool;
  if(!curatedPoolPromise)curatedPoolPromise=fetchFeeds(CURATED_DEFENSE_FEEDS);
  curatedPool=await curatedPoolPromise;
  return curatedPool;
}
function refreshCuratedPool(){
  curatedPool=null;
  curatedPoolPromise=fetchFeeds(CURATED_DEFENSE_FEEDS);
  curatedPoolPromise.then(items=>curatedPool=items);
}
setInterval(refreshCuratedPool,NEWS_REFRESH_MS);

function renderEmptyState(listEl,text){
  listEl.innerHTML=`<li class="news-item empty">${text}</li>`;
}
async function loadCategoryNews(cat){
  const{list,updated}=CATEGORY_ELEMENTS[cat];
  if(!newsCache.has("cat:"+cat))renderNewsSkeleton(list);
  const{items,ts}=await cachedNews("cat:"+cat,NEWS_REFRESH_MS,async()=>{
    const pool=await getCuratedPool();
    const queries=CATEGORY_QUERIES[cat]||[];
    const queryItems=await fetchFeeds(queries.map(([q,lang])=>googleNewsUrl(q,lang)));
    const keywords=CATEGORY_KEYWORDS[cat];
    const poolItems=keywords
      ?pool.filter(it=>{const t=it.title.toLowerCase();return keywords.some(k=>t.includes(k))})
      :pool;
    return dedupeByUrl([...poolItems,...queryItems]).sort((a,b)=>new Date(b.date)-new Date(a.date));
  });
  if(items.length){
    renderNewsList(list,items);
    updated.textContent="aggiornato "+new Date(ts).toLocaleTimeString("it-IT");
  }else{
    renderEmptyState(list,"Nessuna notizia disponibile al momento, riprovo tra poco…");
    updated.textContent="feed non disponibile, riprovo…";
  }
}
setInterval(()=>{
  const cat=NEWS_TAB_CATEGORY[currentTab];
  if(cat)loadCategoryNews(cat);
},NEWS_REFRESH_MS);

/* ---------- Radar: defense-industry mention trends and deal signals ---------- */
/* Informational aggregation only — factual counts and links to live quotes,
   never a "buy/finance this" recommendation. */
function gatherAllNewsItems(){
  const sources=["cat:generale","cat:militari","cat:armamenti","cat:tecnologia"];
  let all=curatedPool||[];
  sources.forEach(key=>{
    const cached=newsCache.get(key);
    if(cached)all=all.concat(cached.items);
  });
  return dedupeByUrl(all);
}
function renderTrending(container,items){
  const ranked=DEFENSE_COMPANIES.map(c=>{
    let count=0;
    items.forEach(it=>{if(tagCompanies(it.title).some(m=>m.name===c.name))count++});
    return{company:c,count};
  }).filter(r=>r.count>0).sort((a,b)=>b.count-a.count).slice(0,12);
  if(!ranked.length){
    container.innerHTML='<li class="news-item empty">Nessuna menzione rilevata nelle notizie attualmente in cache.</li>';
    return;
  }
  const max=ranked[0].count;
  container.innerHTML=ranked.map(r=>`
    <li class="trend-row">
      <a href="https://www.tradingview.com/symbols/${encodeURIComponent(r.company.symbol.replace(":","-").replace(".",""))}/" target="_blank" rel="noopener noreferrer">
        <span class="trend-name">${r.company.name}</span>
        <span class="trend-bar-wrap"><span class="trend-bar" style="width:${(r.count/max*100).toFixed(0)}%"></span></span>
        <span class="trend-count">${r.count}</span>
      </a>
    </li>
  `).join("");
}
function renderDeals(listEl,items){
  const deals=items.filter(it=>isDealNews(it.title)).sort((a,b)=>new Date(b.date)-new Date(a.date));
  if(!deals.length){
    renderEmptyState(listEl,"Nessuna notizia di contratti/deal rilevata al momento.");
    return;
  }
  renderNewsList(listEl,deals);
}
const trendList=document.querySelector("#trendList");
const dealsList=document.querySelector("#dealsList");
const radarUpdated=document.querySelector("#radarUpdated");
async function loadRadar(){
  await Promise.all(["generale","militari","armamenti","tecnologia"].map(loadCategoryNews));
  const items=gatherAllNewsItems();
  renderTrending(trendList,items);
  renderDeals(dealsList,items);
  radarUpdated.textContent="aggiornato "+new Date().toLocaleTimeString("it-IT");
}
setInterval(()=>{if(currentTab==="radar")loadRadar()},NEWS_REFRESH_MS);

/* ---------- Interactive map ---------- */
const REGION_NAMES={it:"Italia",eu:"Europa",na:"Nord America",sa:"Sud America",me:"Medio Oriente",as:"Asia",af:"Africa",oc:"Oceania"};
const REGION_QUERIES={
  it:[["Italia difesa esercito forze armate","it"],["Italy defense military armed forces","en"]],
  eu:[["Europa difesa sicurezza militare NATO","it"],["Europe defense security military NATO","en"]],
  na:[["Stati Uniti Canada difesa militare","it"],["United States Canada defense military","en"]],
  sa:[["America Latina difesa militare sicurezza","it"],["Latin America defense military security","en"]],
  me:[["Medio Oriente conflitto militare difesa","it"],["Middle East military conflict defense","en"]],
  as:[["Asia difesa militare sicurezza","it"],["Asia defense military security","en"]],
  af:[["Africa difesa militare sicurezza","it"],["Africa defense military security","en"]],
  oc:[["Oceania Australia difesa militare","it"],["Oceania Australia defense military","en"]]
};

const mapWrap=document.querySelector("#mapWrap");
const mapNewsList=document.querySelector("#mapNewsList");
const mapNewsTitle=document.querySelector("#mapNewsTitle");
const mapNewsUpdated=document.querySelector("#mapNewsUpdated");
let currentRegion=store.get("pulse-region","it");

function setActiveRegion(region){
  currentRegion=region;
  store.set("pulse-region",region);
  document.querySelectorAll("#regionPills .pill").forEach(p=>p.classList.toggle("active",p.dataset.region===region));
  mapWrap.querySelectorAll(".country").forEach(c=>{
    c.classList.toggle("region-active",c.classList.contains("region-"+region));
  });
  mapNewsTitle.textContent="Difesa & sicurezza — "+REGION_NAMES[region];
  loadRegionNews();
}

const REGION_CACHE_TTL=5*60*1000;
async function loadRegionNews(){
  const region=currentRegion;
  if(!newsCache.has("region:"+region))renderNewsSkeleton(mapNewsList,4);
  const{items,ts}=await cachedNews("region:"+region,REGION_CACHE_TTL,async()=>{
    const queries=REGION_QUERIES[region].map(([q,lang])=>googleNewsUrl(q,lang));
    return dedupeByUrl(await fetchFeeds(queries));
  });
  if(region!==currentRegion)return;
  if(items.length){
    renderNewsList(mapNewsList,items);
    mapNewsUpdated.textContent="aggiornato "+new Date(ts).toLocaleTimeString("it-IT");
  }else{
    renderEmptyState(mapNewsList,"Nessuna notizia disponibile per questa area al momento, riprovo tra poco…");
    mapNewsUpdated.textContent="feed non disponibile, riprovo…";
  }
}

document.querySelectorAll("#regionPills .pill").forEach(btn=>{
  btn.classList.toggle("active",btn.dataset.region===currentRegion);
  btn.addEventListener("click",()=>setActiveRegion(btn.dataset.region));
});

fetch("world-map.svg").then(r=>r.text()).then(svg=>{
  mapWrap.innerHTML=svg;
  mapWrap.querySelectorAll(".country").forEach(c=>{
    c.addEventListener("click",()=>{
      const regionClass=[...c.classList].find(cl=>cl.startsWith("region-"));
      if(regionClass)setActiveRegion(regionClass.replace("region-",""));
    });
  });
  setActiveRegion(currentRegion);
}).catch(()=>{
  mapWrap.innerHTML='<p class="muted">Mappa non disponibile al momento.</p>';
  loadRegionNews();
});

/* ---------- Initial tab activation (deferred so all sections above are ready) ---------- */
{
  const stored=store.get("pulse-tab",TABS[0]);
  activateTab(TABS.includes(stored)?stored:TABS[0],false);
}
