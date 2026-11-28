import Chatbot from './components/Chatbot';
import React,{useEffect,useMemo,useState} from 'react';
import{createRoot}from'react-dom/client';
import{io}from'socket.io-client';
import{Activity,ArrowRight,BarChart3,CalendarClock,CheckCircle2,ClipboardList,Clock3,GraduationCap,LogOut,Plus,RefreshCw,ShieldCheck,Ticket,Users,Wifi}from'lucide-react';
import './style.css';
const API=import.meta.env.VITE_API_URL||'http://localhost:5000';
const saved=()=>{try{return JSON.parse(localStorage.getItem('waitless_session'))}catch{return null}};
async function request(path,{token,method='GET',body}={}){
  const response=await fetch(`${API}/api${path}`,{
    method,
    headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},
    body:body?JSON.stringify(body):undefined
  });
  let json={};
  try{json=await response.json()}catch{}
  if(!response.ok){
    const message=json.error||`Request failed (${response.status})`;
    // 403 can also mean a normal cross-department denial: do NOT log out for that.
    const disabledAccount=response.status===403 && /account disabled|account.*unavailable/i.test(message);
    const invalidLogin=response.status===401;
    if(token && (disabledAccount||invalidLogin)){
      window.dispatchEvent(new CustomEvent('waitless:session-invalid',{
        detail:{token,reason:disabledAccount?'Your account has been disabled. Please contact the administrator.':'Your session has expired. Please sign in again.'}
      }));
    }
    const error=new Error(message);
    error.status=response.status;
    throw error;
  }
  return json;
}
const portalRoles=['student','staff','admin'];
const portalPath=role=>`/${role}/login`;
const dashboardPath=role=>`/${role}/dashboard`;
function currentRoute(){return window.location.pathname.replace(/\/$/,'')||'/';}
function goTo(path){if(currentRoute()!==path)window.history.pushState({},'',path);window.dispatchEvent(new Event('popstate'));}
const fmtDate=d=>d?new Date(d).toLocaleString(): '—';
const Button=({children,...props})=><button {...props}>{children}</button>;
function App(){
 const [session,setSession]=useState(saved);
 const [route,setRoute]=useState(currentRoute);
 const [staffList,setStaffList]=useState([]);
 const [staffName,setStaffName]=useState('');
 const [staffEmail,setStaffEmail]=useState('');
 const [staffPassword,setStaffPassword]=useState('');
 const [staffService,setStaffService]=useState('');
 const [staffCounter,setStaffCounter]=useState('');
 useEffect(()=>{const handler=()=>setRoute(currentRoute());window.addEventListener('popstate',handler);return()=>window.removeEventListener('popstate',handler)},[]);
 // Clear cached personal/queue information when the server revokes this session.
 useEffect(()=>{
   const onInvalidSession=(event)=>{
     const stored=saved();
     if(!stored?.token || stored.token!==event.detail?.token)return;
     const previousRole=stored.user?.role||'student';
     localStorage.removeItem('waitless_session');
     setSession(null);
     setServices([]);setCounters([]);setTokens([]);setStats({});setStaffList([]);
     setCounterId('');setServiceId('');setTab('dashboard');setAuthMode('login');
     goTo(portalPath(previousRole));
     setNotice(event.detail.reason||'Session ended. Please sign in again.');
   };
   window.addEventListener('waitless:session-invalid',onInvalidSession);
   return()=>window.removeEventListener('waitless:session-invalid',onInvalidSession);
 },[]);
 const [authMode,setAuthMode]=useState('login');const [notice,setNotice]=useState('');const [loading,setLoading]=useState(false);const [services,setServices]=useState([]);const [counters,setCounters]=useState([]);const [tokens,setTokens]=useState([]);const [stats,setStats]=useState({});const [serviceId,setServiceId]=useState('');const [counterId,setCounterId]=useState('');const [tab,setTab]=useState('dashboard');const [serviceName,setServiceName]=useState('');const [duration,setDuration]=useState('10');const [counterLabel,setCounterLabel]=useState('');const [counterService,setCounterService]=useState('');
 const token=session?.token,role=session?.user?.role;
 const flash=(message)=>setNotice(message);
 async function refresh(){
   if(!token)return;
   const stillCurrent=()=>saved()?.token===token;
   try{
     const [s,c,q]=await Promise.all([
       request('/services',{token}),request('/counters',{token}),request('/queue',{token})
     ]);
     if(!stillCurrent())return;
     const extra=role==='student'?null:await request('/stats',{token});
     if(!stillCurrent())return;
     const staff=role==='admin'?await request('/admin/staff',{token}):null;
     if(!stillCurrent())return;
     setServices(s);setCounters(c);setTokens(q);
     if(extra!==null)setStats(extra);
     if(staff!==null)setStaffList(staff);
   }catch(e){if(stillCurrent())flash(e.message)}
 }
 useEffect(()=>{if(!token)return;refresh();const socket=io(API,{auth:{token}});socket.on('queue:changed',refresh);const interval=setInterval(refresh,20000);return()=>{socket.disconnect();clearInterval(interval)}},[token,role]);
 async function doAuth(e){
  e.preventDefault();setLoading(true);flash('');
  const data=Object.fromEntries(new FormData(e.currentTarget));
  const loginRole=route.split('/')[1];
  try{
    if(!portalRoles.includes(loginRole))throw Error('Choose a valid portal');
    const endpoint=authMode==='register'?'/auth/register':`/auth/${loginRole}/login`;
    if(authMode==='register'&&loginRole!=='student')throw Error('Only students can register');
    const response=await request(endpoint,{method:'POST',body:data});
    if(response.user?.role!==loginRole)throw Error('Wrong account role for this portal');
    localStorage.setItem('waitless_session',JSON.stringify(response));
    setSession(response);goTo(dashboardPath(loginRole));flash('Welcome to WaitLess!');
  }catch(e){flash(e.message)}finally{setLoading(false)}
 }
 async function action(path,method='POST',body){setLoading(true);flash('');try{const response=await request(path,{token,method,body});flash(response.token_code?`Token ${response.token_code} generated successfully.`:'Action completed.');await refresh()}catch(e){flash(e.message)}finally{setLoading(false)}}
 function logout(){const previousRole=role||'student';localStorage.removeItem('waitless_session');setSession(null);setServices([]);setCounters([]);setTokens([]);setStats({});setStaffList([]);setCounterId('');setServiceId('');setTab('dashboard');setAuthMode('login');flash('');goTo(portalPath(previousRole));}
 const active=tokens.filter(t=>['waiting','called','serving'].includes(t.status));const myActive=active.find(t=>t.status!=='completed');const currentCounter=counters.find(c=>String(c.id)===String(counterId));const currentToken=tokens.find(t=>t.counter_id===currentCounter?.id&&['called','serving'].includes(t.status));
 const waitingByService=useMemo(()=>Object.fromEntries(services.map(s=>[s.id,tokens.filter(t=>t.service_id===s.id&&t.status==='waiting').length])),[services,tokens]);
 if(route==='/' || !/^\/(student|staff|admin)\/(login|dashboard)$/.test(route))return <div className="auth-layout"><div className="auth-hero"><div className="mark"><Users size={34}/><span>Wait<span className="green">Less</span></span></div><div className="hero-content"><span className="pill"><Wifi size={14}/> UNIVERSITY QUEUE PLATFORM</span><h1>Less waiting.<br/><em>More living.</em></h1><p>Choose your dedicated portal to continue.</p><div className="hero-cards"><span><Ticket/> Virtual tokens</span><span><ShieldCheck/> Secure access</span><span><BarChart3/> Predictions</span></div></div><p className="tiny">Academic prototype • Estimates require real-world validation</p></div><div className="auth-side"><div className="auth-card"><div className="brand-small"><GraduationCap/> WaitLess Portal</div><h2>Choose your portal</h2><p className="muted">Each role has a dedicated sign-in page.</p>{portalRoles.map(r=><button key={r} type="button" className="btn primary wide" style={{marginTop:14,textTransform:'capitalize'}} onClick={()=>{setAuthMode('login');flash('');goTo(portalPath(r))}}>{r} Login <ArrowRight size={16}/></button>)}</div></div></div>;
 const routeRole=route.split('/')[1];
 if(route.endsWith('/login') && session?.user?.role===routeRole){return <div className="auth-layout"><div className="auth-side" style={{width:'100%',minHeight:'100vh'}}><div className="auth-card"><div className="brand-small"><GraduationCap/> WaitLess Portal</div><h2>Already signed in</h2><p className="muted">Continue to your {routeRole} dashboard, or sign out to switch accounts.</p><button className="btn primary wide" onClick={()=>goTo(dashboardPath(routeRole))}>Open Dashboard <ArrowRight size={16}/></button><button className="btn outline wide" style={{marginTop:12}} onClick={logout}>Sign out</button></div></div></div>;}
 if(!session || route.endsWith('/login'))return <div className="auth-layout"><div className="auth-hero"><div className="mark"><Users size={34}/><span>Wait<span className="green">Less</span></span></div><div className="hero-content"><span className="pill"><Wifi size={14}/> SMART QUEUE PLATFORM</span><h1>Less waiting.<br/><em>More living.</em></h1><p>Digital tokens, real-time queue visibility and intelligent waiting time estimates for university services.</p><div className="hero-cards"><span><Ticket/> Virtual tokens</span><span><Activity/> Live queues</span><span><BarChart3/> Predictions</span></div></div><p className="tiny">Academic prototype • Synthetic ML data; estimates are not guaranteed</p></div><div className="auth-side"><form className="auth-card" onSubmit={doAuth}><div className="brand-small"><GraduationCap/> {routeRole.charAt(0).toUpperCase()+routeRole.slice(1)} Portal</div><h2>{authMode==='login'?'Welcome back':'Create your account'}</h2><p className="muted">{authMode==='login'?'Sign in to manage your queue.':'Student registration is free.'}</p>{authMode==='register'&&routeRole==='student'&&<label>Full name<input required name="name" placeholder="Your full name" minLength="2"/></label>}<label>Email<input required name="email" type="email" placeholder="name@example.com"/></label><label>Password<input required name="password" type="password" minLength="8" placeholder="At least 8 characters"/></label><Button className="btn primary wide" disabled={loading}>{loading?'Please wait...':authMode==='login'?'Sign in':'Register'} <ArrowRight size={16}/></Button>{notice&&<p className="alert">{notice}</p>}{routeRole==='student'&&<p className="auth-switch">{authMode==='login'?'New student?':'Already registered?'} <button type="button" onClick={()=>{setAuthMode(authMode==='login'?'register':'login');flash('')}}>{authMode==='login'?'Create account':'Sign in'}</button></p>}<p className="auth-switch"><button type="button" onClick={()=>{setAuthMode('login');flash('');goTo('/')}}>← Choose another portal</button></p></form></div></div>;
 if(routeRole!==role || !route.endsWith('/dashboard')){
   return <div className="auth-layout"><div className="auth-side" style={{width:'100%',minHeight:'100vh'}}><div className="auth-card"><h2>Access restricted</h2><p className="muted">This page is reserved for the {routeRole} role. Your signed-in role is {role}.</p><button className="btn primary wide" onClick={()=>goTo(dashboardPath(role))}>Go to my dashboard <ArrowRight size={16}/></button><button className="btn outline wide" style={{marginTop:12}} onClick={logout}>Sign out</button></div></div></div>;
 }
 return <div className="layout"><aside className="sidebar"><div className="brand-small inverse"><Users/> Wait<span className="green">Less</span></div><div className="side-label">WORKSPACE</div><button className={`navbtn ${tab==='dashboard'?'selected':''}`} onClick={()=>setTab('dashboard')}><BarChart3 size={18}/> Dashboard</button><button className={`navbtn ${tab==='queue'?'selected':''}`} onClick={()=>setTab('queue')}><Ticket size={18}/> Queue Management</button>{role==='admin'&&<><button className={`navbtn ${tab==='manage'?'selected':''}`} onClick={()=>setTab('manage')}><ShieldCheck size={18}/> Manage Services</button><button className={`navbtn ${tab==='staff'?'selected':''}`} onClick={()=>setTab('staff')}><Users size={18}/> Staff Management</button></>}<div className="sidebar-bottom"><div className="profile-avatar">{session.user.name[0]?.toUpperCase()}</div><div className="profile"><strong>{session.user.name}</strong><small>{role.toUpperCase()}</small></div><button className="iconbtn light" title="Log out" onClick={logout}><LogOut size={18}/></button></div></aside><main className="main"><header className="header"><div><p className="overline">WAITLESS / {role.toUpperCase()} PORTAL</p><h1>{tab==='staff'?'Staff Management':tab==='manage'?'Service Configuration':tab==='queue'?'Live Queue':`Hello, ${session.user.name.split(' ')[0]} 👋`}</h1><p className="muted">{role==='student'?'Manage your university service visits.':'Manage service operations with up-to-date queue information.'}</p></div><div className="header-actions"><span className="live"><span/> Live sync</span><button className="btn outline" onClick={refresh}><RefreshCw size={16}/> Refresh</button></div></header>{notice&&<div className="flash" role="status">{notice}<button onClick={()=>flash('')}>×</button></div>}
 {tab==='dashboard'&&<><div className="stat-grid"><Kpi icon={<Ticket/>} label={role==='student'?'Your Tokens':'Total Today'} value={role==='student'?tokens.length:stats.total||0}/><Kpi icon={<Clock3/>} label="Waiting" value={role==='student'?tokens.filter(t=>t.status==='waiting').length:stats.waiting||0}/><Kpi icon={<Activity/>} label="Being Served" value={role==='student'?tokens.filter(t=>t.status==='serving').length:stats.serving||0}/><Kpi icon={<CheckCircle2/>} label="Completed" value={role==='student'?tokens.filter(t=>t.status==='completed').length:stats.completed||0}/></div>{role==='student'?<div className="columns"><section className="card"><h2><Plus size={20}/> Get a new token</h2><p className="muted">Select the office you want to visit.</p><label>Service<select value={serviceId} onChange={e=>setServiceId(e.target.value)}><option value="">Choose a university service</option>{services.filter(s=>s.is_active).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><Button disabled={!serviceId||loading} className="btn primary wide" onClick={()=>action('/tokens','POST',{service_id:Number(serviceId)})}>Generate Virtual Token <ArrowRight size={18}/></Button><p className="helper">One active token per service. ML estimates are illustrative until validated against real data.</p></section><section className="card spotlight"><h2><CalendarClock size={20}/> Your Current Queue</h2>{myActive?<><div className="token-big">{myActive.token_code}</div><div className="status-line"><span className={'status '+myActive.status}>{myActive.status}</span><span>{myActive.service_name}</span></div><div className="prediction"><Clock3 size={23}/><div><small>Estimated waiting time at booking</small><strong>≈ {myActive.predicted_minutes ?? '—'} min</strong><small>{myActive.prediction_source==='ml-synthetic-demo'?'Synthetic-data ML estimate':'Rule-based estimate'}</small></div></div><Button className="btn outline" onClick={()=>action(`/tokens/${myActive.id}/cancel`,'PATCH')} disabled={myActive.status!=='waiting'||loading}>Cancel waiting token</Button></>:<div className="empty">No active token yet. Choose a service to join a queue.</div>}</section></div>:<div className="columns"><section className="card"><h2><Activity size={20}/> Live Operations</h2><p className="muted">Choose a service counter and call the next student.</p><label>Counter<select value={counterId} onChange={e=>setCounterId(e.target.value)}><option value="">Select a counter</option>{counters.filter(c=>c.is_active).map(c=><option key={c.id} value={c.id}>{c.label} — {c.service_name}</option>)}</select></label><Button className="btn primary wide" disabled={!counterId||loading||Boolean(currentToken)} onClick={()=>action('/queue/call-next','POST',{counter_id:Number(counterId)})}>Call Next Token <ArrowRight size={18}/></Button><div className="counter-call">{currentToken?<><span>NOW SERVING</span><strong>{currentToken.token_code}</strong><p>{currentToken.student_name}</p><div className="btn-row">{currentToken.status==='called'&&<Button className="btn primary" onClick={()=>action(`/tokens/${currentToken.id}/status`,'PATCH',{status:'serving'})}>Start</Button>}{currentToken.status==='serving'&&<Button className="btn primary" onClick={()=>action(`/tokens/${currentToken.id}/status`,'PATCH',{status:'completed'})}>Complete</Button>}<Button className="btn danger" onClick={()=>action(`/tokens/${currentToken.id}/status`,'PATCH',{status:'skipped'})}>Skip</Button></div></>:<><span>READY TO SERVE</span><p>No active token assigned to this counter.</p></>}</div></section><section className="card"><h2><BarChart3 size={20}/> Queue Snapshot</h2>{services.map(s=><div className="service-progress" key={s.id}><div><strong>{s.name}</strong><span>{waitingByService[s.id]||0} waiting</span></div><div className="progress-track"><span style={{width:`${Math.min(100,(waitingByService[s.id]||0)*12)}%`}}/></div></div>)}</section></div>}</>}
 {tab==='queue'&&<section className="card"><div className="table-title"><h2><ClipboardList size={20}/> {role==='student'?'My Token History':'Active & Recent Tokens'}</h2><span className="muted">Live data from MySQL</span></div><div className="table-scroll"><table><thead><tr><th>Token</th><th>Student</th><th>Service</th><th>Status</th><th>Estimate</th><th>Issued</th></tr></thead><tbody>{tokens.map(t=><tr key={t.id}><td><strong>{t.token_code}</strong></td><td>{t.student_name}</td><td>{t.service_name}</td><td><span className={`status ${t.status}`}>{t.status}</span></td><td>{t.predicted_minutes??'—'} min</td><td>{fmtDate(t.issued_at)}</td></tr>)}</tbody></table>{tokens.length===0&&<div className="empty">No tokens to display.</div>}</div></section>}
 {tab==='manage'&&role==='admin'&&<div className="columns"><form className="card" onSubmit={e=>{e.preventDefault();action('/admin/services','POST',{name:serviceName,avg_duration_min:Number(duration)}).then(()=>{setServiceName('')})}}><h2><Plus size={20}/> Add a Service</h2><label>Service name<input value={serviceName} onChange={e=>setServiceName(e.target.value)} required placeholder="e.g. Student Affairs"/></label><label>Average service duration (minutes)<input type="number" min="1" max="240" value={duration} onChange={e=>setDuration(e.target.value)}/></label><Button disabled={loading} className="btn primary wide">Create Service</Button></form><form className="card" onSubmit={e=>{e.preventDefault();action('/admin/counters','POST',{label:counterLabel,service_id:Number(counterService)}).then(()=>setCounterLabel(''))}}><h2><Plus size={20}/> Add a Counter</h2><label>Counter name<input value={counterLabel} onChange={e=>setCounterLabel(e.target.value)} required placeholder="e.g. Registrar Desk 2"/></label><label>Service<select required value={counterService} onChange={e=>setCounterService(e.target.value)}><option value="">Choose</option>{services.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><Button disabled={loading} className="btn primary wide">Create Counter</Button></form></div>}
 {tab==='staff'&&role==='admin'&&<><div className="columns"><form className="card" onSubmit={async e=>{e.preventDefault();setLoading(true);flash('');try{await request('/admin/staff',{token,method:'POST',body:{name:staffName,email:staffEmail,password:staffPassword,service_id:Number(staffService),counter_id:Number(staffCounter)}});setStaffName('');setStaffEmail('');setStaffPassword('');flash('Staff account created and assigned.');await refresh()}catch(err){flash(err.message)}finally{setLoading(false)}}}><h2><Users size={20}/> Create Staff Account</h2><label>Full name<input required minLength="2" value={staffName} onChange={e=>setStaffName(e.target.value)}/></label><label>Email<input required type="email" value={staffEmail} onChange={e=>setStaffEmail(e.target.value)}/></label><label>Initial password (12+ characters)<input required type="password" minLength="12" autoComplete="new-password" value={staffPassword} onChange={e=>setStaffPassword(e.target.value)}/></label><label>Department<select required value={staffService} onChange={e=>{setStaffService(e.target.value);setStaffCounter('')}}><option value="">Choose department</option>{services.filter(s=>s.is_active).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Counter<select required value={staffCounter} onChange={e=>setStaffCounter(e.target.value)}><option value="">Choose counter</option>{counters.filter(c=>c.is_active&&String(c.service_id)===String(staffService)).map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label><Button disabled={loading} className="btn primary wide">Create Staff & Assign</Button></form><section className="card"><h2><ShieldCheck size={20}/> Department security</h2><p className="muted">Staff can access only the assigned department and counter. Authorization is verified by the backend.</p><p className="helper">Use strong temporary passwords and have staff change them through a future password-change flow. Never share passwords or commit credentials.</p></section></div><section className="card" style={{marginTop:20}}><h2><ClipboardList size={20}/> Staff Accounts</h2><div className="table-scroll"><table><thead><tr><th>Staff</th><th>Email</th><th>Department</th><th>Counter</th><th>Account</th><th>Action</th></tr></thead><tbody>{staffList.map(u=><tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.service_name||'Unassigned'}</td><td>{u.counter_label||'—'}</td><td>{u.is_active?'Active':'Disabled'}</td><td><Button disabled={loading} className="btn outline" onClick={async()=>{setLoading(true);try{await request(`/admin/staff/${u.id}/status`,{token,method:'PATCH',body:{is_active:!Boolean(u.is_active)}});flash('Staff account status updated');await refresh()}catch(err){flash(err.message)}finally{setLoading(false)}}}>{u.is_active?'Disable':'Enable'}</Button></td></tr>)}</tbody></table></div></section></>}
 <Chatbot
  session={session}
  services={services}
  counters={counters}
  tokens={tokens}
  stats={stats}
/>

<footer className="main-footer">
  WaitLess • University Capstone Prototype
</footer></main></div>
}
function Kpi({icon,label,value}){return <div className="kpi"><div className="kpi-icon">{icon}</div><small>{label}</small><strong>{value}</strong></div>}
createRoot(document.getElementById('root')).render(<App/>);
