/* ---------- Tabs ---------- */
document.querySelectorAll("#tabs .tab").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll("#tabs .tab").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".tabpanel").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active");
    document.querySelector("#tab-"+btn.dataset.tab).classList.add("active");
  });
});

/* ---------- Clock ---------- */
const clock=document.querySelector("#clock");
function tickClock(){clock.textContent=new Date().toLocaleTimeString("it-IT")}
setInterval(tickClock,1000);
tickClock();

/* ---------- Crypto prices (Coinbase WebSocket, CoinGecko fallback) ---------- */
const PRODUCTS=["BTC-USD","ETH-USD","SOL-USD","XRP-USD","ADA-USD","DOGE-USD","LTC-USD"];
const COINGECKO_MAP={"BTC-USD":"bitcoin","ETH-USD":"ethereum","SOL-USD":"solana","XRP-USD":"ripple","ADA-USD":"cardano","DOGE-USD":"dogecoin","LTC-USD":"litecoin"};

const priceGrid=document.querySelector("#priceGrid");
const statusDot=document.querySelector("#statusDot");
const marketStatus=document.querySelector("#marketStatus");

const cards={};
PRODUCTS.forEach(sym=>{
  const el=document.createElement("div");
  el.className="price-card skeleton";
  el.innerHTML=`<div class="sym">${sym.replace("-","/")}</div><div class="val">—</div><div class="chg">—</div>`;
  priceGrid.appendChild(el);
  cards[sym]={el,val:el.querySelector(".val"),chg:el.querySelector(".chg"),last:null};
});

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
  c.val.textContent="$"+price.toLocaleString("en-US",{minimumFractionDigits:price<10?4:2,maximumFractionDigits:price<10?4:2});
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

pollPricesOnce();
startWebSocket();

/* ---------- News (rss2json bridge, feeds per category) ---------- */
const RSS2JSON="https://api.rss2json.com/v1/api.json?rss_url=";
const NEWS_REFRESH_MS=3*60*1000;

const CATEGORY_FEEDS={
  crypto:[
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://cointelegraph.com/rss"
  ],
  politica:[
    "https://www.ansa.it/sito/notizie/politica/politica_rss.xml",
    "https://news.google.com/rss/search?q=politica&hl=it&gl=IT&ceid=IT:it"
  ],
  mercati:[
    "https://www.ilsole24ore.com/rss/finanza.xml",
    "https://news.google.com/rss/search?q=mercati%20finanziari%20borsa&hl=it&gl=IT&ceid=IT:it"
  ]
};

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
function renderNewsList(listEl,items){
  listEl.innerHTML=items.slice(0,24).map(item=>`
    <li class="news-item">
      <a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.title}</a>
      <div class="meta"><span class="src">${item.source}</span><span>${timeAgo(item.date)}</span></div>
    </li>
  `).join("");
}
async function fetchFeeds(feeds){
  const results=await Promise.allSettled(
    feeds.map(feed=>fetch(RSS2JSON+encodeURIComponent(feed)).then(r=>r.json()))
  );
  let items=[];
  results.forEach(r=>{
    if(r.status==="fulfilled"&&r.value.status==="ok"){
      items=items.concat(r.value.items.map(it=>({
        title:it.title,url:it.link,date:it.pubDate,source:hostFromUrl(it.link)
      })));
    }
  });
  items.sort((a,b)=>new Date(b.date)-new Date(a.date));
  return items;
}

const newsList=document.querySelector("#newsList");
const newsUpdated=document.querySelector("#newsUpdated");
let currentCategory="crypto";

async function loadCategoryNews(){
  try{
    const items=await fetchFeeds(CATEGORY_FEEDS[currentCategory]);
    if(!items.length)throw new Error("empty");
    renderNewsList(newsList,items);
    newsUpdated.textContent="aggiornato "+new Date().toLocaleTimeString("it-IT");
  }catch(e){
    newsUpdated.textContent="feed non disponibile, riprovo…";
  }
}
document.querySelectorAll("#newsCategoryTabs .seg").forEach(btn=>{
  btn.addEventListener("click",()=>{
    if(btn.dataset.cat===currentCategory)return;
    document.querySelectorAll("#newsCategoryTabs .seg").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    currentCategory=btn.dataset.cat;
    newsUpdated.textContent="in aggiornamento…";
    loadCategoryNews();
  });
});
loadCategoryNews();
setInterval(loadCategoryNews,NEWS_REFRESH_MS);

/* ---------- Interactive map ---------- */
const REGION_NAMES={it:"Italia",eu:"Europa",na:"Nord America",sa:"Sud America",me:"Medio Oriente",as:"Asia",af:"Africa",oc:"Oceania"};
const REGION_QUERIES={
  it:"Italia",eu:"Europa",na:"Stati Uniti OR Canada",sa:"America Latina",
  me:"Medio Oriente",as:"Asia",af:"Africa",oc:"Oceania OR Australia"
};

const mapWrap=document.querySelector("#mapWrap");
const mapNewsList=document.querySelector("#mapNewsList");
const mapNewsTitle=document.querySelector("#mapNewsTitle");
const mapNewsUpdated=document.querySelector("#mapNewsUpdated");
let currentRegion="it";

function setActiveRegion(region){
  currentRegion=region;
  document.querySelectorAll("#regionPills .pill").forEach(p=>p.classList.toggle("active",p.dataset.region===region));
  mapWrap.querySelectorAll(".country").forEach(c=>{
    c.classList.toggle("region-active",c.classList.contains("region-"+region));
  });
  mapNewsTitle.textContent="Notizie — "+REGION_NAMES[region];
  loadRegionNews();
}

async function loadRegionNews(){
  mapNewsUpdated.textContent="in aggiornamento…";
  try{
    const feed=`https://news.google.com/rss/search?q=${encodeURIComponent(REGION_QUERIES[currentRegion])}&hl=it&gl=IT&ceid=IT:it`;
    const items=await fetchFeeds([feed]);
    if(!items.length)throw new Error("empty");
    renderNewsList(mapNewsList,items);
    mapNewsUpdated.textContent="aggiornato "+new Date().toLocaleTimeString("it-IT");
  }catch(e){
    mapNewsUpdated.textContent="feed non disponibile, riprovo…";
  }
}

document.querySelectorAll("#regionPills .pill").forEach(btn=>{
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
