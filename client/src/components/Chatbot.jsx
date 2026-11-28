import React, { useEffect, useRef, useState } from 'react';
import { Bot, MessageCircle, Send, X } from 'lucide-react';
import './Chatbot.css';

const suggestions = {
  student: ['How to get a token?', 'My queue status', 'My waiting time', 'Available services'],
  staff: ['My department', 'My counter', 'Waiting queue', 'How to call next?'],
  admin: ['Available services', 'Queue summary', 'Manage staff', 'How to add a counter?'],
};

function say(question, { role, services, counters, tokens, stats }) {
  const q = question.toLowerCase().trim();
  const has = (...terms) => terms.some(term => q.includes(term));
  const serviceNames = (services || []).filter(s => s.is_active !== 0 && s.is_active !== false).map(s => s.name);
  const waiting = (tokens || []).filter(t => t.status === 'waiting');
  const active = (tokens || []).filter(t => ['waiting','called','serving'].includes(t.status));
  const myWaiting = (tokens || []).filter(t => t.status === 'waiting');

  if (has('hello', 'hi', 'hey', 'হ্যালো', 'হাই', 'সালাম'))
    return `Hello! I can help with ${role === 'student' ? 'your tokens and available university services' : role === 'staff' ? 'your assigned counter and queue' : 'service, staff and queue administration'}.`;
  if (has('thank', 'ধন্যবাদ')) return 'You are welcome! আরও কোনো সাহায্য লাগলে লিখুন।';
  if (has('token', 'টোকেন', 'টিকিট')) {
    if (role === 'student') {
      if (has('how', 'create', 'generate', 'নিব', 'নেব', 'কিভাবে', 'কীভাবে'))
        return 'Student Dashboard → Get a new token → Service নির্বাচন করুন → Generate Virtual Token চাপুন। একই Service-এ একাধিক Active Token নেওয়া যাবে না।';
      return active.length ? `Your active token(s): ${active.map(t => `${t.token_code} (${t.status}, ${t.service_name || 'Service'})`).join('; ')}.` : 'You have no active token right now. Generate one from your Student Dashboard.';
    }
    return 'Queue Management-এ আপনার অনুমোদিত টোকেনগুলো দেখা যায়। Student-এর Private Token Details অন্যের কাছে প্রকাশ করা উচিত নয়।';
  }
  if (has('wait', 'queue', 'line', 'status', 'অপেক্ষা', 'কিউ', 'সিরিয়াল', 'সিরিয়াল')) {
    if (role === 'student') {
      if (!active.length) return 'Your queue is currently empty. নতুন Token নিতে Student Dashboard ব্যবহার করুন।';
      return active.map(t => `${t.token_code}: ${t.status}; booking estimate: ${t.predicted_minutes ?? 'not available'} min (${t.prediction_source || 'source unknown'}). Estimates are not guaranteed.`).join('\n');
    }
    if (role === 'staff') return `Your assigned department has ${waiting.length} waiting token(s) currently loaded. Go to Queue Management to see the permitted list.`;
    return `Current loaded queue: ${waiting.length} waiting, ${(tokens||[]).filter(t => t.status === 'serving').length} serving, ${(tokens||[]).filter(t => t.status === 'completed').length} completed. These counts follow the dashboard API scope.`;
  }
  if (has('time', 'estimate', 'minute', 'কতক্ষণ', 'সময়', 'সময়')) {
    if (role !== 'student') return 'Waiting-time estimates shown in the dashboard are illustrative and have not yet been validated on real operating data.';
    return myWaiting.length ? myWaiting.map(t => `${t.token_code}: ≈ ${t.predicted_minutes ?? '—'} min at booking. This is an estimate, not a promise.`).join('\n') : 'You have no waiting token. Waiting time appears after a token is generated.';
  }
  if (has('department', 'counter', 'অফিস', 'ডিপার্টমেন্ট', 'কাউন্টার')) {
    if (role === 'staff') return counters?.length ? `Your permitted counter(s): ${counters.map(c => `${c.label} (${c.service_name || services.find(s => String(s.id) === String(c.service_id))?.name || 'Assigned service'})`).join(', ')}.` : 'No assigned counter is currently available. Contact the administrator.';
    return serviceNames.length ? `Available university services: ${serviceNames.join(', ')}.` : 'Service information is currently unavailable.';
  }
  if (has('service', 'registrar', 'advising', 'accounts', 'certificate', 'id card', 'সেবা', 'সার্ভিস'))
    return serviceNames.length ? `Available services: ${serviceNames.join(', ')}. Choose a service from the dashboard.` : 'Service information is currently unavailable.';
  if (role === 'staff' && has('call', 'next', 'পরবর্তী', 'ডাক')) return 'Dashboard → আপনার Assigned Counter নির্বাচন করুন → Call Next Token। অন্য Department-এর Counter ব্যবহার করা যাবে না।';
  if (role === 'admin' && has('staff', 'manage', 'assign', 'কর্মী')) return 'Admin Portal → Staff Management → Name, Email, Strong Temporary Password, Department এবং Counter দিন → Create Staff & Assign। প্রয়োজন হলে Disable/Enable ব্যবহার করুন।';
  if (role === 'admin' && has('add', 'new', 'যোগ')) return 'Admin Portal → Manage Services থেকে নতুন Service ও তার Counter যোগ করুন।';
  return 'I can help with tokens, queue status, waiting-time estimates, services and your role-specific dashboard. নিচের Suggested Question বেছে নিন। এটি একটি rule-based assistant, unrestricted generative AI নয়।';
}

export default function Chatbot({ session, services = [], counters = [], tokens = [], stats = {} }) {
  const role = session?.user?.role;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState([{ from: 'bot', text: 'Hi! 👋 I am WaitLess Smart Assistant. Ask me about your queue or university services.' }]);
  const endRef = useRef(null);
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, open]);
  useEffect(() => { setOpen(false); setDraft(''); setMessages([{from:'bot', text:'Hi! 👋 I am WaitLess Smart Assistant. How can I help?'}]); }, [session?.user?.id, role]);
  if (!session?.token || !['student','staff','admin'].includes(role)) return null;
  const submit = (raw) => {
    const text = String(raw || '').trim().slice(0, 400);
    if (!text) return;
    const response = say(text, { role, services, counters, tokens, stats });
    setMessages(m => [...m.slice(-30), { from: 'user', text }, { from: 'bot', text: response }]);
    setDraft('');
  };
  return <div className="wl-chat-root">
    {!open && <button type="button" className="wl-chat-fab" onClick={() => setOpen(true)} aria-label="Open WaitLess Smart Assistant"><MessageCircle size={25} /> <span>Ask WaitLess</span></button>}
    {open && <section className="wl-chat-window" role="dialog" aria-label="WaitLess Smart Assistant">
      <header className="wl-chat-header"><span className="wl-chat-title"><Bot size={22}/> WaitLess Smart Assistant</span><button type="button" aria-label="Close chat" onClick={() => setOpen(false)}><X size={20}/></button></header>
      <div className="wl-chat-transcript" aria-live="polite">{messages.map((m, i) => <div key={i} className={`wl-chat-message ${m.from}`}>{m.text}</div>)}<div ref={endRef}/></div>
      <div className="wl-chat-suggestions">{(suggestions[role] || []).map(x => <button type="button" key={x} onClick={() => submit(x)}>{x}</button>)}</div>
      <form className="wl-chat-form" onSubmit={e=>{e.preventDefault();submit(draft)}}><input aria-label="Message" maxLength={400} placeholder="Ask in বাংলা or English..." value={draft} onChange={e=>setDraft(e.target.value)}/><button type="submit" disabled={!draft.trim()} aria-label="Send message"><Send size={19}/></button></form>
      <p className="wl-chat-note">Rule-based • Uses your already authorized dashboard data • Not an emergency service</p>
    </section>}
  </div>;
}
