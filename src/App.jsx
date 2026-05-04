import { useState, useEffect, useRef, useMemo } from "react";

const MODEL = "claude-haiku-4-5-20251001";
const NAV = "#0B1F3A", NAV3 = "#1A3060", NAVL = "#EEF2F8", NAVM = "#C8D5E8";
const WHT = "#FFFFFF", OFF = "#F7F9FC", BRD = "#D6DEE9";
const TXT = "#0B1F3A", TXTM = "#3D5270", TXTL = "#7A90AE";
const GRN = "#0E7C45", GRNB = "#E8F5EE", RED = "#B91C1C", REDB = "#FEF2F2";
const AMB = "#92530A", AMBB = "#FEF3C7", BLU = "#1D4ED8", BLUB = "#EFF6FF";
const DF = "'Playfair Display',Georgia,serif", BF = "'Lato',sans-serif";

const SYS = `CIO at 1949 Value Advisors LLC. Institutional equity research in flowing prose. No bullets, lists, emoji, or filler. **Bold Header** for sections.`;

const REQ_TIMEOUT_MS = 90000;
async function callAI(msgs, tokens, tools) {
  const body = { model: MODEL, max_tokens: tokens, system: SYS, messages: msgs };
  if (tools) body.tools = tools;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const res = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error.message);
    return (d.content || []).filter(b => b.type === "text").map(b => b.text).join("") || "No response.";
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Request timed out after " + (REQ_TIMEOUT_MS/1000) + "s");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const SEARCH_TOOL = [{ type: "web_search_20250305", name: "web_search" }];
async function callAISearch(msgs, tokens) {
  try {
    const text = await callAI(msgs, tokens, SEARCH_TOOL);
    if (text.trim()) return text;
  } catch {}
  return callAI(msgs, tokens);
}

const SCORE_REGEXES = [
  ["valuation",/^valuation\s*:\s*(\d+)/im],["fcf",/^free cash flow\s*:\s*(\d+)/im],
  ["returns",/^returns on capital\s*:\s*(\d+)/im],["balance",/^capital structure\s*:\s*(\d+)/im],
  ["management",/^management\s*:\s*(\d+)/im],["moat",/^moat\s*:\s*(\d+)/im],
  ["catalysts",/^catalysts\s*:\s*(\d+)/im],["overall",/^overall\s*:\s*(\d+)/im]
];
function parseScores(t) {
  const s = {};
  if(!t)return s;
  SCORE_REGEXES.forEach(([k,r])=>{ const m=t.match(r); if(m) s[k]=Math.min(10,Math.max(1,+m[1])); });
  return s;
}
function verdict(t) {
  if(!t)return "Under Review";
  const m = t.match(/^VERDICT:\s*(Undervalued|Fairly Valued|Overvalued)/im);
  if (m) return m[1];
  if (/undervalued/i.test(t)) return "Undervalued";
  if (/overvalued/i.test(t)) return "Overvalued";
  if (/fairly valued/i.test(t)) return "Fairly Valued";
  return "Under Review";
}
function scoreColor(s) { return s==null?BRD:s>=8?GRN:s>=6?BLU:s>=4?AMB:RED; }
function scoreBg(s) { return s==null?OFF:s>=8?GRNB:s>=6?BLUB:s>=4?AMBB:REDB; }

const cleanJSON = t => t.replace(/```json/gi,"").replace(/```/g,"").trim();

function Box({ children, pad=24, mb=20, style={} }) {
  return <div style={{ background:WHT, border:"1px solid "+BRD, borderRadius:12, padding:pad, marginBottom:mb, boxShadow:"0 1px 4px rgba(11,31,58,0.06)", ...style }}>{children}</div>;
}
function SectionLabel({ children }) {
  return <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
    <div style={{ width:3, height:16, background:NAV, borderRadius:2 }}/>
    <span style={{ fontSize:10, fontWeight:700, letterSpacing:"0.2em", textTransform:"uppercase", color:TXTM, fontFamily:BF }}>{children}</span>
  </div>;
}
const SPIN_DOTS=[0,1,2];
function Spinner() {
  return <span aria-hidden="true" style={{ display:"inline-flex", gap:4, alignItems:"center" }}>
    {SPIN_DOTS.map(i=><span key={i} style={{ width:6,height:6,borderRadius:"50%",background:NAV3,display:"inline-block",animation:"sp 1.2s "+(i*0.2)+"s infinite" }}/>)}
  </span>;
}
function LoadingBox({ label }) {
  return <Box><div style={{ display:"flex",alignItems:"center",gap:12,color:TXTM,fontFamily:BF }}><Spinner/><span>{label}</span></div></Box>;
}
function RetryButton({ onClick }) {
  if(!onClick)return null;
  return <button onClick={onClick} style={{ marginTop:10,background:NAV,color:WHT,border:"none",borderRadius:6,padding:"7px 16px",fontSize:12,fontWeight:700,fontFamily:BF,cursor:"pointer" }}>Retry</button>;
}
function ErrorBox({ msg, mono, onRetry }) {
  return <Box><SectionLabel>Error</SectionLabel>
    {mono
      ? <pre style={{ color:RED,fontSize:11,fontFamily:"monospace",whiteSpace:"pre-wrap" }}>{msg}</pre>
      : <p style={{ color:RED,fontFamily:BF,fontSize:13 }}>{msg}</p>}
    <RetryButton onClick={onRetry}/>
  </Box>;
}
function VerdictBadge({ v }) {
  const cfg={"Undervalued":[GRNB,GRN,"#6EE7B7"],"Overvalued":[REDB,RED,"#FCA5A5"],"Fairly Valued":[BLUB,BLU,"#93C5FD"],"Under Review":[OFF,TXTL,BRD]}[v]||[OFF,TXTL,BRD];
  return <span style={{ padding:"4px 14px",borderRadius:100,fontSize:11,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",background:cfg[0],color:cfg[1],border:"1px solid "+cfg[2],fontFamily:BF }}>{v}</span>;
}

function Gauge({ score, label }) {
  const [a,setA]=useState(0);
  const sz=100,r=40,circ=2*Math.PI*r,c=scoreColor(score),bg=scoreBg(score),pct=score!=null?score/10:0;
  useEffect(()=>{
    if(score==null)return;
    setA(0);let start=null,canceled=false,rafId=0;
    const go=ts=>{
      if(canceled)return;
      if(!start)start=ts;
      const p=Math.min((ts-start)/800,1);
      setA((1-Math.pow(1-p,3))*pct);
      if(p<1)rafId=requestAnimationFrame(go);
    };
    const t=setTimeout(()=>{rafId=requestAnimationFrame(go);},80);
    return()=>{canceled=true;clearTimeout(t);if(rafId)cancelAnimationFrame(rafId);};
  },[score]);
  return <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:5 }}>
    <div style={{ background:bg,borderRadius:"50%",padding:3,border:"2px solid "+c+"33" }}>
      <svg width={sz} height={sz}>
        <circle cx={sz/2} cy={sz/2} r={r} fill="none" stroke={c+"22"} strokeWidth={9}/>
        <circle cx={sz/2} cy={sz/2} r={r} fill="none" stroke={c} strokeWidth={9} strokeDasharray={a*circ+" "+circ} strokeLinecap="round" transform={"rotate(-90 "+sz/2+" "+sz/2+")"}/>
        {score!=null?<><text x={sz/2} y={sz/2-2} textAnchor="middle" fontSize={22} fontWeight="700" fill={c} fontFamily={DF}>{score}</text><text x={sz/2} y={sz/2+13} textAnchor="middle" fontSize={9} fill={TXTL} fontFamily={BF}>/10</text></>:<text x={sz/2} y={sz/2+5} textAnchor="middle" fontSize={16} fill={BRD} fontFamily={BF}>—</text>}
      </svg>
    </div>
    <span style={{ fontSize:9,fontWeight:700,color:TXTM,textAlign:"center",maxWidth:90,lineHeight:1.3,fontFamily:BF,letterSpacing:"0.06em",textTransform:"uppercase" }}>{label}</span>
  </div>;
}
const GAUGES=[["valuation","Valuation"],["fcf","Free Cash Flow"],["returns","Returns on Capital"],["balance","Capital Structure"],["management","Management"],["moat","Moat"],["catalysts","Catalysts"]];
const TABS=[{id:"overview",l:"Overview"},{id:"history",l:"10-Year History"},{id:"balance",l:"Balance Sheet"},{id:"tenk",l:"10-K Analysis"},{id:"news",l:"News"},{id:"management",l:"Management"}];
const TILES=["KO","BRK.B","JNJ","TSM","MSFT","GOLD","CVX","NVS"];
const TICKER_RE=/^[A-Z]{1,6}([.\-][A-Z]{1,4})?$/;
const validTicker=t=>TICKER_RE.test(t);
function Scorecard({ scores }) {
  return <Box><SectionLabel>1949 Value Scorecard</SectionLabel>
    <div style={{ display:"flex",flexWrap:"wrap",gap:20,justifyContent:"space-around" }}>
      {GAUGES.map(([k,l])=><Gauge key={k} score={scores[k]??null} label={l}/>)}
    </div>
  </Box>;
}

function ProseRenderer({ text }) {
  if (!text) return null;
  const elements = [];
  let buf = [];
  const flush = () => { if(buf.length){ elements.push(<p key={elements.length} style={{ margin:"0 0 14px",color:TXTM,lineHeight:1.9,fontSize:14,fontFamily:BF }}>{buf.join(" ")}</p>); buf=[]; } };
  text.split("\n").forEach((line,i) => {
    const tr = line.trim();
    if (/^(Valuation|Free Cash Flow|Returns on Capital|Capital Structure|Management|Moat|Catalysts|Overall|VERDICT)\s*:/i.test(tr)) return;
    const hm = tr.match(/^\*\*(.+?)\*\*\s*(.*)$/);
    if (hm) { flush(); elements.push(<div key={elements.length} style={{ marginTop:i>0?22:0,marginBottom:5 }}><span style={{ fontFamily:DF,fontWeight:700,fontSize:16,color:NAV }}>{hm[1]}</span>{hm[2]&&<span style={{ fontFamily:BF,fontSize:14,color:TXTM }}> {hm[2]}</span>}</div>); return; }
    if (tr==="") { flush(); return; }
    buf.push(tr);
  });
  flush();
  return <div>{elements}</div>;
}

function Tabs({ items, active, onChange }) {
  return <div role="tablist" style={{ display:"flex",borderBottom:"1px solid "+BRD,overflowX:"auto" }}>
    {items.map(([id,label])=><button key={id} role="tab" aria-selected={active===id} onClick={()=>onChange(id)} style={{ padding:"12px 18px",fontSize:13,fontFamily:BF,fontWeight:active===id?700:400,color:active===id?NAV:TXTL,background:"none",border:"none",cursor:"pointer",borderBottom:active===id?"2px solid "+NAV:"2px solid transparent",whiteSpace:"nowrap" }}>{label}</button>)}
  </div>;
}

function Chat({ context }) {
  const [msgs,setMsgs]=useState([]),[inp,setInp]=useState(""),[loading,setLoading]=useState(false);
  const endRef=useRef();
  const mountedRef=useRef(true);
  useEffect(()=>()=>{mountedRef.current=false;},[]);
  const send=async()=>{
    if(!inp.trim()||loading)return;
    const u={role:"user",content:inp},up=[...msgs,u];
    setMsgs(up);setInp("");setLoading(true);
    try{
      const r=await callAI([{role:"user",content:"Context:\n"+context},{role:"assistant",content:"Understood."},...up],300);
      if(mountedRef.current)setMsgs(prev=>[...prev,{role:"assistant",content:r}]);
    }
    catch(e){ if(mountedRef.current)setMsgs(prev=>[...prev,{role:"assistant",content:"Error: "+e.message}]); }
    if(mountedRef.current)setLoading(false);
    setTimeout(()=>endRef.current?.scrollIntoView({behavior:"smooth"}),100);
  };
  return <div style={{ display:"flex",flexDirection:"column",height:340 }}>
    <div style={{ flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:10,marginBottom:12 }}>
      {msgs.length===0&&<p style={{ color:TXTL,fontSize:13,fontStyle:"italic",fontFamily:BF }}>Ask about margin of safety, risks, catalysts...</p>}
      {msgs.map((m,i)=><div key={i} style={{ display:"flex",gap:8,flexDirection:m.role==="user"?"row-reverse":"row" }}>
        <div style={{ width:26,height:26,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700,background:m.role==="user"?NAV:NAVL,color:m.role==="user"?WHT:NAV,fontFamily:BF }}>{m.role==="user"?"YOU":"49"}</div>
        <div style={{ background:m.role==="user"?NAV:OFF,border:"1px solid "+(m.role==="user"?"transparent":BRD),borderRadius:8,padding:"8px 12px",fontSize:13,lineHeight:1.6,maxWidth:"80%",color:m.role==="user"?WHT:TXT,whiteSpace:"pre-wrap",fontFamily:BF }}>{m.content}</div>
      </div>)}
      {loading&&<div style={{ display:"flex",gap:8 }}><div style={{ width:26,height:26,borderRadius:"50%",background:NAVL,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700,color:NAV }}>49</div><div style={{ background:OFF,border:"1px solid "+BRD,borderRadius:8,padding:"8px 12px" }}><Spinner/></div></div>}
      <div ref={endRef}/>
    </div>
    <div style={{ display:"flex",gap:8 }}>
      <input value={inp} onChange={e=>setInp(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Ask a follow-up..." autoComplete="off" style={{ flex:1,border:"1.5px solid "+BRD,borderRadius:7,padding:"9px 12px",fontSize:13,fontFamily:BF,outline:"none" }}/>
      <button onClick={send} disabled={loading||!inp.trim()} style={{ background:NAV,color:WHT,border:"none",borderRadius:7,padding:"9px 18px",fontSize:13,fontWeight:700,fontFamily:BF,cursor:loading||!inp.trim()?"not-allowed":"pointer",opacity:loading||!inp.trim()?0.55:1 }}>Send</button>
    </div>
  </div>;
}

function PriceWidget({ ticker }) {
  return <Box>
    <SectionLabel>{ticker} · Price</SectionLabel>
    <div style={{ display:"flex",gap:12,flexWrap:"wrap",alignItems:"center" }}>
      <a href={"https://finance.yahoo.com/quote/"+encodeURIComponent(ticker)} target="_blank" rel="noreferrer" style={{ background:NAV,color:WHT,borderRadius:7,padding:"9px 18px",fontSize:13,fontWeight:700,fontFamily:BF,textDecoration:"none" }}>Yahoo Finance →</a>
      <a href={"https://www.tradingview.com/symbols/"+encodeURIComponent(ticker)} target="_blank" rel="noreferrer" style={{ background:OFF,color:NAV,border:"1px solid "+BRD,borderRadius:7,padding:"9px 18px",fontSize:13,fontWeight:700,fontFamily:BF,textDecoration:"none" }}>TradingView →</a>
    </div>
    <p style={{ fontSize:11,color:TXTL,fontFamily:BF,marginTop:10 }}>Click above for live price & charts.</p>
  </Box>;
}

function AnalysisPanel({ text, label }) {
  const [tab,setTab]=useState("text");
  const items=useMemo(()=>[["text",label],["chat","Ask Questions"]],[label]);
  return <Box pad={0}>
    <Tabs items={items} active={tab} onChange={setTab}/>
    <div style={{ padding:24 }}>{tab==="text"&&<ProseRenderer text={text}/>}{tab==="chat"&&<Chat context={text}/>}</div>
  </Box>;
}

function OverviewTab({ ticker, d, onRetry }) {
  if(d.loading)return <LoadingBox label={"Analyzing "+ticker+"..."}/>;
  if(d.error)return <ErrorBox msg={d.error} onRetry={onRetry}/>;
  if(!d.result)return null;
  return <>
    <PriceWidget ticker={ticker}/>
    <div style={{ background:NAV,borderRadius:12,padding:"24px 30px",marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:16 }}>
      <div><div style={{ fontSize:38,fontWeight:700,fontFamily:DF,color:WHT }}>{ticker}</div><div style={{ fontSize:10,color:NAVM,letterSpacing:"0.16em",textTransform:"uppercase",fontFamily:BF,marginTop:3 }}>1949 Value Advisors</div></div>
      <div style={{ display:"flex",alignItems:"center",gap:18 }}>
        {d.scores.overall&&<div style={{ textAlign:"center" }}><div style={{ fontSize:46,fontWeight:700,fontFamily:DF,color:d.scores.overall>=7?"#4ADE80":d.scores.overall>=5?"#60A5FA":"#F87171",lineHeight:1 }}>{d.scores.overall}<span style={{ fontSize:18,color:NAVM }}>/10</span></div><div style={{ fontSize:9,color:NAVM,letterSpacing:"0.16em",textTransform:"uppercase",fontFamily:BF }}>Overall</div></div>}
        {d.verdict&&<VerdictBadge v={d.verdict}/>}
      </div>
    </div>
    <Scorecard scores={d.scores}/>
    <AnalysisPanel text={d.result} label="Research Note"/>
  </>;
}

function HistoryTab({ ticker, d, onRetry }) {
  const [sel,setSel]=useState(null);
  useEffect(()=>{
    if(!sel)return;
    const onKey=e=>{if(e.key==="Escape")setSel(null);};
    window.addEventListener("keydown",onKey);
    const prevOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    return()=>{
      window.removeEventListener("keydown",onKey);
      document.body.style.overflow=prevOverflow;
    };
  },[sel]);
  if(d.loading)return <LoadingBox label="Loading 10-year history..."/>;
  if(!d.rows)return null;
  if(d.rows.error)return <ErrorBox msg={d.rows.error} mono onRetry={onRetry}/>;
  if(!d.rows.length)return <Box><p style={{ color:TXTL,fontFamily:BF }}>No data returned.</p></Box>;
  const cols=["year","revenue","netIncome","eps","fcf","roic"];
  const heads=["Year","Revenue","Net Income","EPS","FCF","ROIC"];
  return <Box pad={0}>
    {sel&&<div role="dialog" aria-modal="true" aria-labelledby="yd-title" style={{ position:"fixed",inset:0,background:"rgba(11,31,58,0.7)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:20 }} onClick={e=>e.target===e.currentTarget&&setSel(null)}>
      <div style={{ background:WHT,borderRadius:14,width:"100%",maxWidth:700,maxHeight:"88vh",overflow:"hidden",display:"flex",flexDirection:"column" }}>
        <div style={{ background:NAV,padding:"18px 24px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
          <div id="yd-title" style={{ fontSize:20,fontWeight:700,color:WHT,fontFamily:DF }}>{ticker} FY{sel.year}</div>
          <button onClick={()=>setSel(null)} aria-label="Close dialog" style={{ background:"rgba(255,255,255,0.15)",border:"none",color:WHT,borderRadius:6,width:32,height:32,fontSize:20,cursor:"pointer" }}>×</button>
        </div>
        <div style={{ flex:1,overflowY:"auto",padding:24 }}><YearDetail ticker={ticker} row={sel}/></div>
      </div>
    </div>}
    <div style={{ overflowX:"auto" }}>
      <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13,fontFamily:BF }}>
        <thead><tr style={{ background:NAV }}>{heads.map((h,i)=><th key={i} style={{ padding:"10px 14px",textAlign:i===0?"left":"right",fontSize:10,fontWeight:600,letterSpacing:"0.12em",textTransform:"uppercase",color:NAVM,whiteSpace:"nowrap" }}>{h}</th>)}</tr></thead>
        <tbody>{d.rows.map((row,i)=><tr key={row.year} onClick={()=>setSel(row)} style={{ background:i%2===0?WHT:OFF,cursor:"pointer" }} onMouseEnter={e=>e.currentTarget.style.background=NAVL} onMouseLeave={e=>e.currentTarget.style.background=i%2===0?WHT:OFF}>
          {cols.map((k,ci)=><td key={k} style={{ padding:"10px 14px",textAlign:ci===0?"left":"right",color:ci===0?NAV:TXTM,fontWeight:ci===0?700:400,borderBottom:"1px solid "+BRD,whiteSpace:"nowrap" }}>
            {ci===0?<span style={{ fontFamily:DF }}>{row[k]} <span style={{ fontSize:11,color:BLU }}>→</span></span>:(row[k]||"N/A")}
          </td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <div style={{ padding:"10px 20px",background:OFF,borderTop:"1px solid "+BRD }}>
      <p style={{ fontSize:11,color:TXTL,fontFamily:BF,margin:0 }}>AI-estimated figures. Verify against SEC EDGAR filings.</p>
    </div>
  </Box>;
}

const yearCache={};
function YearDetail({ ticker, row }) {
  const key=ticker+"|"+row.year;
  const [txt,setTxt]=useState(()=>yearCache[key]||null);
  const [loading,setLoading]=useState(()=>!yearCache[key]);
  useEffect(()=>{
    if(yearCache[key]){setTxt(yearCache[key]);setLoading(false);return;}
    setTxt(null);setLoading(true);
    let mounted=true;
    callAI([{role:"user",content:`${ticker} FY${row.year}. Rev ${row.revenue}|NI ${row.netIncome}|EPS ${row.eps}|FCF ${row.fcf}|ROIC ${row.roic}. Sections: **Year in Review**, **FCF Quality**, **Capital Allocation**, **Key Events**, **1949 Verdict**.`}],400)
      .then(r=>{yearCache[key]=r;if(mounted)setTxt(r);})
      .catch(e=>{if(mounted)setTxt("Error: "+e.message);})
      .finally(()=>{if(mounted)setLoading(false);});
    return()=>{mounted=false;};
  },[key]);
  if(loading)return <div style={{ display:"flex",gap:10,color:TXTL,fontFamily:BF }}><Spinner/> Analyzing...</div>;
  return <ProseRenderer text={txt}/>;
}

function TenKTab({ ticker, d, onRetry }) {
  if(d.loading)return <LoadingBox label={"Analyzing 10-K for "+ticker+"..."}/>;
  if(d.error)return <ErrorBox msg={d.error} onRetry={onRetry}/>;
  if(!d.result)return null;
  return <>
    <div style={{ background:NAV,borderRadius:12,padding:"24px 30px",marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:16 }}>
      <div>
        <div style={{ fontSize:22,fontWeight:700,fontFamily:DF,color:WHT }}>{ticker} — Latest 10-K</div>
        <a href={"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK="+encodeURIComponent(ticker)+"&type=10-K&owner=include&count=5"} target="_blank" rel="noreferrer" style={{ fontSize:12,color:"#93C5FD",fontFamily:BF,display:"block",marginTop:4 }}>View on SEC EDGAR →</a>
      </div>
      <div style={{ display:"flex",alignItems:"center",gap:16 }}>
        {d.verdict&&<VerdictBadge v={d.verdict}/>}
      </div>
    </div>
    <AnalysisPanel text={d.result} label="10-K Research Note"/>
  </>;
}

function NewsTab({ ticker, d, onRetry }) {
  if(d.loading)return <LoadingBox label={"Searching latest news for "+ticker+"..."}/>;
  if(d.error)return <ErrorBox msg={d.error} onRetry={onRetry}/>;
  if(!d.result)return null;
  return <>
    <div style={{ background:NAV,borderRadius:12,padding:"22px 28px",marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12 }}>
      <div><div style={{ fontSize:22,fontWeight:700,fontFamily:DF,color:WHT }}>{ticker} — News & Intelligence</div><div style={{ fontSize:10,color:NAVM,letterSpacing:"0.14em",textTransform:"uppercase",fontFamily:BF,marginTop:4 }}>Live web search</div></div>
      <div style={{ background:"rgba(255,255,255,0.1)",borderRadius:7,padding:"6px 12px",display:"flex",alignItems:"center",gap:7 }}>
        <div style={{ width:7,height:7,borderRadius:"50%",background:"#4ADE80" }}/><span style={{ fontSize:11,color:WHT,fontFamily:BF,fontWeight:600 }}>Live</span>
      </div>
    </div>
    <Box><ProseRenderer text={d.result}/></Box>
  </>;
}

function MgmtTab({ ticker, d, onRetry }) {
  if(d.loading)return <LoadingBox label="Loading management team..."/>;
  if(!d.mgmt)return null;
  if(d.mgmt.error)return <Box><SectionLabel>Could not load management data</SectionLabel><p style={{ color:TXTL,fontFamily:BF,fontSize:13 }}>{d.mgmt.error}</p><RetryButton onClick={onRetry}/></Box>;
  if(!Array.isArray(d.mgmt)||!d.mgmt.length)return <Box><p style={{ color:TXTL,fontFamily:BF }}>No data returned.</p></Box>;
  return <>
    <Box mb={16} style={{ padding:"12px 20px" }}><SectionLabel>{ticker} Leadership Team</SectionLabel></Box>
    <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:14 }}>
      {d.mgmt.map((p,i)=>{
        const nm=p.name||"Unknown";
        return <div key={(p.name||"")+"|"+(p.title||"")+"|"+i} style={{ background:WHT,border:"1px solid "+BRD,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 6px rgba(11,31,58,0.06)" }}>
          <div style={{ background:NAV,padding:"14px 18px" }}>
            <div style={{ fontSize:15,fontWeight:700,color:WHT,fontFamily:DF }}>{nm}</div>
            <div style={{ fontSize:11,color:NAVM,fontFamily:BF,marginTop:2 }}>{p.title}</div>
          </div>
          <div style={{ padding:"16px 18px" }}>
            <div style={{ display:"flex",gap:6,flexWrap:"wrap",marginBottom:10 }}>
              {p.tenure&&<span style={{ fontSize:11,background:NAVL,color:NAV3,padding:"2px 8px",borderRadius:100,fontFamily:BF }}>Tenure: {p.tenure}</span>}
              {p.ownership&&<span style={{ fontSize:11,background:GRNB,color:GRN,padding:"2px 8px",borderRadius:100,fontFamily:BF }}>Owns: {p.ownership}</span>}
            </div>
            <p style={{ fontSize:13,lineHeight:1.7,color:TXTM,fontFamily:BF,margin:"0 0 10px" }}>{p.background}</p>
            {p.assessment&&<div style={{ background:NAVL,borderLeft:"3px solid "+NAV3,borderRadius:"0 6px 6px 0",padding:"8px 12px" }}>
              <div style={{ fontSize:9,fontWeight:700,letterSpacing:"0.16em",textTransform:"uppercase",color:NAV3,fontFamily:BF,marginBottom:2 }}>1949 Assessment</div>
              <div style={{ fontSize:12,lineHeight:1.6,color:NAV,fontFamily:BF }}>{p.assessment}</div>
            </div>}
          </div>
        </div>;
      })}
    </div>
  </>;
}

function BalanceTab({ ticker, d, onRetry }) {
  if(d.loading)return <LoadingBox label={"Loading balance sheet for "+ticker+"..."}/>;
  if(!d.data)return null;
  if(d.data.error)return <ErrorBox msg={d.data.error} mono onRetry={onRetry}/>;
  const { metrics, rows, analysis } = d.data;
  const metricCards = [
    { label:"Total Assets", value:metrics.totalAssets, color:BLU, bg:BLUB },
    { label:"Total Debt", value:metrics.totalDebt, color:RED, bg:REDB },
    { label:"Net Cash / (Debt)", value:metrics.netCash, color:metrics.netCashPositive?GRN:RED, bg:metrics.netCashPositive?GRNB:REDB },
    { label:"Current Ratio", value:metrics.currentRatio, color:+metrics.currentRatio>=1.5?GRN:+metrics.currentRatio>=1?AMB:RED, bg:+metrics.currentRatio>=1.5?GRNB:+metrics.currentRatio>=1?AMBB:REDB },
    { label:"Debt / Equity", value:metrics.debtEquity, color:parseFloat(metrics.debtEquity)<=1?GRN:parseFloat(metrics.debtEquity)<=2?AMB:RED, bg:parseFloat(metrics.debtEquity)<=1?GRNB:parseFloat(metrics.debtEquity)<=2?AMBB:REDB },
    { label:"Book Value / Share", value:metrics.bookValuePerShare, color:NAV, bg:NAVL },
  ];
  const cols=["year","totalAssets","totalLiabilities","shareholderEquity","totalDebt","cashEquiv","currentRatio"];
  const heads=["Year","Total Assets","Total Liabilities","Equity","Total Debt","Cash & Equiv","Current Ratio"];
  return <>
    <div style={{ background:NAV,borderRadius:12,padding:"24px 30px",marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:16 }}>
      <div>
        <div style={{ fontSize:22,fontWeight:700,fontFamily:DF,color:WHT }}>{ticker} — Balance Sheet</div>
        <a href={"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK="+encodeURIComponent(ticker)+"&type=10-K&owner=include&count=5"} target="_blank" rel="noreferrer" style={{ fontSize:12,color:"#93C5FD",fontFamily:BF,display:"block",marginTop:4 }}>Verify on SEC EDGAR →</a>
      </div>
    </div>
    <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:12,marginBottom:20 }}>
      {metricCards.map(({label,value,color,bg})=><div key={label} style={{ background:bg,border:"1px solid "+color+"33",borderRadius:10,padding:"16px 18px" }}>
        <div style={{ fontSize:9,fontWeight:700,letterSpacing:"0.16em",textTransform:"uppercase",color:color,fontFamily:BF,marginBottom:6 }}>{label}</div>
        <div style={{ fontSize:22,fontWeight:700,fontFamily:DF,color:color }}>{value||"N/A"}</div>
      </div>)}
    </div>
    <Box pad={0} mb={20}>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13,fontFamily:BF }}>
          <thead><tr style={{ background:NAV }}>{heads.map((h,i)=><th key={i} style={{ padding:"10px 14px",textAlign:i===0?"left":"right",fontSize:10,fontWeight:600,letterSpacing:"0.12em",textTransform:"uppercase",color:NAVM,whiteSpace:"nowrap" }}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((row,i)=><tr key={row.year} style={{ background:i%2===0?WHT:OFF }}>
            {cols.map((k,ci)=><td key={k} style={{ padding:"10px 14px",textAlign:ci===0?"left":"right",color:ci===0?NAV:TXTM,fontWeight:ci===0?700:400,borderBottom:"1px solid "+BRD,whiteSpace:"nowrap",fontFamily:ci===0?DF:BF }}>
              {row[k]||"N/A"}
            </td>)}
          </tr>)}</tbody>
        </table>
      </div>
      <div style={{ padding:"10px 20px",background:OFF,borderTop:"1px solid "+BRD }}>
        <p style={{ fontSize:11,color:TXTL,fontFamily:BF,margin:0 }}>AI-estimated figures. Verify against SEC EDGAR filings.</p>
      </div>
    </Box>
    {analysis&&<Box><SectionLabel>1949 Balance Sheet Analysis</SectionLabel><ProseRenderer text={analysis}/></Box>}
  </>;
}

export default function App() {
  const [inp,setInp]=useState(""),[ticker,setTicker]=useState(""),[tab,setTab]=useState("overview");
  const [inpInvalid,setInpInvalid]=useState(false);
  const [ov,setOv]=useState({result:null,scores:{},verdict:null,loading:false,error:null});
  const [hist,setHist]=useState({rows:null,loading:false});
  const [bal,setBal]=useState({data:null,loading:false});
  const [tenk,setTenk]=useState({result:null,verdict:null,loading:false,error:null});
  const [news,setNews]=useState({result:null,loading:false,error:null});
  const [mgmt,setMgmt]=useState({mgmt:null,loading:false});

  const cacheRef=useRef({});
  const getC=(t,k)=>cacheRef.current[t]?.[k];
  const putC=(t,k,v)=>{cacheRef.current[t]={...cacheRef.current[t],[k]:v};};

  const tickerRef=useRef(ticker);
  useEffect(()=>{tickerRef.current=ticker;},[ticker]);
  const live=t=>tickerRef.current===t;

  const inFlight=useRef({});
  const begin=(t,k)=>{const f=t+":"+k;if(inFlight.current[f])return false;inFlight.current[f]=true;return true;};
  const end=(t,k)=>{delete inFlight.current[t+":"+k];};

  const fetchOverview=t=>{
    const c=getC(t,"ov"); if(c){setOv(c);return;}
    setOv({result:null,scores:{},verdict:null,loading:true,error:null});
    if(!begin(t,"ov"))return;
    callAI([{role:"user",content:"Scorecard for "+t+" integers 1-10:\nValuation: <n>\nFree Cash Flow: <n>\nReturns on Capital: <n>\nCapital Structure: <n>\nManagement: <n>\nMoat: <n>\nCatalysts: <n>\nOverall: <n>\nVERDICT: Undervalued|Fairly Valued|Overvalued\n\n3 short sections: **Overview**, **Valuation & Moat**, **Bottom Line**."}],700)
      .then(r=>{const n={result:r,scores:parseScores(r),verdict:verdict(r),loading:false,error:null};putC(t,"ov",n);if(live(t))setOv(n);})
      .catch(e=>{if(live(t))setOv({result:null,scores:{},verdict:null,loading:false,error:e.message});})
      .finally(()=>end(t,"ov"));
  };
  const fetchHist=t=>{
    const c=getC(t,"hist"); if(c){setHist(c);return;}
    setHist({rows:null,loading:true});
    if(!begin(t,"hist"))return;
    callAI([{role:"user",content:"JSON array only for "+t+", 10yr annual newest first. Schema:[{year:2024,revenue:\"94B\",netIncome:\"23B\",eps:\"5.42\",fcf:\"18B\",roic:\"18%\"}]"}],700)
      .then(text=>{
        try{
          let c=cleanJSON(text);
          const s=c.indexOf("["),e=c.lastIndexOf("]");
          if(s<0||e<0)throw new Error("No JSON array found in response");
          c=c.slice(s,e+1).replace(/,(\s*[\]}])/g,"$1");
          const p=JSON.parse(c);
          if(!Array.isArray(p)||!p.length)throw new Error("Empty array");
          const n={rows:p.sort((a,b)=>(+b.year)-(+a.year)),loading:false};
          putC(t,"hist",n);if(live(t))setHist(n);
        }catch(err){
          const preview=String(text||"").slice(0,160).replace(/\s+/g," ").trim();
          if(live(t))setHist({rows:{error:err.message+" | preview: "+preview+(text&&text.length>160?"…":"")},loading:false});
        }
      })
      .catch(err=>{if(live(t))setHist({rows:{error:String(err.message||err)},loading:false});})
      .finally(()=>end(t,"hist"));
  };
  const fetchBal=t=>{
    const c=getC(t,"bal"); if(c){setBal(c);return;}
    setBal({data:null,loading:true});
    if(!begin(t,"bal"))return;
    setTimeout(()=>{
    callAI([{role:"user",content:"Balance sheet JSON for "+t+". ONLY raw JSON: {\"metrics\":{\"totalAssets\":\"X\",\"totalDebt\":\"X\",\"netCash\":\"X\",\"netCashPositive\":true,\"currentRatio\":\"X\",\"debtEquity\":\"X\",\"bookValuePerShare\":\"X\"},\"rows\":[{\"year\":2024,\"totalAssets\":\"X\",\"totalLiabilities\":\"X\",\"shareholderEquity\":\"X\",\"totalDebt\":\"X\",\"cashEquiv\":\"X\",\"currentRatio\":\"X\"}],\"analysis\":\"2 sentence balance sheet assessment.\"}. 5 years newest first."}],400)
      .then(text=>{
        try{
          const c=cleanJSON(text);
          const s=c.indexOf("{"),e=c.lastIndexOf("}");
          if(s<0||e<0)throw new Error("No JSON found");
          const o=JSON.parse(c.slice(s,e+1));
          if(!o.metrics||!o.rows)throw new Error("Invalid structure");
          const n={data:o,loading:false};
          putC(t,"bal",n);if(live(t))setBal(n);
        }catch(err){
          const preview=String(text||"").slice(0,160).replace(/\s+/g," ").trim();
          if(live(t))setBal({data:{error:err.message+" | preview: "+preview},loading:false});
        }
      })
      .catch(err=>{if(live(t))setBal({data:{error:String(err.message||err)},loading:false});})
      .finally(()=>end(t,"bal"));
    },2000);
  };
  const fetchTenk=t=>{
    const c=getC(t,"tenk"); if(c){setTenk(c);return;}
    setTenk({result:null,verdict:null,loading:true,error:null});
    if(!begin(t,"tenk"))return;
    callAI([{role:"user",content:"10-K note on "+t+". Sections: **Filing Overview**, **Valuation**, **Key Risks**, **Bottom Line**. End: VERDICT: Undervalued|Fairly Valued|Overvalued."}],700)
      .then(r=>{const n={result:r,verdict:verdict(r),loading:false,error:null};putC(t,"tenk",n);if(live(t))setTenk(n);})
      .catch(e=>{if(live(t))setTenk({result:null,verdict:null,loading:false,error:e.message});})
      .finally(()=>end(t,"tenk"));
  };
  const fetchNews=t=>{
    const c=getC(t,"news"); if(c){setNews(c);return;}
    setNews({result:null,loading:true,error:null});
    if(!begin(t,"news"))return;
    callAISearch([{role:"user",content:"2026 news on "+t+". Sections: **Headlines**, **Financials**, **Analyst View**, **1949 Take**."}],600)
      .then(r=>{const n={result:r,loading:false,error:null};putC(t,"news",n);if(live(t))setNews(n);})
      .catch(e=>{if(live(t))setNews({result:null,loading:false,error:e.message});})
      .finally(()=>end(t,"news"));
  };
  const fetchMgmt=t=>{
    const c=getC(t,"mgmt"); if(c){setMgmt(c);return;}
    setMgmt({mgmt:null,loading:true});
    if(!begin(t,"mgmt"))return;
    callAI([{role:"user",content:`Senior mgmt of ${t}. ONLY raw JSON array, no prose. Schema: [{"name":"Full Name","title":"Title","tenure":"X yrs","ownership":"X%","background":"1-2 sent","assessment":"1949 view, 1 sent"}]`}],600)
      .then(text=>{
        let c=cleanJSON(text);
        if(!c.startsWith("["))c=c.slice(c.indexOf("["));
        const e=c.lastIndexOf("]");
        if(e<0){if(live(t))setMgmt({mgmt:{error:"No JSON returned"},loading:false});return;}
        try{ const p=JSON.parse(c.slice(0,e+1)); const v=Array.isArray(p)&&p.length?p:{error:"Empty"}; const n={mgmt:v,loading:false}; if(Array.isArray(v))putC(t,"mgmt",n); if(live(t))setMgmt(n); }
        catch(e2){ if(live(t))setMgmt({mgmt:{error:e2.message},loading:false}); }
      })
      .catch(e=>{if(live(t))setMgmt({mgmt:{error:String(e)},loading:false});})
      .finally(()=>end(t,"mgmt"));
  };

  const analyze=t=>{
    if(t===ticker){setTab("overview");return;}
    setTicker(t);setTab("overview");
    setHist({rows:null,loading:false});
    setBal({data:null,loading:false});
    setTenk({result:null,verdict:null,loading:false,error:null});
    setNews({result:null,loading:false,error:null});
    setMgmt({mgmt:null,loading:false});
    fetchOverview(t);
  };

  useEffect(()=>{
    if(!ticker)return;
    if(tab==="history"&&hist.rows===null&&!hist.loading)fetchHist(ticker);
    else if(tab==="balance"&&bal.data===null&&!bal.loading)fetchBal(ticker);
    else if(tab==="tenk"&&tenk.result===null&&!tenk.loading&&!tenk.error)fetchTenk(ticker);
    else if(tab==="news"&&news.result===null&&!news.loading&&!news.error)fetchNews(ticker);
    else if(tab==="management"&&mgmt.mgmt===null&&!mgmt.loading)fetchMgmt(ticker);
  },[tab,ticker]);

  const go=()=>{
    const t=inp.trim().toUpperCase();
    if(t&&validTicker(t)){setInpInvalid(false);analyze(t);}
    else if(t){setInpInvalid(true);setTimeout(()=>setInpInvalid(false),1800);}
  };

  return <>
    <style dangerouslySetInnerHTML={{__html:"@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Lato:wght@400;700&display=swap');*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}body{background:#F7F9FC;font-family:'Lato',sans-serif;}button:not(:disabled):hover{opacity:0.85;}@keyframes sp{0%,80%,100%{transform:scale(0.6);opacity:0.3;}40%{transform:scale(1);opacity:1;}}"}}/>
    <div style={{minHeight:"100vh",background:OFF}}>
      <header style={{background:NAV,padding:"0 24px",position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 16px rgba(11,31,58,0.3)"}}>
        <div style={{maxWidth:1200,margin:"0 auto",height:60,display:"flex",alignItems:"center",gap:18}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
            <div style={{width:36,height:36,background:WHT,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:11,fontWeight:800,color:NAV,fontFamily:DF}}>1949</span></div>
            <span style={{fontSize:14,fontWeight:700,color:WHT,fontFamily:DF}}>Value Research</span>
          </div>
          <div style={{flex:1,display:"flex",gap:7,maxWidth:380}}>
            <input aria-label="Stock ticker symbol" aria-invalid={inpInvalid} value={inp} onChange={e=>{setInp(e.target.value.toUpperCase());if(inpInvalid)setInpInvalid(false);}} onKeyDown={e=>e.key==="Enter"&&go()} placeholder={inpInvalid?"Invalid ticker — try AAPL, KO...":"Enter ticker — AAPL, KO, TSM..."} autoComplete="off" spellCheck="false" style={{flex:1,background:"rgba(255,255,255,0.1)",border:"1px solid "+(inpInvalid?"#F87171":"rgba(255,255,255,0.2)"),borderRadius:7,padding:"7px 12px",fontSize:14,fontFamily:BF,color:WHT,outline:"none",transition:"border-color 0.2s"}}/>
            <button onClick={go} aria-label="Analyze ticker" style={{background:WHT,color:NAV,border:"none",borderRadius:7,padding:"7px 16px",fontSize:13,fontWeight:700,fontFamily:BF,cursor:"pointer"}}>Analyze</button>
          </div>
          {ticker&&<nav role="tablist" aria-label="Sections" style={{display:"flex",gap:1,marginLeft:"auto",overflowX:"auto"}}>
            {TABS.map(t=><button key={t.id} role="tab" aria-selected={tab===t.id} aria-current={tab===t.id?"page":undefined} onClick={()=>setTab(t.id)} style={{padding:"7px 10px",fontSize:11,fontFamily:BF,fontWeight:tab===t.id?700:400,color:tab===t.id?WHT:TXTL,background:tab===t.id?"rgba(255,255,255,0.15)":"transparent",border:"none",borderRadius:5,cursor:"pointer",whiteSpace:"nowrap"}}>{t.l}</button>)}
          </nav>}
        </div>
      </header>
      <main style={{maxWidth:1200,margin:"0 auto",padding:"24px"}}>
        {!ticker&&<div style={{background:WHT,border:"1px solid "+BRD,borderRadius:14,padding:"56px 24px",textAlign:"center"}}>
          <div style={{width:52,height:52,background:NAV,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 18px"}}><span style={{fontSize:16,fontWeight:800,color:WHT,fontFamily:DF}}>1949</span></div>
          <div style={{fontSize:28,fontWeight:700,fontFamily:DF,color:NAV,marginBottom:10}}>Value Research Platform</div>
          <p style={{color:TXTM,fontFamily:BF,fontSize:14,maxWidth:460,margin:"0 auto 28px",lineHeight:1.7}}>Institutional-grade equity research powered by the 1949 Value Advisors framework.</p>
          <div style={{display:"flex",justifyContent:"center",gap:8,flexWrap:"wrap"}}>
            {TILES.map(t=><button key={t} onClick={()=>{setInp(t);analyze(t);}} style={{background:NAVL,color:NAV,border:"1px solid "+NAVM,borderRadius:7,padding:"7px 16px",fontSize:13,fontWeight:700,fontFamily:BF,cursor:"pointer"}}>{t}</button>)}
          </div>
        </div>}
        {ticker&&tab==="overview"&&<OverviewTab ticker={ticker} d={ov} onRetry={()=>fetchOverview(ticker)}/>}
        {ticker&&tab==="history"&&<HistoryTab ticker={ticker} d={hist} onRetry={()=>fetchHist(ticker)}/>}
        {ticker&&tab==="balance"&&<BalanceTab ticker={ticker} d={bal} onRetry={()=>fetchBal(ticker)}/>}
        {ticker&&tab==="tenk"&&<TenKTab ticker={ticker} d={tenk} onRetry={()=>fetchTenk(ticker)}/>}
        {ticker&&tab==="news"&&<NewsTab ticker={ticker} d={news} onRetry={()=>fetchNews(ticker)}/>}
        {ticker&&tab==="management"&&<MgmtTab ticker={ticker} d={mgmt} onRetry={()=>fetchMgmt(ticker)}/>}
      </main>
    </div>
  </>;
}
