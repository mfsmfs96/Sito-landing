const scenes=[...document.querySelectorAll(".scene")];
const menu=document.querySelector("#menu");
const menuToggle=document.querySelector("#menuToggle");
const progress=document.querySelector("#progress");
const hint=document.querySelector("#hint");
const loader=document.querySelector("#loader");

menuToggle.addEventListener("click",()=>menu.classList.toggle("open"));

document.querySelectorAll("[data-target]").forEach(el=>{
  el.addEventListener("click",()=>{
    const target=document.getElementById(el.dataset.target);
    if(target){target.scrollIntoView({behavior:"smooth",block:"start"});menu.classList.remove("open")}
  });
});

const observer=new IntersectionObserver(entries=>{
  entries.forEach(entry=>{
    if(entry.isIntersecting){
      entry.target.classList.add("is-active");
      scenes.forEach(s=>{if(s!==entry.target)s.classList.remove("is-active")});
    }
  });
},{threshold:.35});
scenes.forEach(s=>observer.observe(s));

function parallax(){
  const vh=innerHeight;
  scenes.forEach(scene=>{
    const rect=scene.getBoundingClientRect();
    const center=rect.top+rect.height/2;
    const delta=(center-vh/2)/vh;
    const img=scene.querySelector(".art");
    const amount=Math.max(-1,Math.min(1,delta));
    img.style.transform=`translate3d(0,${amount*-10}px,0) scale(1.002)`;
  });
  const max=document.documentElement.scrollHeight-innerHeight;
  const pct=max>0?(scrollY/max)*100:0;
  progress.style.width=pct+"%";
  if(scrollY>100)hint.classList.add("hide");
}
addEventListener("scroll",parallax,{passive:true});
addEventListener("resize",parallax);
parallax();

setTimeout(()=>{
  loader.style.opacity="0";
  setTimeout(()=>loader.remove(),800);
},1500);

const modal=document.querySelector("#modal");
document.querySelector("#rsvp").addEventListener("click",()=>modal.classList.add("show"));
document.querySelector("#close").addEventListener("click",()=>modal.classList.remove("show"));
modal.addEventListener("click",e=>{if(e.target===modal)modal.classList.remove("show")});
document.querySelector("#form").addEventListener("submit",e=>{
  e.preventDefault();
  modal.querySelector("h2").textContent="Grazie.";
  modal.querySelector("p").textContent="La conferma è stata registrata nella demo.";
  e.target.style.display="none";
});
