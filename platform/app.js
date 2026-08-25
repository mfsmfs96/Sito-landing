const PRODUCTS=["BTC-USD","ETH-USD","SOL-USD","XRP-USD","ADA-USD","DOGE-USD","LTC-USD"];
const COINGECKO_MAP={"BTC-USD":"bitcoin","ETH-USD":"ethereum","SOL-USD":"solana","XRP-USD":"ripple","ADA-USD":"cardano","DOGE-USD":"dogecoin","LTC-USD":"litecoin"};

const NEWS_FEEDS=[
  "https://www.coindesk.com/arc/outboundfeeds/rss/",
  "https://cointelegraph.com/rss"
];
const NEWS_REFRESH_MS=3*60*1000;

const priceGrid=document.querySelector("#priceGrid");
const newsList=document.querySelector("#newsList");
const newsUpdated=document.querySelector("#newsUpdated");
const statusDot=document.querySelector("#statusDot");
const statusText=document.querySelector("#statusText");
const clock=document.querySelector("#clock");

const cards={};
PRODUCTS.forEach(sym=>{
  const el=document.createElement("div");
  el.className="price-card skeleton";
  el.innerHTML=`<div class="sym">${sym.replace("-","/")}</div><div class="val">—</div><div class="chg">—</div>`;
  priceGrid.appendChild(el);
  cards[sym]={el,val:el.querySelector(".val"),chg:el.querySelector(".chg"),last:null};
});

function setStatus(state,text){
  statusDot.className="dot "+state;
  statusText.textContent=text;
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

let ws=null;
let wsOpened=false;
let reconnectDelay=1000;
let pollTimer=null;

function startWebSocket(){
  ws=new WebSocket("wss://ws-feed.exchange.coinbase.com");

  const openTimeout=setTimeout(()=>{if(!wsOpened){ws.close();startPollingFallback()}},5000);

  ws.onopen=()=>{
    wsOpened=true;
    clearTimeout(openTimeout);
    ws.send(JSON.stringify({type:"subscribe",channels:[{name:"ticker",product_ids:PRODUCTS}]}));
    setStatus("live","Live");
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
    setStatus("error","Riconnessione…");
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

async function loadNews(){
  try{
    const results=await Promise.allSettled(
      NEWS_FEEDS.map(feed=>
        fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed)}`).then(r=>r.json())
      )
    );
    let items=[];
    results.forEach(r=>{
      if(r.status==="fulfilled"&&r.value.status==="ok"){
        items=items.concat(r.value.items.map(it=>({
          title:it.title,
          url:it.link,
          date:it.pubDate,
          source:hostFromUrl(it.link)
        })));
      }
    });
    if(!items.length)throw new Error("empty");
    items.sort((a,b)=>new Date(b.date)-new Date(a.date));
    newsList.innerHTML=items.slice(0,24).map(item=>`
      <li class="news-item">
        <a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.title}</a>
        <div class="meta"><span class="src">${item.source}</span><span>${timeAgo(item.date)}</span></div>
      </li>
    `).join("");
    newsUpdated.textContent="aggiornato "+new Date().toLocaleTimeString("it-IT");
  }catch(e){
    newsUpdated.textContent="feed non disponibile, riprovo…";
  }
}

function tickClock(){
  clock.textContent=new Date().toLocaleTimeString("it-IT");
}

pollPricesOnce();
startWebSocket();
loadNews();
setInterval(loadNews,NEWS_REFRESH_MS);
setInterval(tickClock,1000);
tickClock();
