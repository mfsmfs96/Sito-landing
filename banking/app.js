/* ---------- Persisted preferences ---------- */
const store={
  get(k,d){try{return localStorage.getItem(k)??d}catch(e){return d}},
  set(k,v){try{localStorage.setItem(k,v)}catch(e){}},
  remove(k){try{localStorage.removeItem(k)}catch(e){}}
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
let savedTheme=store.get("ledger-theme","dark");
applyTheme(savedTheme);
themeToggle.addEventListener("click",()=>{
  const current=effectiveTheme();
  savedTheme=current==="dark"?"light":"dark";
  store.set("ledger-theme",savedTheme);
  applyTheme(savedTheme);
  buildTradingViewWidgets();
});

/* ---------- Tabs ---------- */
const TABS=["mercati","spreading","memo"];
let currentTab=TABS[0];
function activateTab(tab){
  if(!TABS.includes(tab))return;
  currentTab=tab;
  document.querySelectorAll("#tabs .tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
  document.querySelectorAll(".tabpanel").forEach(p=>p.classList.toggle("active",p.id==="tab-"+tab));
  store.set("ledger-tab",tab);
}
document.querySelectorAll("#tabs .tab").forEach(btn=>{
  btn.addEventListener("click",()=>activateTab(btn.dataset.tab));
});
activateTab(store.get("ledger-tab","mercati"));

/* ---------- Clock ---------- */
const clock=document.querySelector("#clock");
function tickClock(){clock.textContent=new Date().toLocaleTimeString("it-IT")}
setInterval(tickClock,1000);
tickClock();

/* ---------- TradingView widgets (rates, credit spreads, banking sector) ---------- */
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
    document.querySelector("#tvRatesCredit"),
    "https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js",
    {
      colorTheme:theme,
      dateRange:"12M",
      showChart:true,
      locale:"it",
      isTransparent:true,
      showSymbolLogo:true,
      showFloatingTooltip:true,
      width:"100%",
      height:"100%",
      tabs:[
        {title:"Tassi sovrani",symbols:[
          {s:"TVC:US10Y",d:"USA 10Y"},
          {s:"TVC:DE10Y",d:"Germania 10Y (Bund)"},
          {s:"TVC:IT10Y",d:"Italia 10Y (BTP)"},
          {s:"TVC:GB10Y",d:"UK 10Y (Gilt)"},
          {s:"TVC:US03MY",d:"USA 3M"}
        ]},
        {title:"Credito & spread",symbols:[
          {s:"FRED:BAMLH0A0HYM2",d:"US High Yield OAS"},
          {s:"FRED:BAMLC0A0CM",d:"US Investment Grade OAS"},
          {s:"AMEX:HYG",d:"ETF High Yield Corp (HYG)"},
          {s:"AMEX:LQD",d:"ETF Investment Grade Corp (LQD)"}
        ]},
        {title:"Settore bancario",symbols:[
          {s:"INDEX:SX7E",d:"Euro Stoxx Banks"},
          {s:"MIL:FTSEIT.BANKS",d:"FTSE Italia Banche"},
          {s:"NYSE:JPM",d:"JPMorgan Chase"},
          {s:"NYSE:BAC",d:"Bank of America"}
        ]}
      ]
    }
  );
}
buildTradingViewWidgets();

/* ---------- Corporate finance / M&A news (rss2json bridge, same pattern as the market desk) ---------- */
const RSS2JSON="https://api.rss2json.com/v1/api.json?rss_url=";
const NEWS_REFRESH_MS=3*60*1000;

function googleNewsUrl(query,lang){
  const q=encodeURIComponent(query);
  return lang==="en"
    ?`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`
    :`https://news.google.com/rss/search?q=${q}&hl=it&gl=IT&ceid=IT:it`;
}
const CURATED_FINANCE_FEEDS=[
  "https://www.ilsole24ore.com/rss/finanza.xml"
];
const CORP_FINANCE_QUERIES=[
  ["fusione acquisizione M&A azienda italiana","it"],
  ["prestito sindacato finanziamento bancario impresa","it"],
  ["emissione obbligazionaria bond corporate","it"],
  ["IPO quotazione borsa italiana","it"],
  ["merger acquisition deal corporate finance","en"],
  ["syndicated loan corporate bond issuance","en"]
];
const DEAL_KEYWORDS=["contract","deal","award","order","procurement","tender","agreement","acquisition","acquire","stake","invest","funding","billion","million","$","€","accordo","contratto","commessa","appalto","acquisizione","investimento","miliardi","milioni","obbligazion","prestito","finanziamento","fusione","quotazione","ipo","bond"];
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

/* Heuristic mapping from a deal headline to a plausible financing product — a starting
   hypothesis for the analyst to validate, never a proposal. */
const FINANCING_RULES=[
  {test:t=>/bond|obbligazion|notes payable/.test(t),label:"Obbligazionario / Debt Capital Markets",note:"possibile emissione o rifinanziamento obbligazionario"},
  {test:t=>/prestito sindacato|syndicated loan/.test(t),label:"Prestito sindacato",note:"club deal o syndication tra più banche"},
  {test:t=>/acquisition|acquire|acquisizione|merger|fusione|stake in/.test(t),label:"Acquisition Finance",note:"leva per M&A o acquisizione di quota"},
  {test:t=>/ipo|quotazione|listing/.test(t),label:"Equity Capital Markets",note:"quotazione o aumento di capitale"},
  {test:t=>/invest|funding|expansion|capacity|new plant|new factory|espansione|nuovo impianto|capex/.test(t),label:"Capex / Project Finance",note:"espansione della capacità produttiva"},
  {test:t=>/export|international sale|foreign/.test(t),label:"Export Finance",note:"vendita estera, possibile garanzia export credit agency"}
];
function suggestFinancingConcept(title){
  const t=title.toLowerCase();
  const rule=FINANCING_RULES.find(r=>r.test(t));
  return rule||{label:"Working Capital / Trade Finance",note:"ipotesi generica per notizia di deal o commessa"};
}
function conceptTagHTML(item){
  if(!isDealNews(item.title))return"";
  const c=suggestFinancingConcept(item.title);
  return `<div class="concept-tag"><span class="concept-label">${c.label}</span><span class="concept-note">${c.note}</span></div>`;
}
function renderNewsList(listEl,items){
  listEl.innerHTML=items.slice(0,30).map(item=>`
    <li class="news-item">
      <a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.title}</a>
      <div class="meta">
        <span class="src">${item.source}</span><span>${timeAgo(item.date)}</span>
        ${isDealNews(item.title)?'<span class="deal-badge">DEAL</span>':""}
      </div>
      ${conceptTagHTML(item)}
    </li>`).join("");
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
function renderEmptyState(listEl,text){
  listEl.innerHTML=`<li class="news-item empty">${text}</li>`;
}
let corpNewsCache=null;
async function loadCorpNews(){
  const list=document.querySelector("#newsList-corp"),updated=document.querySelector("#newsUpdated-corp");
  if(!corpNewsCache)renderNewsSkeleton(list);
  try{
    const curated=await fetchFeeds(CURATED_FINANCE_FEEDS);
    const queried=await fetchFeeds(CORP_FINANCE_QUERIES.map(([q,lang])=>googleNewsUrl(q,lang)));
    const items=dedupeByUrl([...curated,...queried]).sort((a,b)=>new Date(b.date)-new Date(a.date));
    if(items.length){
      corpNewsCache=items;
      renderNewsList(list,items);
      updated.textContent="aggiornato "+new Date().toLocaleTimeString("it-IT");
    }else if(!corpNewsCache){
      renderEmptyState(list,"Nessuna notizia disponibile al momento, riprovo tra poco…");
      updated.textContent="feed non disponibile, riprovo…";
    }
  }catch(e){
    if(!corpNewsCache){
      renderEmptyState(list,"Nessuna notizia disponibile al momento, riprovo tra poco…");
      updated.textContent="feed non disponibile, riprovo…";
    }
  }
}
loadCorpNews();
setInterval(loadCorpNews,NEWS_REFRESH_MS);

/* ==================================================================
   SPREADING & COVENANT TRACKER
   ================================================================== */
const DEALS_KEY="ledger-deals";
const FIELDS=[
  {key:"ricavi",label:"Ricavi"},
  {key:"ebitda",label:"EBITDA"},
  {key:"debitoTotale",label:"Debito finanziario totale"},
  {key:"cassa",label:"Cassa e equivalenti"},
  {key:"oneriFinanziari",label:"Oneri finanziari netti"},
  {key:"attivoCorrente",label:"Attivo corrente"},
  {key:"passivoCorrente",label:"Passivo corrente"},
  {key:"patrimonioNetto",label:"Patrimonio netto"}
];
function emptyYear(label){
  const y={label};
  FIELDS.forEach(f=>y[f.key]=0);
  return y;
}
function newDeal(){
  return{
    id:"d"+Date.now().toString(36)+Math.random().toString(36).slice(2,7),
    name:"Nuova pratica",
    sector:"",
    years:[emptyYear("FY-1"),emptyYear("FY0")],
    covenants:{maxLeva:3.5,minCoverage:2.0,minCurrent:1.0}
  };
}
function loadDeals(){
  try{return JSON.parse(localStorage.getItem(DEALS_KEY)||"[]")}catch(e){return[]}
}
function saveDeals(deals){
  try{localStorage.setItem(DEALS_KEY,JSON.stringify(deals))}catch(e){}
}
let deals=loadDeals();
let currentDealId=deals[0]?deals[0].id:null;

function currentDeal(){return deals.find(d=>d.id===currentDealId)}

function renderDealDirectory(){
  const dir=document.querySelector("#dealDirectory");
  if(!deals.length){
    dir.innerHTML=`<span class="muted">Nessuna pratica salvata.</span>`;
  }else{
    dir.innerHTML=deals.map(d=>{
      const flagged=dealHasCovenantBreach(d);
      return `<button class="deal-dir-item ${d.id===currentDealId?"active":""}" data-id="${d.id}">${d.name||"(senza nome)"}${flagged?'<span class="flag">⚠</span>':""}</button>`;
    }).join("");
  }
  document.querySelector("#dealEditor").style.display=currentDeal()?"block":"none";
  document.querySelector("#noDealNote").style.display=currentDeal()?"none":"block";
  renderMemoDealSelect();
}
document.querySelector("#dealDirectory").addEventListener("click",e=>{
  const btn=e.target.closest(".deal-dir-item");
  if(!btn)return;
  currentDealId=btn.dataset.id;
  renderDealEditor();
  renderDealDirectory();
});
document.querySelector("#newDealBtn").addEventListener("click",()=>{
  const d=newDeal();
  deals.unshift(d);
  currentDealId=d.id;
  saveDeals(deals);
  renderDealEditor();
  renderDealDirectory();
});
document.querySelector("#deleteDealBtn").addEventListener("click",()=>{
  const d=currentDeal();
  if(!d)return;
  if(!confirm(`Eliminare definitivamente la pratica "${d.name}"?`))return;
  deals=deals.filter(x=>x.id!==d.id);
  currentDealId=deals[0]?deals[0].id:null;
  saveDeals(deals);
  renderDealEditor();
  renderDealDirectory();
});

function calcRatios(year){
  return{
    levaLorda:year.ebitda?year.debitoTotale/year.ebitda:NaN,
    levaNetta:year.ebitda?(year.debitoTotale-year.cassa)/year.ebitda:NaN,
    interestCoverage:year.oneriFinanziari?year.ebitda/year.oneriFinanziari:NaN,
    currentRatio:year.passivoCorrente?year.attivoCorrente/year.passivoCorrente:NaN,
    debtToEquity:year.patrimonioNetto?year.debitoTotale/year.patrimonioNetto:NaN
  };
}
function dealHasCovenantBreach(deal){
  if(!deal.years.length)return false;
  const r=calcRatios(deal.years[deal.years.length-1]);
  const c=deal.covenants;
  return(isFinite(r.levaNetta)&&r.levaNetta>c.maxLeva)||
         (isFinite(r.interestCoverage)&&r.interestCoverage<c.minCoverage)||
         (isFinite(r.currentRatio)&&r.currentRatio<c.minCurrent);
}
function fmtNum(n,decimals=1){
  return isFinite(n)?n.toLocaleString("it-IT",{minimumFractionDigits:decimals,maximumFractionDigits:decimals}):"n/d";
}
function debounce(fn,ms){
  let t;
  return(...args)=>{clearTimeout(t);t=setTimeout(()=>fn(...args),ms)};
}
const persistDeals=debounce(()=>saveDeals(deals),500);

function renderSpreadTable(){
  const deal=currentDeal();
  if(!deal)return;
  const table=document.querySelector("#spreadTable");
  const yearHeaders=deal.years.map((y,i)=>`<th><input class="year-label" data-yidx="${i}" data-field="label" value="${y.label}"></th>`).join("");
  const rows=FIELDS.map(f=>{
    const cells=deal.years.map((y,i)=>`<td><input type="number" step="any" data-yidx="${i}" data-field="${f.key}" value="${y[f.key]}"></td>`).join("");
    return `<tr><td>${f.label}</td>${cells}</tr>`;
  }).join("");
  table.innerHTML=`<thead><tr><th>Voce (k€)</th>${yearHeaders}</tr></thead><tbody>${rows}</tbody>`;
}
document.querySelector("#spreadTable").addEventListener("input",e=>{
  const input=e.target.closest("input[data-field]");
  if(!input)return;
  const deal=currentDeal();
  if(!deal)return;
  const idx=parseInt(input.dataset.yidx,10);
  const field=input.dataset.field;
  const year=deal.years[idx];
  if(!year)return;
  if(field==="label")year.label=input.value;
  else year[field]=parseFloat(input.value)||0;
  persistDeals();
  renderRatioGrid();
  renderDealDirectory();
});
document.querySelector("#addYearBtn").addEventListener("click",()=>{
  const deal=currentDeal();
  if(!deal)return;
  deal.years.push(emptyYear("FY+"+(deal.years.length-1)));
  saveDeals(deals);
  renderSpreadTable();
  renderRatioGrid();
});
document.querySelector("#removeYearBtn").addEventListener("click",()=>{
  const deal=currentDeal();
  if(!deal||deal.years.length<=1)return;
  deal.years.pop();
  saveDeals(deals);
  renderSpreadTable();
  renderRatioGrid();
});

const RATIO_DEFS=[
  {key:"levaLorda",label:"Leva lorda (Debito/EBITDA)",covenant:null},
  {key:"levaNetta",label:"Leva netta ((Debito-Cassa)/EBITDA)",covenant:{key:"maxLeva",dir:"max",unit:"x"}},
  {key:"interestCoverage",label:"Interest coverage (EBITDA/Oneri fin.)",covenant:{key:"minCoverage",dir:"min",unit:"x"}},
  {key:"currentRatio",label:"Current ratio",covenant:{key:"minCurrent",dir:"min",unit:"x"}},
  {key:"debtToEquity",label:"Debt / Equity",covenant:null}
];
function sparkPath(values){
  const finite=values.filter(isFinite);
  if(finite.length<2)return"";
  const min=Math.min(...finite),max=Math.max(...finite);
  const range=(max-min)||1;
  const stepX=100/(values.length-1);
  return values.map((v,i)=>{
    const x=(i*stepX).toFixed(2);
    const y=isFinite(v)?(28-((v-min)/range)*26).toFixed(2):"28";
    return(i===0?"M":"L")+x+","+y;
  }).join(" ");
}
function renderRatioGrid(){
  const deal=currentDeal();
  const grid=document.querySelector("#ratioGrid");
  if(!deal||!deal.years.length){grid.innerHTML="";return}
  const c=deal.covenants;
  const allRatios=deal.years.map(calcRatios);
  const last=allRatios[allRatios.length-1];
  grid.innerHTML=RATIO_DEFS.map(rd=>{
    const val=last[rd.key];
    const series=allRatios.map(r=>r[rd.key]);
    let pillHTML="",cardClass="";
    if(rd.covenant){
      const threshold=c[rd.covenant.key];
      const pass=rd.covenant.dir==="max"?val<=threshold:val>=threshold;
      const passOk=isFinite(val)?pass:true;
      pillHTML=`<span class="covenant-pill ${passOk?"pass":"fail"}">${passOk?"PASS":"FAIL"} · soglia ${rd.covenant.dir==="max"?"≤":"≥"}${fmtNum(threshold,1)}${rd.covenant.unit}</span>`;
      cardClass=isFinite(val)?(passOk?"pass":"fail"):"";
    }
    return `<div class="ratio-card ${cardClass}">
      <div class="ratio-name">${rd.label}</div>
      <div class="ratio-value">${fmtNum(val,2)}${isFinite(val)?"x":""}</div>
      <div class="ratio-covenant">${pillHTML}</div>
      <svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"><path d="${sparkPath(series)}"/></svg>
    </div>`;
  }).join("");
}
function renderDealEditor(){
  const deal=currentDeal();
  document.querySelector("#dealEditor").style.display=deal?"block":"none";
  document.querySelector("#noDealNote").style.display=deal?"none":"block";
  if(!deal)return;
  document.querySelector("#dealName").value=deal.name;
  document.querySelector("#dealSector").value=deal.sector;
  document.querySelector("#covMaxLeva").value=deal.covenants.maxLeva;
  document.querySelector("#covMinCoverage").value=deal.covenants.minCoverage;
  document.querySelector("#covMinCurrent").value=deal.covenants.minCurrent;
  renderSpreadTable();
  renderRatioGrid();
}
["dealName","dealSector"].forEach(id=>{
  document.querySelector("#"+id).addEventListener("input",e=>{
    const deal=currentDeal();
    if(!deal)return;
    if(id==="dealName")deal.name=e.target.value;
    else deal.sector=e.target.value;
    persistDeals();
    renderDealDirectory();
  });
});
[["covMaxLeva","maxLeva"],["covMinCoverage","minCoverage"],["covMinCurrent","minCurrent"]].forEach(([id,key])=>{
  document.querySelector("#"+id).addEventListener("input",e=>{
    const deal=currentDeal();
    if(!deal)return;
    deal.covenants[key]=parseFloat(e.target.value)||0;
    persistDeals();
    renderRatioGrid();
    renderDealDirectory();
  });
});
document.querySelector("#exportCsvBtn").addEventListener("click",()=>{
  const deal=currentDeal();
  if(!deal){alert("Seleziona prima una pratica.");return}
  const ratios=deal.years.map(calcRatios);
  const header=["Voce",...deal.years.map(y=>y.label)];
  const rows=[header];
  FIELDS.forEach(f=>rows.push([f.label,...deal.years.map(y=>y[f.key])]));
  RATIO_DEFS.forEach(rd=>rows.push([rd.label,...ratios.map(r=>isFinite(r[rd.key])?r[rd.key].toFixed(2):"")]));
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=(deal.name||"pratica").replace(/[^a-z0-9]+/gi,"_")+"_spreading.csv";
  a.click();
  URL.revokeObjectURL(a.href);
});
renderDealEditor();
renderDealDirectory();

/* ==================================================================
   CREDIT MEMO AI ASSISTANT
   ================================================================== */
const API_KEY_STORE="ledger-api-key";
const API_MODEL_STORE="ledger-api-model";
const DEFAULT_MODEL="claude-sonnet-4-5-20250929";
const apiKeyInput=document.querySelector("#apiKey");
const apiModelInput=document.querySelector("#apiModel");
const apiKeySaveCheckbox=document.querySelector("#apiKeySave");
apiModelInput.value=store.get(API_MODEL_STORE,DEFAULT_MODEL);
const storedKey=store.get(API_KEY_STORE,"");
if(storedKey)apiKeyInput.value=storedKey;
apiKeyInput.addEventListener("input",()=>{
  if(apiKeySaveCheckbox.checked)store.set(API_KEY_STORE,apiKeyInput.value);
});
apiModelInput.addEventListener("input",()=>store.set(API_MODEL_STORE,apiModelInput.value||DEFAULT_MODEL));
apiKeySaveCheckbox.addEventListener("change",()=>{
  if(apiKeySaveCheckbox.checked)store.set(API_KEY_STORE,apiKeyInput.value);
  else store.remove(API_KEY_STORE);
});

function renderMemoDealSelect(){
  const sel=document.querySelector("#memoDealSelect");
  const prev=sel.value;
  sel.innerHTML=`<option value="">— nessuna —</option>`+deals.map(d=>`<option value="${d.id}">${d.name||"(senza nome)"}</option>`).join("");
  if(deals.some(d=>d.id===prev))sel.value=prev;
}

function financialHighlightsText(deal){
  if(!deal||!deal.years.length)return"";
  const last=deal.years[deal.years.length-1];
  const r=calcRatios(last);
  const c=deal.covenants;
  const breach=[];
  if(isFinite(r.levaNetta)&&r.levaNetta>c.maxLeva)breach.push(`leva netta ${fmtNum(r.levaNetta,2)}x > soglia ${c.maxLeva}x`);
  if(isFinite(r.interestCoverage)&&r.interestCoverage<c.minCoverage)breach.push(`interest coverage ${fmtNum(r.interestCoverage,2)}x < soglia ${c.minCoverage}x`);
  if(isFinite(r.currentRatio)&&r.currentRatio<c.minCurrent)breach.push(`current ratio ${fmtNum(r.currentRatio,2)}x < soglia ${c.minCurrent}x`);
  return[
    `Azienda: ${deal.name} — Settore: ${deal.sector||"n/d"}`,
    `Ultimo esercizio disponibile: ${last.label}`,
    `Ricavi: ${last.ricavi} k€ · EBITDA: ${last.ebitda} k€ · Debito totale: ${last.debitoTotale} k€ · Cassa: ${last.cassa} k€`,
    `Leva lorda: ${fmtNum(r.levaLorda,2)}x · Leva netta: ${fmtNum(r.levaNetta,2)}x · Interest coverage: ${fmtNum(r.interestCoverage,2)}x · Current ratio: ${fmtNum(r.currentRatio,2)}x · D/E: ${fmtNum(r.debtToEquity,2)}x`,
    breach.length?`Covenant NON rispettati sull'ultimo esercizio: ${breach.join("; ")}.`:"Tutti i covenant monitorati risultano rispettati sull'ultimo esercizio."
  ].join("\n");
}

function setMemoStatus(kind,text){
  document.querySelector("#memoStatus").innerHTML=text?`<div class="memo-status ${kind}">${text}</div>`:"";
}
function setMemoOutput(text,empty=false){
  const out=document.querySelector("#memoOutput");
  out.textContent=text;
  out.classList.toggle("empty",empty);
}

function buildTemplateMemo(ctx){
  return`CREDIT MEMO — BOZZA STRUTTURATA (senza AI, da completare)
================================================================

1. SINTESI OPERAZIONE
Azienda: ${ctx.company||"[nome azienda]"}
Settore: ${ctx.sector||"[settore]"}
Tipo operazione: ${ctx.tipoOp}
Importo richiesto: ${ctx.importo?ctx.importo+" k€":"[importo]"}

2. DATI FINANZIARI CHIAVE
${ctx.financials||"[Nessuna pratica di spreading collegata — inserisci qui i dati di bilancio principali]"}

3. NOTE QUALITATIVE DELL'ANALISTA
${ctx.notes||"[nessuna nota inserita]"}

4. RISCHI DA VALUTARE
- [ ] Rischio settoriale / ciclicità del mercato di riferimento
- [ ] Concentrazione clienti/fornitori
- [ ] Adeguatezza delle garanzie rispetto all'importo richiesto
- [ ] Sostenibilità del servizio del debito nello scenario stressato
- [ ] Continuità aziendale / passaggio generazionale, se rilevante

5. COVENANT DA MONITORARE
${ctx.hasBreach?"ATTENZIONE: uno o più covenant risultano non rispettati sull'ultimo esercizio — vedi sezione 2.":"Nessun breach rilevato sui covenant monitorati nella pratica di spreading collegata (se presente)."}

6. DOMANDE APERTE PER IL CLIENTE
- [ ] Motivazione specifica della richiesta e utilizzo dei fondi
- [ ] Piano di rimborso proposto e fonti di rimborso primarie/secondarie
- [ ] Eventuali garanzie reali o personali disponibili

7. RACCOMANDAZIONE PRELIMINARE
[Da completare dall'analista dopo verifica e validazione dei dati sopra riportati]

--------------------------------------------------------------
Bozza puramente strutturale, generata senza intelligenza artificiale a partire dai
dati inseriti. Non sostituisce l'analisi e il giudizio dell'analista.`;
}

function buildAiPrompt(ctx){
  return`Sei un assistente per un corporate banking analyst italiano. Scrivi la bozza di un credit memo interno in italiano, in linguaggio professionale bancario, a partire dai seguenti dati. Struttura la bozza con queste sezioni: 1) Sintesi operazione, 2) Analisi finanziaria (usa e commenta i ratio forniti), 3) Punti di forza, 4) Principali rischi, 5) Covenant da monitorare, 6) Domande aperte per il cliente, 7) Raccomandazione preliminare (motivata ma esplicitamente descritta come da validare da un analista senior). Non inventare dati numerici che non ti vengono forniti: se mancano, segnalali come da richiedere. Chiudi sempre ricordando che è una bozza da verificare.

Azienda: ${ctx.company||"non specificata"}
Settore: ${ctx.sector||"non specificato"}
Tipo operazione: ${ctx.tipoOp}
Importo richiesto: ${ctx.importo?ctx.importo+" k€":"non specificato"}

Dati finanziari e covenant:
${ctx.financials||"Nessun dato di bilancio collegato."}

Note qualitative dell'analista:
${ctx.notes||"Nessuna nota fornita."}`;
}

async function callClaude(prompt,apiKey,model){
  const res=await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",
    headers:{
      "content-type":"application/json",
      "x-api-key":apiKey,
      "anthropic-version":"2023-06-01",
      "anthropic-dangerous-direct-browser-access":"true"
    },
    body:JSON.stringify({
      model:model||DEFAULT_MODEL,
      max_tokens:2000,
      messages:[{role:"user",content:prompt}]
    })
  });
  const data=await res.json();
  if(!res.ok)throw new Error(data?.error?.message||`Errore API (${res.status})`);
  return(data.content||[]).map(b=>b.text||"").join("\n").trim();
}

document.querySelector("#generateMemoBtn").addEventListener("click",async()=>{
  const btn=document.querySelector("#generateMemoBtn");
  const dealId=document.querySelector("#memoDealSelect").value;
  const linkedDeal=deals.find(d=>d.id===dealId);
  const ctx={
    company:linkedDeal?linkedDeal.name:"",
    sector:linkedDeal?linkedDeal.sector:"",
    tipoOp:document.querySelector("#memoTipoOp").value,
    importo:document.querySelector("#memoImporto").value,
    notes:document.querySelector("#memoNotes").value.trim(),
    financials:linkedDeal?financialHighlightsText(linkedDeal):"",
    hasBreach:linkedDeal?dealHasCovenantBreach(linkedDeal):false
  };
  const apiKey=apiKeyInput.value.trim();
  const model=apiModelInput.value.trim()||DEFAULT_MODEL;

  btn.disabled=true;
  const prevLabel=btn.textContent;
  btn.textContent="Genero…";
  setMemoStatus("info","Generazione in corso…");
  try{
    if(apiKey){
      const text=await callClaude(buildAiPrompt(ctx),apiKey,model);
      setMemoOutput(text||"(risposta vuota)");
      setMemoStatus("ok",`Bozza generata con ${model}.`);
    }else{
      setMemoOutput(buildTemplateMemo(ctx));
      setMemoStatus("info","Bozza strutturata generata senza AI (nessuna chiave API inserita).");
    }
  }catch(e){
    setMemoStatus("err",`Errore nella chiamata API: ${e.message}. Uso il template senza AI come fallback.`);
    setMemoOutput(buildTemplateMemo(ctx));
  }finally{
    btn.disabled=false;
    btn.textContent=prevLabel;
  }
});
document.querySelector("#copyMemoBtn").addEventListener("click",async()=>{
  const text=document.querySelector("#memoOutput").textContent;
  try{
    await navigator.clipboard.writeText(text);
    setMemoStatus("ok","Copiato negli appunti.");
  }catch(e){
    setMemoStatus("err","Impossibile copiare automaticamente: seleziona e copia manualmente.");
  }
});
document.querySelector("#downloadMemoBtn").addEventListener("click",()=>{
  const text=document.querySelector("#memoOutput").textContent;
  const blob=new Blob([text],{type:"text/plain;charset=utf-8"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="credit_memo_bozza.txt";
  a.click();
  URL.revokeObjectURL(a.href);
});
