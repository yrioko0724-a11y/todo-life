import { useState, useEffect, useRef } from "react";
import { db, auth, googleProvider } from "./firebase";
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, query, orderBy, setDoc,
} from "firebase/firestore";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";

// ─── 定数 ─────────────────────────────────────────────────────────────────────
const DEFAULT_CATEGORIES = [
  { id: "仕事中",              label: "仕事中",         emoji: "💼", color: "#3B82F6", bg: "#EFF6FF" },
  { id: "家にいるとき",         label: "家にいるとき",   emoji: "🏠", color: "#10B981", bg: "#ECFDF5" },
  { id: "家族といるとき",       label: "家族といるとき", emoji: "👨‍👩‍👧", color: "#F59E0B", bg: "#FFFBEB" },
  { id: "ゴロゴロしているとき",  label: "ゴロゴロ中",    emoji: "🛋️", color: "#8B5CF6", bg: "#F5F3FF" },
  { id: "移動中",              label: "移動中",         emoji: "🚗", color: "#EF4444", bg: "#FEF2F2" },
  { id: "トイレ中",            label: "トイレ中",       emoji: "🚽", color: "#EC4899", bg: "#FDF2F8" },
  { id: "いつでもOK",          label: "いつでもOK",     emoji: "⭐", color: "#F59E0B", bg: "#FFFBEB" },
];

const COLOR_PRESETS = [
  { color: "#3B82F6", bg: "#EFF6FF" }, { color: "#10B981", bg: "#ECFDF5" },
  { color: "#F59E0B", bg: "#FFFBEB" }, { color: "#8B5CF6", bg: "#F5F3FF" },
  { color: "#EF4444", bg: "#FEF2F2" }, { color: "#EC4899", bg: "#FDF2F8" },
  { color: "#06B6D4", bg: "#ECFEFF" }, { color: "#84CC16", bg: "#F7FEE7" },
];

const REPEAT_OPTIONS = [
  { value: "none", label: "なし" }, { value: "daily", label: "毎日" },
  { value: "weekly", label: "毎週" }, { value: "monthly", label: "毎月" },
  { value: "yearly", label: "毎年" },
];

const REPEAT_LABELS = { daily: "毎日", weekly: "毎週", monthly: "毎月", yearly: "毎年" };
const CAT_EMOJIS = ["🌟", "🎯", "📚", "💪", "🎨", "🎵", "🌱", "💡", "🏆", "❤️", "🔥", "✨", "🧘", "🍜", "🏋️", "🎮"];

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};


// 繰り返しTODOの完了判定（日付ごとに独立）
const isTodoDone = (todo, date) => {
  if (todo.repeat && todo.repeat !== "none") {
    return (todo.completedDates || []).includes(date || today());
  }
  return !!todo.done;
};

// 繰り返しTODOが指定日に発生するか判定
const isOccurrenceDate = (todo, dateStr) => {
  if (!todo.deadline || !todo.repeat || todo.repeat === "none") return false;
  const start  = new Date(todo.deadline + "T00:00:00");
  const target = new Date(dateStr + "T00:00:00");
  if (target < start) return false;
  if (todo.repeat === "daily") return true;
  if (todo.repeat === "weekly") {
    const diff = Math.round((target - start) / 86400000);
    return diff % 7 === 0;
  }
  if (todo.repeat === "monthly") return target.getDate() === start.getDate();
  if (todo.repeat === "yearly")  return target.getMonth() === start.getMonth() && target.getDate() === start.getDate();
  return false;
};

// ─── Micro Components ─────────────────────────────────────────────────────────
const getCat = (id, cats) =>
  cats.find(c => c.id === id) || cats.find(c => c.id === "いつでもOK") || cats[cats.length - 1];

const CategoryBadge = ({ catId, categories, small }) => {
  const cat = getCat(catId, categories);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: cat.bg, color: cat.color,
      borderRadius: 20, padding: small ? "2px 8px" : "3px 10px",
      fontSize: small ? 11 : 12, fontWeight: 600, whiteSpace: "nowrap",
    }}>
      <span style={{ fontSize: small ? 10 : 12 }}>{cat.emoji}</span>
      {small ? "" : cat.label}
    </span>
  );
};

const RepeatBadge = ({ repeat }) => {
  if (!repeat || repeat === "none") return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 2,
      background: "#F5F3FF", color: "#7C3AED",
      borderRadius: 20, padding: "2px 7px", fontSize: 10, fontWeight: 600, whiteSpace: "nowrap",
    }}>🔁 {REPEAT_LABELS[repeat]}</span>
  );
};

const ProgressBar = ({ value, max }) => {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: "#6B7280", fontWeight: 500 }}>今日の進捗</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#059669" }}>{value}<span style={{ color: "#9CA3AF", fontWeight: 400 }}>/{max} 完了</span></span>
      </div>
      <div style={{ height: 8, borderRadius: 99, background: "#E5E7EB", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: "linear-gradient(90deg, #34D399, #059669)", transition: "width 0.8s cubic-bezier(.4,0,.2,1)" }} />
      </div>
    </div>
  );
};

// ─── VOICE BUTTON (再利用コンポーネント) ──────────────────────────────────────
const VoiceButton = ({ onResult }) => {
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);

  const toggle = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("このブラウザは音声入力に対応していません。Chromeをお試しください。"); return; }
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    const r = new SR();
    r.lang = "ja-JP"; r.continuous = false; r.interimResults = true;
    r.onresult = e => onResult(Array.from(e.results).map(x => x[0].transcript).join(""));
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recRef.current = r; r.start(); setListening(true);
  };

  return (
    <button onClick={toggle} type="button" style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      padding: "3px 9px", borderRadius: 99, border: "none", cursor: "pointer",
      background: listening ? "#7C3AED" : "#F5F3FF",
      color: listening ? "#fff" : "#7C3AED",
      fontSize: 11, fontWeight: 600, fontFamily: "inherit",
      animation: listening ? "pulse 1s infinite" : "none",
    }}>
      🎤 {listening ? "停止" : "音声"}
    </button>
  );
};

// ─── CATEGORY CREATOR MODAL ───────────────────────────────────────────────────
const CategoryCreatorModal = ({ onSave, onClose }) => {
  const [emoji, setEmoji] = useState("🌟");
  const [name, setName]   = useState("");
  const [ci, setCi]       = useState(0);

  const save = () => {
    if (!name.trim()) return;
    onSave({ id: `custom_${Date.now()}`, label: name.trim(), emoji, color: COLOR_PRESETS[ci].color, bg: COLOR_PRESETS[ci].bg, custom: true });
  };

  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-end", zIndex: 100 }} onClick={onClose}>
      <div style={{ width: "100%", background: "#fff", borderRadius: "22px 22px 0 0", padding: "24px 20px 40px", maxHeight: "80%", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>カテゴリを作成</h3>
          <button onClick={onClose} style={{ fontSize: 22, background: "none", border: "none", color: "#9CA3AF", cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8 }}>絵文字を選ぶ</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {CAT_EMOJIS.map(e => (
              <button key={e} onClick={() => setEmoji(e)} style={{ width: 38, height: 38, borderRadius: 10, fontSize: 18, border: `2px solid ${emoji === e ? "#059669" : "#E5E7EB"}`, background: emoji === e ? "#ECFDF5" : "#F9FAFB", cursor: "pointer" }}>{e}</button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8 }}>カテゴリ名</p>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="例）勉強中" maxLength={10} style={{ width: "100%", padding: "11px 14px", borderRadius: 12, border: "1.5px solid #E5E7EB", fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "inherit" }} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8 }}>カラー</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {COLOR_PRESETS.map((p, i) => (
              <button key={i} onClick={() => setCi(i)} style={{ width: 30, height: 30, borderRadius: 99, background: p.color, border: `3px solid ${ci === i ? "#111827" : "transparent"}`, cursor: "pointer", flexShrink: 0 }} />
            ))}
          </div>
        </div>
        {name.trim() && (
          <div style={{ marginBottom: 20, padding: "8px 14px", background: COLOR_PRESETS[ci].bg, borderRadius: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span>{emoji}</span><span style={{ fontSize: 13, fontWeight: 600, color: COLOR_PRESETS[ci].color }}>{name}</span>
          </div>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "14px", borderRadius: 12, border: "1.5px solid #E5E7EB", background: "#fff", fontSize: 14, fontWeight: 600, color: "#6B7280", cursor: "pointer", fontFamily: "inherit" }}>キャンセル</button>
          <button onClick={save} disabled={!name.trim()} style={{ flex: 1, padding: "14px", borderRadius: 12, border: "none", background: name.trim() ? "linear-gradient(135deg, #34D399, #059669)" : "#E5E7EB", fontSize: 14, fontWeight: 700, color: name.trim() ? "#fff" : "#9CA3AF", cursor: name.trim() ? "pointer" : "default", fontFamily: "inherit" }}>作成する</button>
        </div>
      </div>
    </div>
  );
};

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
const LoginScreen = ({ onLogin, loginLoading }) => (
  <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
    <div style={{ background: "linear-gradient(155deg, #34D399 0%, #059669 100%)", padding: "56px 32px 52px", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ width: 72, height: 72, borderRadius: 22, background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, marginBottom: 18, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>✅</div>
      <h1 style={{ fontSize: 30, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>TODO LIFE</h1>
      <p style={{ fontSize: 13, color: "#A7F3D0", marginTop: 10, textAlign: "center", lineHeight: 1.7 }}>やることを、目的に変えて、<br />人生を動かす。</p>
    </div>
    <div style={{ flex: 1, padding: "40px 28px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <p style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 6, textAlign: "center" }}>クラウドでデータを管理</p>
      <p style={{ fontSize: 13, color: "#9CA3AF", marginBottom: 36, textAlign: "center", lineHeight: 1.7 }}>ログインするとどのデバイスからでも<br />TODOにアクセスできます</p>
      <button onClick={onLogin} disabled={loginLoading} style={{ width: "100%", padding: "15px 20px", borderRadius: 14, border: "1.5px solid #E5E7EB", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, cursor: loginLoading ? "default" : "pointer", opacity: loginLoading ? 0.65 : 1, boxShadow: "0 2px 12px rgba(0,0,0,0.08)", fontSize: 15, fontWeight: 600, color: "#111827", fontFamily: "inherit" }}>
        <svg width="20" height="20" viewBox="0 0 48 48">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
        </svg>
        {loginLoading ? "ログイン中..." : "Google でログイン"}
      </button>
    </div>
  </div>
);

// ─── QUICK ADD WIDGET ─────────────────────────────────────────────────────────
const QuickAddWidget = ({ onAdd }) => {
  const [text, setText]         = useState("");
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);

  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("このブラウザは音声入力に対応していません"); return; }
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    const r = new SR();
    r.lang = "ja-JP"; r.continuous = false; r.interimResults = true;
    r.onresult = e => setText(Array.from(e.results).map(x => x[0].transcript).join(""));
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recRef.current = r; r.start(); setListening(true);
  };

  const submit = () => {
    if (!text.trim()) return;
    onAdd(text.trim());
    setText("");
  };

  return (
    <div style={{ marginTop: 16, padding: "14px 16px", background: "#fff", borderRadius: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: "#059669", marginBottom: 10, letterSpacing: 0.3 }}>⚡ クイック追加</p>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          placeholder={listening ? "聞いています..." : "やることをサッと追加..."}
          style={{
            flex: 1, padding: "10px 12px", borderRadius: 10, fontFamily: "inherit",
            border: listening ? "1.5px solid #7C3AED" : "1.5px solid #E5E7EB",
            background: listening ? "#FAF5FF" : "#F9FAFB",
            fontSize: 14, outline: "none",
          }}
        />
        <button onClick={startVoice} style={{
          width: 38, height: 38, borderRadius: 10, border: "none", cursor: "pointer", flexShrink: 0,
          background: listening ? "#7C3AED" : "#F5F3FF",
          fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center",
          animation: listening ? "pulse 1s infinite" : "none",
        }}>🎤</button>
        <button onClick={submit} disabled={!text.trim()} style={{
          width: 38, height: 38, borderRadius: 10, border: "none", flexShrink: 0,
          cursor: text.trim() ? "pointer" : "default",
          background: text.trim() ? "linear-gradient(135deg, #34D399, #059669)" : "#E5E7EB",
          fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff",
          boxShadow: text.trim() ? "0 2px 8px rgba(5,150,105,0.3)" : "none",
        }}>＋</button>
      </div>
    </div>
  );
};

// ─── HOME SCREEN ──────────────────────────────────────────────────────────────
const HomeScreen = ({ todos, setScreen, setEditTodo, onToggle, categories, onQuickAdd }) => {
  const todayTodos = todos.filter(t => !isTodoDone(t));
  const doneTodos  = todos.filter(t => isTodoDone(t));
  const greetings = ["おはようございます！今日も一緒にがんばりましょう 🌿", "こんにちは！今日のTODOを確認しましょう ✨", "お疲れ様です！残りのTODOを片付けましょう 🌙"];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? greetings[0] : hour < 18 ? greetings[1] : greetings[2];

  return (
    <div style={{ flex: 1, overflowY: "auto", paddingBottom: 100 }}>
      <div style={{ padding: "20px 20px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#111827", letterSpacing: -0.5 }}>TODO LIFE</h1>
            <p style={{ fontSize: 13, color: "#6B7280", marginTop: 2 }}>{new Date().toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" })}</p>
          </div>
          <button onClick={() => setScreen("settings")} style={{ width: 38, height: 38, borderRadius: 12, background: "#F3F4F6", border: "none", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>⚙️</button>
        </div>
        <div style={{ marginTop: 14, padding: "14px 16px", background: "linear-gradient(135deg, #ECFDF5, #D1FAE5)", borderRadius: 16 }}>
          <p style={{ fontSize: 13, color: "#065F46", fontWeight: 500 }}>{greeting}</p>
        </div>
        <div style={{ marginTop: 16 }}>
          <ProgressBar value={doneTodos.length} max={todos.length} />
        </div>
        <QuickAddWidget onAdd={onQuickAdd} />
      </div>

      <div style={{ padding: "20px 20px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>今日のおすすめTODO</h2>
          <button onClick={() => setScreen("situation")} style={{ fontSize: 12, color: "#059669", fontWeight: 600, border: "none", cursor: "pointer", padding: "4px 10px", borderRadius: 20, background: "#ECFDF5" }}>状況を選ぶ →</button>
        </div>
        {todayTodos.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: "#9CA3AF" }}>
            <div style={{ fontSize: 40 }}>🎉</div>
            <p style={{ fontSize: 14, marginTop: 8, fontWeight: 500 }}>全て完了しました！</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {todayTodos.slice(0, 5).map((todo, i) => {
              const cat = getCat(todo.category, categories);
              return (
                <div key={todo.id} onClick={() => { setEditTodo(todo); setScreen("detail"); }} style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 16, padding: "14px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)", animation: `fadeUp 0.3s ease ${i * 0.05}s both`, cursor: "pointer" }}>
                  <button onClick={e => { e.stopPropagation(); onToggle(todo.id); }} style={{ width: 26, height: 26, borderRadius: 99, border: `2px solid ${cat.color}`, background: "transparent", cursor: "pointer", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{todo.title}</p>
                    <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                      <CategoryBadge catId={todo.category} categories={categories} small />
                      <RepeatBadge repeat={todo.repeat} />
                      {todo.subtasks?.length > 0 && (
                        <span style={{ fontSize: 11, color: "#059669", fontWeight: 600, background: "#ECFDF5", borderRadius: 20, padding: "2px 7px" }}>
                          {todo.subtasks.filter(s => s.done).length}/{todo.subtasks.length}
                        </span>
                      )}
                    </div>
                    {todo.subtasks?.length > 0 && (
                      <div style={{ marginTop: 6, height: 3, borderRadius: 99, background: "#E5E7EB", overflow: "hidden" }}>
                        <div style={{ width: `${(todo.subtasks.filter(s => s.done).length / todo.subtasks.length) * 100}%`, height: "100%", background: "linear-gradient(90deg,#34D399,#059669)" }} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ padding: "24px 20px 0" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 12 }}>カテゴリ別</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {categories.map(cat => {
            const count = todos.filter(t => !t.done && t.category === cat.id).length;
            return (
              <button key={cat.id} onClick={() => setScreen("list")} style={{ background: cat.bg, border: "none", borderRadius: 14, padding: "12px 8px", cursor: "pointer", textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                <div style={{ fontSize: 22 }}>{cat.emoji}</div>
                <div style={{ fontSize: 10, color: cat.color, fontWeight: 700, marginTop: 4, lineHeight: 1.2 }}>{cat.label}</div>
                {count > 0 && <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>{count}件</div>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ─── ADD/EDIT SCREEN ──────────────────────────────────────────────────────────
const AddScreen = ({ setScreen, editTodo, onSave, onAddExtra, categories, openCatModal }) => {
  const isEdit = !!editTodo;
  const [title,    setTitle]    = useState(editTodo?.title    || "");
  const [deadline, setDeadline] = useState(editTodo?.deadline || "");
  const [category, setCategory] = useState(editTodo?.category || "いつでもOK");
  const [memo,     setMemo]     = useState(editTodo?.memo     || "");
  const [repeat,   setRepeat]   = useState(editTodo?.repeat   || "none");
  const [subtasks, setSubtasks] = useState(editTodo?.subtasks || []);

  // カメラスキャン状態: idle | preview | scanning | result
  const [scanPhase,    setScanPhase]    = useState("idle");
  const [scanProgress, setScanProgress] = useState(0);
  const [previewUrl,   setPreviewUrl]   = useState(null);
  const [previewFile,  setPreviewFile]  = useState(null);
  const [dragStart,    setDragStart]    = useState(null); // {x,y} in preview coords
  const [dragEnd,      setDragEnd]      = useState(null);
  const [scanLines,    setScanLines]    = useState([]);   // [{text, checked}]

  const cameraRef  = useRef(null);
  const photoRef   = useRef(null);
  const imgRef     = useRef(null);
  const previewRef = useRef(null);
  const isDragging = useRef(false);

  const save = () => {
    if (!title.trim()) return;
    onSave({ title, deadline, category, memo, repeat, subtasks }, isEdit ? editTodo.id : null);
    setScreen("home");
  };

  // passive:false が必要なタッチ操作をuseEffectで登録
  useEffect(() => {
    const el = previewRef.current;
    if (!el || scanPhase !== "preview") return;
    const getPos = (cx, cy) => {
      const r = el.getBoundingClientRect();
      return { x: Math.max(0, Math.min(cx - r.left, r.width)), y: Math.max(0, Math.min(cy - r.top, r.height)) };
    };
    const onStart = (e) => { e.preventDefault(); const t = e.touches[0]; setDragStart(getPos(t.clientX, t.clientY)); setDragEnd(null); isDragging.current = true; };
    const onMove  = (e) => { e.preventDefault(); if (!isDragging.current) return; const t = e.touches[0]; setDragEnd(getPos(t.clientX, t.clientY)); };
    const onEnd   = (e) => { e.preventDefault(); isDragging.current = false; };
    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove",  onMove,  { passive: false });
    el.addEventListener("touchend",   onEnd,   { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove",  onMove);
      el.removeEventListener("touchend",   onEnd);
    };
  }, [scanPhase]);

  // 画像をリサイズ・JPEG圧縮してbase64を返す
  const compressImage = (file, maxPx = 1024, quality = 0.7) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", quality).split(",")[1]);
      };
      img.onerror = reject;
      img.src = url;
    });

  // Google Cloud Vision API呼び出し（共通）
  const callVisionAPI = async (base64) => {
    const apiKey = process.env.REACT_APP_GOOGLE_VISION_API_KEY;
    if (!apiKey) throw new Error("APIキーが未設定です");
    const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requests: [{ image: { content: base64 }, features: [{ type: "DOCUMENT_TEXT_DETECTION" }], imageContext: { languageHints: ["ja", "en"] } }] }),
    });
    if (!res.ok) {
      const err = await res.json(); const code = res.status;
      if (code === 400) throw new Error("画像形式が正しくありません");
      if (code === 403) throw new Error("APIキーが無効またはVision APIが未有効化です");
      if (code === 429) throw new Error("使用制限に達しました。しばらく後に再試行してください");
      throw new Error(err.error?.message || `APIエラー (${code})`);
    }
    const data = await res.json();
    return data.responses?.[0]?.fullTextAnnotation?.text || data.responses?.[0]?.textAnnotations?.[0]?.description || "";
  };

  const textToLines = (text) =>
    text.trim().split("\n").map(l => l.trim()).filter(Boolean).map(t => ({ text: t, checked: true }));

  const closeScan = () => {
    setScanPhase("idle");
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
    setPreviewFile(null); setDragStart(null); setDragEnd(null);
  };

  // ファイル選択（カメラ・写真ライブラリ共通）
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    if (files.length > 1) { handleMultipleFiles(files); return; }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(files[0]));
    setPreviewFile(files[0]);
    setDragStart(null); setDragEnd(null);
    setScanPhase("preview");
  };

  // 全体スキャン（プレビューから）
  const handleScanFull = async () => {
    setScanPhase("scanning"); setScanProgress(10);
    try {
      const base64 = await compressImage(previewFile); setScanProgress(50);
      const text = await callVisionAPI(base64); setScanProgress(90);
      if (!text.trim()) throw new Error("文字が検出できませんでした。明るい場所で撮影してください");
      setScanLines(textToLines(text)); setScanPhase("result"); setScanProgress(100);
    } catch (err) { setScanPhase("preview"); alert(`スキャン失敗: ${err.message}`); }
  };

  // 範囲選択スキャン
  const handleScanSelection = async () => {
    if (!dragStart || !dragEnd || !imgRef.current) return handleScanFull();
    const img = imgRef.current;
    const x1 = Math.min(dragStart.x, dragEnd.x), y1 = Math.min(dragStart.y, dragEnd.y);
    const w  = Math.abs(dragEnd.x - dragStart.x), h  = Math.abs(dragEnd.y - dragStart.y);
    if (w < 10 || h < 10) return handleScanFull();
    setScanPhase("scanning"); setScanProgress(10);
    try {
      const sx = img.naturalWidth / img.offsetWidth, sy = img.naturalHeight / img.offsetHeight;
      const c1 = document.createElement("canvas");
      c1.width = Math.round(w * sx); c1.height = Math.round(h * sy);
      c1.getContext("2d").drawImage(img, Math.round(x1*sx), Math.round(y1*sy), c1.width, c1.height, 0, 0, c1.width, c1.height);
      const sc = Math.min(1, 1024 / Math.max(c1.width, c1.height));
      const c2 = document.createElement("canvas");
      c2.width = Math.round(c1.width * sc); c2.height = Math.round(c1.height * sc);
      c2.getContext("2d").drawImage(c1, 0, 0, c2.width, c2.height);
      const base64 = c2.toDataURL("image/jpeg", 0.8).split(",")[1];
      setScanProgress(50);
      const text = await callVisionAPI(base64); setScanProgress(90);
      if (!text.trim()) throw new Error("選択範囲に文字が検出できませんでした");
      setScanLines(textToLines(text)); setScanPhase("result"); setScanProgress(100);
    } catch (err) { setScanPhase("preview"); alert(`スキャン失敗: ${err.message}`); }
  };

  // 複数ファイル一括スキャン
  const handleMultipleFiles = async (files) => {
    setScanPhase("scanning"); setScanProgress(0);
    try {
      const allLines = [];
      for (let i = 0; i < files.length; i++) {
        setScanProgress(Math.round((i / files.length) * 80));
        const base64 = await compressImage(files[i]);
        const text   = await callVisionAPI(base64);
        text.trim().split("\n").map(l => l.trim()).filter(Boolean).forEach(t => allLines.push(t));
      }
      if (allLines.length === 0) throw new Error("文字が検出できませんでした");
      setScanLines(allLines.map(t => ({ text: t, checked: true }))); setScanPhase("result"); setScanProgress(100);
    } catch (err) { setScanPhase("idle"); alert(`スキャン失敗: ${err.message}`); }
  };

  // 選択行の最初をタイトルに適用
  const applyFirstLine = () => {
    const line = scanLines.find(l => l.checked);
    if (line) setTitle(line.text);
    closeScan();
  };

  // 選択行を全てTODOとして追加
  const addAllSelected = async () => {
    const selected = scanLines.filter(l => l.checked && l.text.trim());
    if (selected.length === 0) return;
    for (const line of selected) await onAddExtra(line.text);
    closeScan();
    setScreen("list");
  };

  const inputStyle = {
    width: "100%", padding: "12px 14px", borderRadius: 12, border: "1.5px solid #E5E7EB",
    fontSize: 14, color: "#111827", background: "#FAFAFA", outline: "none",
    boxSizing: "border-box", fontFamily: "inherit",
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", paddingBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "20px 20px 16px", gap: 12 }}>
        <button onClick={() => setScreen("home")} style={{ fontSize: 22, color: "#6B7280", background: "none", border: "none", cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>‹</button>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>{isEdit ? "TODO を編集" : "新しい TODO"}</h2>
      </div>

      <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ── プレビュー & 範囲選択 ── */}
        {scanPhase === "preview" && (() => {
          const hasSel = dragStart && dragEnd && Math.abs(dragEnd.x - dragStart.x) > 10 && Math.abs(dragEnd.y - dragStart.y) > 10;
          const x1 = hasSel ? Math.min(dragStart.x, dragEnd.x) : 0;
          const y1 = hasSel ? Math.min(dragStart.y, dragEnd.y) : 0;
          const x2 = hasSel ? Math.max(dragStart.x, dragEnd.x) : 0;
          const y2 = hasSel ? Math.max(dragStart.y, dragEnd.y) : 0;
          return (
            <div style={{ borderRadius: 12, border: "1.5px solid #E5E7EB", overflow: "hidden", background: "#000" }}>
              <div
                ref={previewRef}
                style={{ position: "relative", userSelect: "none", cursor: "crosshair" }}
                onMouseDown={e => { const r = e.currentTarget.getBoundingClientRect(); setDragStart({ x: e.clientX - r.left, y: e.clientY - r.top }); setDragEnd(null); isDragging.current = true; }}
                onMouseMove={e => { if (!isDragging.current) return; const r = e.currentTarget.getBoundingClientRect(); setDragEnd({ x: Math.max(0, Math.min(e.clientX - r.left, r.width)), y: Math.max(0, Math.min(e.clientY - r.top, r.height)) }); }}
                onMouseUp={() => { isDragging.current = false; }}
              >
                <img ref={imgRef} src={previewUrl} alt="" style={{ width: "100%", display: "block" }} />
                {hasSel && (
                  <>
                    <div style={{ position: "absolute", left: 0, top: 0, right: 0, height: y1, background: "rgba(0,0,0,0.5)", pointerEvents: "none" }} />
                    <div style={{ position: "absolute", left: 0, top: y2, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", pointerEvents: "none" }} />
                    <div style={{ position: "absolute", left: 0, top: y1, width: x1, height: y2 - y1, background: "rgba(0,0,0,0.5)", pointerEvents: "none" }} />
                    <div style={{ position: "absolute", left: x2, top: y1, right: 0, height: y2 - y1, background: "rgba(0,0,0,0.5)", pointerEvents: "none" }} />
                    <div style={{ position: "absolute", left: x1, top: y1, width: x2 - x1, height: y2 - y1, border: "2px solid #34D399", boxSizing: "border-box", pointerEvents: "none" }}>
                      {[{ left: -4, top: -4 }, { right: -4, top: -4 }, { left: -4, bottom: -4 }, { right: -4, bottom: -4 }].map((s, i) => (
                        <div key={i} style={{ position: "absolute", width: 8, height: 8, background: "#059669", borderRadius: 2, ...s }} />
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div style={{ padding: "12px 14px", background: "#fff", display: "flex", flexDirection: "column", gap: 8 }}>
                <p style={{ fontSize: 12, color: "#6B7280" }}>
                  {hasSel ? "✅ 範囲を選択しました。スキャンしてください" : "📌 ドラッグして読み取りたい範囲を選択（省略可）"}
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={hasSel ? handleScanSelection : handleScanFull} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#34D399,#059669)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                    {hasSel ? "選択範囲をスキャン" : "全体をスキャン"}
                  </button>
                  <button onClick={closeScan} style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #E5E7EB", background: "#fff", color: "#6B7280", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>キャンセル</button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── スキャン中 ── */}
        {scanPhase === "scanning" && (
          <div style={{ padding: "14px", background: "#F9FAFB", borderRadius: 12, border: "1.5px solid #E5E7EB" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 18, height: 18, borderRadius: 99, border: "2.5px solid #E5E7EB", borderTopColor: "#059669", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />
              <p style={{ fontSize: 13, color: "#374151", fontWeight: 600 }}>
                {scanProgress < 40 ? "📸 画像を圧縮中..." : scanProgress < 80 ? "🌐 APIに送信中..." : "🔍 テキストを認識中..."}
              </p>
            </div>
            <div style={{ height: 6, background: "#E5E7EB", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ width: `${scanProgress}%`, height: "100%", background: "linear-gradient(90deg,#34D399,#059669)", transition: "width 0.4s ease" }} />
            </div>
            <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 6 }}>{scanProgress}% 完了</p>
          </div>
        )}

        {/* ── スキャン結果（行ごとにチェックボックス）── */}
        {scanPhase === "result" && (
          <div style={{ padding: "14px", background: "#F9FAFB", borderRadius: 12, border: "1.5px solid #E5E7EB" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>
                📋 {scanLines.filter(l => l.checked).length}/{scanLines.length}行を選択中
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setScanLines(ls => ls.map(l => ({ ...l, checked: true  })))} style={{ fontSize: 11, color: "#059669", fontWeight: 700, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>全選択</button>
                <button onClick={() => setScanLines(ls => ls.map(l => ({ ...l, checked: false })))} style={{ fontSize: 11, color: "#9CA3AF", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>全解除</button>
              </div>
            </div>
            <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
              {scanLines.map((line, i) => (
                <label key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 10px", background: line.checked ? "#ECFDF5" : "#fff", borderRadius: 8, border: `1px solid ${line.checked ? "#A7F3D0" : "#E5E7EB"}`, cursor: "pointer" }}>
                  <input type="checkbox" checked={line.checked} onChange={ev => setScanLines(ls => ls.map((l, j) => j === i ? { ...l, checked: ev.target.checked } : l))} style={{ marginTop: 2, accentColor: "#059669", flexShrink: 0, width: 15, height: 15 }} />
                  <span style={{ fontSize: 13, color: "#111827", lineHeight: 1.5, wordBreak: "break-all" }}>{line.text}</span>
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={applyFirstLine} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: "#059669", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>タイトルに適用</button>
              <button onClick={addAllSelected} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1.5px solid #059669", background: "#fff", color: "#059669", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>まとめて追加</button>
            </div>
            <button onClick={closeScan} style={{ width: "100%", marginTop: 8, padding: "8px", borderRadius: 10, border: "1.5px solid #E5E7EB", background: "#fff", color: "#9CA3AF", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>閉じる</button>
          </div>
        )}

        {/* やること */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>やること *</label>
            <div style={{ display: "flex", gap: 6 }}>
              <VoiceButton onResult={setTitle} />
              <button onClick={() => cameraRef.current?.click()} type="button" style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "3px 9px", borderRadius: 99, border: "none", cursor: "pointer", background: "#FFF7ED", color: "#C2410C", fontSize: 11, fontWeight: 600, fontFamily: "inherit" }}>📷 撮影</button>
              <button onClick={() => photoRef.current?.click()} type="button" style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "3px 9px", borderRadius: 99, border: "none", cursor: "pointer", background: "#F0FDF4", color: "#166534", fontSize: 11, fontWeight: 600, fontFamily: "inherit" }}>🖼️ 選択</button>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFileSelect} style={{ display: "none" }} />
              <input ref={photoRef} type="file" accept="image/*" multiple onChange={handleFileSelect} style={{ display: "none" }} />
            </div>
          </div>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="例）本を読む" style={inputStyle} />
        </div>

        {/* サブタスク */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 8 }}>
            サブタスク <span style={{ fontWeight: 400, color: "#9CA3AF" }}>（任意）</span>
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {subtasks.map((st, i) => (
              <div key={st.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  value={st.text}
                  onChange={e => setSubtasks(prev => prev.map((s, j) => j === i ? { ...s, text: e.target.value } : s))}
                  placeholder={`サブタスク ${i + 1}`}
                  style={inputStyle}
                />
                <button type="button" onClick={() => setSubtasks(prev => prev.filter((_, j) => j !== i))} style={{ width: 34, height: 34, borderRadius: 8, border: "1.5px solid #FCA5A5", background: "#FEF2F2", color: "#EF4444", fontSize: 18, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
              </div>
            ))}
            <button type="button" onClick={() => setSubtasks(prev => [...prev, { id: `st_${Date.now()}`, text: "", done: false }])} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 14px", borderRadius: 10, border: "1.5px dashed #A7F3D0", background: "#F0FDF4", color: "#059669", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              ＋ サブタスクを追加
            </button>
          </div>
        </div>

        {/* 繰り返し */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 8 }}>繰り返し</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {REPEAT_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => setRepeat(opt.value)} style={{ padding: "7px 14px", borderRadius: 20, border: `2px solid ${repeat === opt.value ? "#7C3AED" : "#E5E7EB"}`, background: repeat === opt.value ? "#F5F3FF" : "#fff", color: repeat === opt.value ? "#7C3AED" : "#6B7280", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}>
                {repeat === opt.value && opt.value !== "none" ? `🔁 ${opt.label}` : opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* いつまでに */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>いつまでに？ <span style={{ fontWeight: 400, color: "#9CA3AF" }}>（任意）</span></label>
          <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} style={inputStyle} min={today()} />
        </div>

        {/* カテゴリ */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 8 }}>どんなときにできる？</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setCategory(cat.id)} style={{ padding: "10px 12px", borderRadius: 12, border: `2px solid ${category === cat.id ? cat.color : "#E5E7EB"}`, background: category === cat.id ? cat.bg : "#fff", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", transition: "all 0.15s" }}>
                <span style={{ fontSize: 16 }}>{cat.emoji}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: category === cat.id ? cat.color : "#6B7280" }}>{cat.label}</span>
              </button>
            ))}
            <button onClick={() => openCatModal(cat => setCategory(cat.id))} style={{ padding: "10px 12px", borderRadius: 12, border: "2px dashed #E5E7EB", background: "#F9FAFB", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <span style={{ fontSize: 16 }}>＋</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#9CA3AF" }}>カテゴリを追加</span>
            </button>
          </div>
        </div>

        {/* メモ */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>メモ <span style={{ fontWeight: 400, color: "#9CA3AF" }}>（任意）</span></label>
            <VoiceButton onResult={t => setMemo(prev => prev ? prev + " " + t : t)} />
          </div>
          <textarea value={memo} onChange={e => setMemo(e.target.value)} placeholder="メモを入力" rows={3} style={{ ...inputStyle, resize: "none", lineHeight: 1.6 }} />
        </div>

        <button onClick={save} disabled={!title.trim()} style={{ width: "100%", padding: "16px", borderRadius: 14, border: "none", background: title.trim() ? "linear-gradient(135deg, #34D399, #059669)" : "#E5E7EB", color: title.trim() ? "#fff" : "#9CA3AF", fontSize: 16, fontWeight: 700, cursor: title.trim() ? "pointer" : "default", boxShadow: title.trim() ? "0 4px 14px rgba(5,150,105,0.3)" : "none", fontFamily: "inherit", transition: "all 0.2s" }}>
          {isEdit ? "変更を保存する" : "TODOを追加する"}
        </button>
      </div>
    </div>
  );
};

// ─── SITUATION SCREEN ─────────────────────────────────────────────────────────
const SituationScreen = ({ setScreen, setSituation, categories }) => (
  <div style={{ flex: 1, overflowY: "auto", paddingBottom: 40 }}>
    <div style={{ padding: "24px 20px 0" }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: "#111827", textAlign: "center" }}>今、なにをしていますか？</h2>
      <p style={{ fontSize: 13, color: "#9CA3AF", textAlign: "center", marginTop: 8 }}>あなたの状況に合ったTODOをおすすめします！</p>
    </div>
    <div style={{ padding: "20px 20px 0", display: "flex", flexDirection: "column", gap: 10 }}>
      {categories.map((cat, i) => (
        <button key={cat.id} onClick={() => { setSituation(cat.id); setScreen("recommend"); }} style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", borderRadius: 16, border: "none", background: "#fff", cursor: "pointer", textAlign: "left", boxShadow: "0 1px 4px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)", animation: `fadeUp 0.3s ease ${i * 0.04}s both` }}>
          <span style={{ fontSize: 28, width: 40, textAlign: "center" }}>{cat.emoji}</span>
          <span style={{ fontSize: 16, fontWeight: 600, color: "#111827" }}>{cat.label}</span>
          <span style={{ marginLeft: "auto", color: "#D1D5DB", fontSize: 18 }}>›</span>
        </button>
      ))}
    </div>
  </div>
);

// ─── RECOMMEND SCREEN ─────────────────────────────────────────────────────────
const RecommendScreen = ({ todos, situation, setScreen, setEditTodo, onToggle, categories }) => {
  const cat  = getCat(situation, categories);
  const recs = todos.filter(t => !t.done && t.category === situation);
  return (
    <div style={{ flex: 1, overflowY: "auto", paddingBottom: 40 }}>
      <div style={{ padding: "20px 20px 0" }}>
        <button onClick={() => setScreen("situation")} style={{ fontSize: 13, color: "#6B7280", background: "none", border: "none", cursor: "pointer", marginBottom: 16, fontFamily: "inherit" }}>← 戻る</button>
        <div style={{ padding: "20px", background: cat.bg, borderRadius: 20, textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 40 }}>{cat.emoji}</div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: cat.color, marginTop: 8 }}>{cat.label}におすすめのTODO</h2>
        </div>
        {recs.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: "#9CA3AF" }}>
            <div style={{ fontSize: 40 }}>📭</div>
            <p style={{ fontSize: 14, marginTop: 8 }}>このカテゴリにTODOはありません</p>
            <button onClick={() => setScreen("add")} style={{ marginTop: 16, padding: "10px 20px", borderRadius: 12, background: cat.color, color: "#fff", border: "none", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>TODOを追加する</button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {recs.map((todo, i) => (
              <div key={todo.id} onClick={() => { setEditTodo(todo); setScreen("detail"); }} style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 16, padding: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)", animation: `fadeUp 0.3s ease ${i * 0.05}s both`, cursor: "pointer" }}>
                <button onClick={e => { e.stopPropagation(); onToggle(todo.id); }} style={{ width: 26, height: 26, borderRadius: 99, border: `2px solid ${cat.color}`, background: "transparent", cursor: "pointer", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 15, fontWeight: 600, color: "#111827" }}>{todo.title}</p>
                  <RepeatBadge repeat={todo.repeat} />
                </div>
                <span style={{ color: "#D1D5DB", fontSize: 18 }}>›</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── LIST SCREEN ──────────────────────────────────────────────────────────────
const ListScreen = ({ todos, setScreen, setEditTodo, onToggle, onDelete, categories }) => {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const filtered = todos
    .filter(t => filter === "all" ? true : filter === "done" ? isTodoDone(t) : !isTodoDone(t))
    .filter(t => t.title.includes(search));

  return (
    <div style={{ flex: 1, overflowY: "auto", paddingBottom: 100 }}>
      <div style={{ padding: "20px 20px 0" }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginBottom: 14 }}>すべてのTODO</h2>
        <div style={{ position: "relative", marginBottom: 12 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: "#9CA3AF" }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="検索..." style={{ width: "100%", padding: "10px 14px 10px 36px", borderRadius: 12, border: "1.5px solid #E5E7EB", fontSize: 14, background: "#FAFAFA", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }} />
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {[["all", "すべて"], ["undone", "未完了"], ["done", "完了"]].map(([val, label]) => (
            <button key={val} onClick={() => setFilter(val)} style={{ padding: "6px 16px", borderRadius: 20, border: "none", cursor: "pointer", background: filter === val ? "#059669" : "#F3F4F6", color: filter === val ? "#fff" : "#6B7280", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>{label}</button>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: "32px 0", color: "#9CA3AF" }}>
              <div style={{ fontSize: 36 }}>📭</div>
              <p style={{ fontSize: 14, marginTop: 8 }}>TODOが見つかりません</p>
            </div>
          )}
          {filtered.map((todo, i) => {
            const cat = getCat(todo.category, categories);
            return (
              <div key={todo.id} onClick={() => { setEditTodo(todo); setScreen("detail"); }} style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 14, padding: "14px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", opacity: isTodoDone(todo) ? 0.6 : 1, animation: `fadeUp 0.3s ease ${i * 0.03}s both`, cursor: "pointer" }}>
                <button onClick={e => { e.stopPropagation(); onToggle(todo.id); }} style={{ width: 24, height: 24, borderRadius: 99, border: `2px solid ${isTodoDone(todo) ? "#10B981" : cat.color}`, background: isTodoDone(todo) ? "#10B981" : "transparent", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700 }}>{isTodoDone(todo) ? "✓" : ""}</button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "#111827", textDecoration: isTodoDone(todo) ? "line-through" : "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{todo.title}</p>
                  <div style={{ display: "flex", gap: 4, marginTop: 4, alignItems: "center" }}>
                    <CategoryBadge catId={todo.category} categories={categories} small />
                    <RepeatBadge repeat={todo.repeat} />
                    {todo.subtasks?.length > 0 && (
                      <span style={{ fontSize: 11, color: "#059669", fontWeight: 600, background: "#ECFDF5", borderRadius: 20, padding: "2px 7px" }}>
                        {todo.subtasks.filter(s => s.done).length}/{todo.subtasks.length}
                      </span>
                    )}
                  </div>
                  {todo.subtasks?.length > 0 && (
                    <div style={{ marginTop: 6, height: 3, borderRadius: 99, background: "#E5E7EB", overflow: "hidden" }}>
                      <div style={{ width: `${(todo.subtasks.filter(s => s.done).length / todo.subtasks.length) * 100}%`, height: "100%", background: "linear-gradient(90deg,#34D399,#059669)" }} />
                    </div>
                  )}
                </div>
                <button onClick={e => { e.stopPropagation(); onDelete(todo.id); }} style={{ background: "none", border: "none", color: "#E5E7EB", fontSize: 18, cursor: "pointer", padding: "4px 6px" }}>×</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ─── DETAIL SCREEN ────────────────────────────────────────────────────────────
const DetailScreen = ({ todo, setScreen, setEditTodo, onToggle, onSubtaskToggle, categories }) => {
  const [subtasks, setSubtasks] = useState(todo?.subtasks || []);
  if (!todo) { setScreen("list"); return null; }
  const occDate  = todo.occurrenceDate || null;
  const isDone   = isTodoDone(todo, occDate);
  const doneCount = subtasks.filter(s => s.done).length;

  const handleSubtask = (stId) => {
    setSubtasks(prev => prev.map(s => s.id === stId ? { ...s, done: !s.done } : s));
    onSubtaskToggle(todo.id, stId);
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", paddingBottom: 40 }}>
      <div style={{ padding: "20px 20px 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <button onClick={() => setScreen("list")} style={{ fontSize: 13, color: "#6B7280", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>← 戻る</button>
          <button onClick={() => { setEditTodo(todo); setScreen("add"); }} style={{ fontSize: 13, color: "#059669", background: "none", border: "none", cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}>編集</button>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <CategoryBadge catId={todo.category} categories={categories} />
          <RepeatBadge repeat={todo.repeat} />
          {occDate && <span style={{ fontSize: 11, color: "#6B7280", background: "#F3F4F6", borderRadius: 20, padding: "2px 8px" }}>📅 {occDate}</span>}
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#111827", lineHeight: 1.3 }}>{todo.title}</h1>
        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          {subtasks.length > 0 && (
            <div style={{ padding: "16px", background: "#fff", borderRadius: 14, border: "1.5px solid #E5E7EB" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <p style={{ fontSize: 12, color: "#374151", fontWeight: 600 }}>📋 サブタスク</p>
                <span style={{ fontSize: 12, color: "#059669", fontWeight: 700 }}>{doneCount}/{subtasks.length}</span>
              </div>
              <div style={{ height: 4, borderRadius: 99, background: "#E5E7EB", marginBottom: 12, overflow: "hidden" }}>
                <div style={{ width: `${subtasks.length === 0 ? 0 : (doneCount / subtasks.length) * 100}%`, height: "100%", background: "linear-gradient(90deg,#34D399,#059669)", transition: "width 0.4s ease" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {subtasks.map(st => (
                  <label key={st.id} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <div onClick={() => handleSubtask(st.id)} style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${st.done ? "#059669" : "#D1D5DB"}`, background: st.done ? "#059669" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer" }}>
                      {st.done && <span style={{ fontSize: 11, color: "#fff", fontWeight: 700 }}>✓</span>}
                    </div>
                    <span style={{ fontSize: 14, color: st.done ? "#9CA3AF" : "#111827", textDecoration: st.done ? "line-through" : "none", lineHeight: 1.5 }}>{st.text}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {todo.deadline && (
            <div style={{ padding: "16px", background: "#F3F4F6", borderRadius: 14 }}>
              <p style={{ fontSize: 12, color: "#6B7280", fontWeight: 600, marginBottom: 4 }}>📅 いつまでに</p>
              <p style={{ fontSize: 15, color: "#111827", fontWeight: 700 }}>{new Date(todo.deadline + "T00:00:00").toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" })}</p>
            </div>
          )}
          {todo.memo && (
            <div style={{ padding: "16px", background: "#F3F4F6", borderRadius: 14 }}>
              <p style={{ fontSize: 12, color: "#6B7280", fontWeight: 600, marginBottom: 4 }}>📝 メモ</p>
              <p style={{ fontSize: 14, color: "#374151", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{todo.memo}</p>
            </div>
          )}
        </div>
        <button onClick={() => { onToggle(todo.id, occDate); setScreen("home"); }} style={{ width: "100%", marginTop: 28, padding: "16px", borderRadius: 14, border: "none", background: isDone ? "#F3F4F6" : "linear-gradient(135deg, #34D399, #059669)", color: isDone ? "#6B7280" : "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer", boxShadow: isDone ? "none" : "0 4px 14px rgba(5,150,105,0.3)", fontFamily: "inherit" }}>
          {isDone ? "未完了に戻す" : "完了にする ✓"}
        </button>
      </div>
    </div>
  );
};

// ─── CALENDAR SCREEN ──────────────────────────────────────────────────────────
const CalendarScreen = ({ todos, setScreen, setEditTodo, onToggle, categories }) => {
  const [viewDate,      setViewDate]      = useState(new Date());
  const [selectedDate,  setSelectedDate]  = useState(today());

  const year  = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth     = new Date(year, month + 1, 0).getDate();
  const todayStr        = today();

  const prevMonth = () => { const d = new Date(viewDate); d.setMonth(d.getMonth() - 1); setViewDate(d); };
  const nextMonth = () => { const d = new Date(viewDate); d.setMonth(d.getMonth() + 1); setViewDate(d); };

  // 指定日に表示すべきTODO（通常 + 繰り返しoccurrence）を返す
  const getCalendarTodosForDate = (dateStr) => {
    const result = [];
    todos.forEach(todo => {
      if (!todo.repeat || todo.repeat === "none") {
        if (todo.deadline === dateStr) result.push({ ...todo, occurrenceDate: dateStr });
      } else if (todo.deadline && isOccurrenceDate(todo, dateStr)) {
        result.push({ ...todo, occurrenceDate: dateStr });
      }
    });
    return result;
  };

  const selectedTodos = getCalendarTodosForDate(selectedDate);

  const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

  return (
    <div style={{ flex: 1, overflowY: "auto", paddingBottom: 100 }}>
      <div style={{ padding: "20px 20px 0" }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginBottom: 16 }}>📅 カレンダー</h2>

        {/* 月ナビゲーション */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, padding: "12px 16px", background: "#fff", borderRadius: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
          <button onClick={prevMonth} style={{ fontSize: 24, background: "none", border: "none", cursor: "pointer", color: "#374151", lineHeight: 1, padding: "0 8px" }}>‹</button>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>{year}年{month + 1}月</p>
          <button onClick={nextMonth} style={{ fontSize: 24, background: "none", border: "none", cursor: "pointer", color: "#374151", lineHeight: 1, padding: "0 8px" }}>›</button>
        </div>

        {/* カレンダーグリッド */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "14px 10px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", marginBottom: 16 }}>
          {/* 曜日ヘッダー */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 6 }}>
            {DAY_NAMES.map((d, i) => (
              <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 600, padding: "4px 0", color: i === 0 ? "#EF4444" : i === 6 ? "#3B82F6" : "#9CA3AF" }}>{d}</div>
            ))}
          </div>
          {/* 日付セル */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {Array.from({ length: firstDayOfMonth }, (_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day     = i + 1;
              const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
              const dayTodos = getCalendarTodosForDate(dateStr);
              const isToday    = dateStr === todayStr;
              const isSelected = dateStr === selectedDate;
              const dow = (firstDayOfMonth + i) % 7;
              return (
                <div key={day} onClick={() => setSelectedDate(dateStr)} style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "5px 2px", borderRadius: 10, cursor: "pointer", background: isSelected ? "#059669" : isToday ? "#ECFDF5" : "transparent", minHeight: 42 }}>
                  <span style={{ fontSize: 13, fontWeight: isToday || isSelected ? 700 : 400, color: isSelected ? "#fff" : dow === 0 ? "#EF4444" : dow === 6 ? "#3B82F6" : "#374151" }}>{day}</span>
                  {dayTodos.length > 0 && (
                    <div style={{ display: "flex", gap: 2, marginTop: 3 }}>
                      {dayTodos.slice(0, 3).map((t, idx) => {
                        const occDone = isTodoDone(t, t.occurrenceDate);
                        return <div key={idx} style={{ width: 5, height: 5, borderRadius: 99, background: isSelected ? "rgba(255,255,255,0.8)" : occDone ? "#D1D5DB" : "#059669" }} />;
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 選択日のTODO一覧 */}
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#374151", marginBottom: 10 }}>
            {new Date(selectedDate + "T00:00:00").toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" })}のTODO
          </h3>
          {selectedTodos.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px", color: "#9CA3AF", background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
              <div style={{ fontSize: 32 }}>📭</div>
              <p style={{ fontSize: 13, marginTop: 8 }}>この日のTODOはありません</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {selectedTodos.map(todo => {
                const cat    = getCat(todo.category, categories);
                const isDone = isTodoDone(todo, todo.occurrenceDate);
                return (
                  <div key={`${todo.id}-${todo.occurrenceDate}`} onClick={() => { setEditTodo(todo); setScreen("detail"); }} style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 14, padding: "14px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", opacity: isDone ? 0.5 : 1, cursor: "pointer" }}>
                    <button onClick={e => { e.stopPropagation(); onToggle(todo.id, todo.occurrenceDate); }} style={{ width: 24, height: 24, borderRadius: 99, border: `2px solid ${isDone ? "#10B981" : cat.color}`, background: isDone ? "#10B981" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700, flexShrink: 0, cursor: "pointer" }}>{isDone ? "✓" : ""}</button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "#111827", textDecoration: isDone ? "line-through" : "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{todo.title}</p>
                      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                        <CategoryBadge catId={todo.category} categories={categories} small />
                        <RepeatBadge repeat={todo.repeat} />
                      </div>
                    </div>
                    <span style={{ color: "#D1D5DB", fontSize: 18 }}>›</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── SETTINGS SCREEN ──────────────────────────────────────────────────────────
const SettingsScreen = ({ setScreen, settings, setSettings, user, onLogout, notifPermission, onRequestPermission, customCategories, onDeleteCategory }) => {
  const colors = ["#059669", "#3B82F6", "#8B5CF6", "#F59E0B", "#EF4444", "#EC4899"];
  const avatarLetter = (user?.displayName || user?.email || "U")[0].toUpperCase();

  const handleNotifToggle = () => {
    const next = !settings.notification;
    setSettings(s => ({ ...s, notification: next }));
    if (next && notifPermission === "default") onRequestPermission();
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", paddingBottom: 40 }}>
      <div style={{ padding: "20px 20px 0" }}>
        <button onClick={() => setScreen("home")} style={{ fontSize: 13, color: "#6B7280", background: "none", border: "none", cursor: "pointer", marginBottom: 16, fontFamily: "inherit" }}>← 戻る</button>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginBottom: 20 }}>⚙️ 設定</h2>

        {/* ユーザー */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <div style={{ width: 48, height: 48, borderRadius: 99, background: "linear-gradient(135deg, #34D399, #059669)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{avatarLetter}</div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user?.displayName || "ユーザー"}</p>
              <p style={{ fontSize: 12, color: "#9CA3AF", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user?.email}</p>
            </div>
          </div>
          <button onClick={onLogout} style={{ width: "100%", padding: "10px", borderRadius: 10, border: "1.5px solid #FCA5A5", background: "#FEF2F2", color: "#EF4444", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>ログアウト</button>
        </div>

        {/* 通知 */}
        <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", marginBottom: 16 }}>
          {[
            { key: "notification", label: "通知", sub: "TODOのリマインド通知", toggle: handleNotifToggle },
            { key: "random", label: "ランダム通知", sub: "ランダムな時間にリマインド", toggle: () => setSettings(s => ({ ...s, random: !s.random })) },
          ].map(({ key, label, sub, toggle }, i, arr) => (
            <div key={key} style={{ padding: "14px 16px", borderBottom: i < arr.length - 1 ? "1px solid #F3F4F6" : "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ fontSize: 15, fontWeight: 600, color: "#111827" }}>{label}</p>
                <p style={{ fontSize: 12, color: "#9CA3AF", marginTop: 2 }}>{sub}</p>
                {key === "notification" && notifPermission === "denied" && <p style={{ fontSize: 11, color: "#EF4444", marginTop: 3 }}>ブラウザで通知がブロックされています</p>}
                {key === "notification" && notifPermission === "default" && settings.notification && <button onClick={onRequestPermission} style={{ marginTop: 6, fontSize: 11, color: "#059669", fontWeight: 600, background: "#ECFDF5", border: "none", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontFamily: "inherit" }}>通知を許可する →</button>}
              </div>
              <button onClick={toggle} style={{ width: 46, height: 28, borderRadius: 99, border: "none", cursor: "pointer", background: settings[key] ? "#059669" : "#D1D5DB", position: "relative", transition: "background 0.2s" }}>
                <div style={{ position: "absolute", top: 3, left: settings[key] ? 21 : 3, width: 22, height: 22, borderRadius: 99, background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
              </button>
            </div>
          ))}
          <div style={{ padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: "#111827" }}>通知時間帯</p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="time" value={settings.startTime} onChange={e => setSettings(s => ({ ...s, startTime: e.target.value }))} style={{ border: "1.5px solid #E5E7EB", borderRadius: 8, padding: "4px 8px", fontSize: 13, fontFamily: "inherit" }} />
              <span style={{ color: "#9CA3AF" }}>〜</span>
              <input type="time" value={settings.endTime} onChange={e => setSettings(s => ({ ...s, endTime: e.target.value }))} style={{ border: "1.5px solid #E5E7EB", borderRadius: 8, padding: "4px 8px", fontSize: 13, fontFamily: "inherit" }} />
            </div>
          </div>
        </div>

        {/* カスタムカテゴリ管理 */}
        {customCategories.length > 0 && (
          <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", marginBottom: 16 }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #F3F4F6" }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: "#111827" }}>カスタムカテゴリ</p>
            </div>
            {customCategories.map(cat => (
              <div key={cat.id} style={{ padding: "12px 16px", borderBottom: "1px solid #F3F4F6", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20 }}>{cat.emoji}</span>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: "#111827" }}>{cat.label}</span>
                <span style={{ width: 14, height: 14, borderRadius: 99, background: cat.color, display: "inline-block" }} />
                <button onClick={() => onDeleteCategory(cat.id)} style={{ background: "none", border: "none", color: "#EF4444", fontSize: 18, cursor: "pointer", padding: "2px 6px" }}>×</button>
              </div>
            ))}
          </div>
        )}

        {/* テーマカラー */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "14px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: "#111827", marginBottom: 12 }}>テーマカラー</p>
          <div style={{ display: "flex", gap: 12 }}>
            {colors.map(c => (
              <button key={c} onClick={() => setSettings(s => ({ ...s, accentColor: c }))} style={{ width: 36, height: 36, borderRadius: 99, background: c, border: `3px solid ${settings.accentColor === c ? "#111827" : "transparent"}`, cursor: "pointer", transition: "border 0.15s" }} />
            ))}
          </div>
        </div>

        <div style={{ marginTop: 24, padding: "14px 16px", background: "#ECFDF5", borderRadius: 14, textAlign: "center" }}>
          <p style={{ fontSize: 13, color: "#065F46", fontWeight: 500 }}>TODO LIFE v1.2.0</p>
          <p style={{ fontSize: 12, color: "#6EE7B7", marginTop: 4 }}>やることを、目的に変えて、人生を動かす。</p>
        </div>
      </div>
    </div>
  );
};

// ─── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [screen,    setScreen]    = useState("home");
  const [todos,     setTodos]     = useState([]);
  const [editTodo,  setEditTodo]  = useState(null);
  const [situation, setSituation] = useState("仕事中");
  const [settings,  setSettings]  = useState({ notification: true, random: true, startTime: "08:00", endTime: "22:00", accentColor: "#059669" });
  const [customCategories, setCustomCategories] = useState([]);
  const [catModal,  setCatModal]  = useState(null);

  const [user,         setUser]         = useState(null);
  const [authLoading,  setAuthLoading]  = useState(true);
  const [loading,      setLoading]      = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [notifPermission, setNotifPermission] = useState(
    "Notification" in window ? Notification.permission : "unsupported"
  );

  const allCategories = [...DEFAULT_CATEGORIES, ...customCategories];

  // 認証監視
  useEffect(() => {
    return onAuthStateChanged(auth, u => { setUser(u); setAuthLoading(false); });
  }, []);

  // todos リアルタイム同期
  useEffect(() => {
    if (!user) { setTodos([]); setLoading(false); return; }
    setLoading(true);
    const q = query(collection(db, "users", user.uid, "todos"), orderBy("createdAt", "asc"));
    return onSnapshot(q, snap => {
      setTodos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
  }, [user]);

  // カスタムカテゴリ読み込み
  useEffect(() => {
    if (!user) { setCustomCategories([]); return; }
    return onSnapshot(doc(db, "users", user.uid), snap => {
      if (snap.exists()) setCustomCategories(snap.data().customCategories || []);
    });
  }, [user]);

  // 旧フォーマット（done:true + nextDue）を completedDates 形式に移行
  useEffect(() => {
    if (!user || todos.length === 0) return;
    todos.filter(t => t.done && t.repeat && t.repeat !== "none").forEach(async t => {
      const prev = t.completedDates || [];
      const lastDate = t.deadline || today();
      const next = prev.includes(lastDate) ? prev : [...prev, lastDate];
      await updateDoc(doc(db, "users", user.uid, "todos", t.id), { done: false, nextDue: null, completedDates: next });
    });
  }, [todos, user]);

  // 通知許可
  const requestNotifPermission = async () => {
    if (!("Notification" in window)) return;
    setNotifPermission(await Notification.requestPermission());
  };

  // ランダム通知スケジューラー
  useEffect(() => {
    if (!settings.notification || !settings.random || !user || notifPermission !== "granted") return;
    let tid;
    const schedule = () => {
      const now = new Date();
      const [sH, sM] = settings.startTime.split(":").map(Number);
      const [eH, eM] = settings.endTime.split(":").map(Number);
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const endMin = eH * 60 + eM;
      if (nowMin < sH * 60 + sM || nowMin >= endMin) return;
      const remaining = endMin - nowMin;
      const maxD = Math.min(120, remaining - 1);
      const minD = Math.min(30, maxD);
      if (maxD <= 0) return;
      tid = setTimeout(() => {
        const undone = todos.filter(t => !isTodoDone(t));
        const body = undone.length > 0
          ? (() => { const t = undone[Math.floor(Math.random() * undone.length)]; return t.purpose ? `${t.title}\n📌 ${t.purpose}` : t.title; })()
          : "今日のTODOは全て完了しています！🎉";
        new Notification("TODO LIFE ✅", { body, icon: "/logo192.png", tag: "todo-life-reminder" });
        schedule();
      }, (minD + Math.random() * (maxD - minD)) * 60 * 1000);
    };
    schedule();
    return () => clearTimeout(tid);
  }, [settings.notification, settings.random, settings.startTime, settings.endTime, notifPermission, todos, user]);

  // CRUD
  const handleToggle = async (id, occurrenceDate = null) => {
    if (!user) return;
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    if (todo.repeat && todo.repeat !== "none") {
      // 繰り返しTODO: その日付だけ completedDates でトグル
      const dateKey = occurrenceDate || today();
      const prev = todo.completedDates || [];
      const next = prev.includes(dateKey)
        ? prev.filter(d => d !== dateKey)
        : [...prev, dateKey];
      await updateDoc(doc(db, "users", user.uid, "todos", id), { completedDates: next, done: false, nextDue: null });
    } else {
      await updateDoc(doc(db, "users", user.uid, "todos", id), { done: !todo.done });
    }
  };

  const handleSubtaskToggle = async (todoId, subtaskId) => {
    if (!user) return;
    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;
    const updated = (todo.subtasks || []).map(st =>
      st.id === subtaskId ? { ...st, done: !st.done } : st
    );
    await updateDoc(doc(db, "users", user.uid, "todos", todoId), { subtasks: updated });
  };

  const handleDelete = async (id) => {
    if (!user) return;
    await deleteDoc(doc(db, "users", user.uid, "todos", id));
  };

  const handleSave = async (data, editId) => {
    if (!user) return;
    if (editId) {
      await updateDoc(doc(db, "users", user.uid, "todos", editId), data);
    } else {
      await addDoc(collection(db, "users", user.uid, "todos"), { ...data, done: false, createdAt: Date.now() });
    }
  };

  const handleQuickAdd = async (title) => {
    if (!user || !title.trim()) return;
    await addDoc(collection(db, "users", user.uid, "todos"), { title: title.trim(), deadline: "", category: "いつでもOK", memo: "", repeat: "none", subtasks: [], done: false, createdAt: Date.now() });
  };

  // カスタムカテゴリ
  const handleAddCategory = async (cat) => {
    const updated = [...customCategories, cat];
    setCustomCategories(updated);
    if (user) await setDoc(doc(db, "users", user.uid), { customCategories: updated }, { merge: true });
  };

  const handleDeleteCategory = async (catId) => {
    const updated = customCategories.filter(c => c.id !== catId);
    setCustomCategories(updated);
    if (user) await setDoc(doc(db, "users", user.uid), { customCategories: updated }, { merge: true });
  };

  const openCatModal = (cb) => setCatModal({ onSave: cb });

  // ナビゲーション（OCR削除、カレンダー追加）
  const navItems = [
    { id: "home",     emoji: "🏠", label: "ホーム" },
    { id: "list",     emoji: "📋", label: "リスト" },
    { id: "add",      emoji: "➕", label: "追加" },
    { id: "calendar", emoji: "📅", label: "カレンダー" },
    { id: "settings", emoji: "⚙️", label: "設定" },
  ];

  const handleNav = (id) => { if (id === "add") setEditTodo(null); setScreen(id); };

  const renderScreen = () => {
    switch (screen) {
      case "home":      return <HomeScreen todos={todos} setScreen={setScreen} setEditTodo={setEditTodo} onToggle={handleToggle} categories={allCategories} onQuickAdd={handleQuickAdd} />;
      case "add":       return <AddScreen setScreen={setScreen} editTodo={editTodo} onSave={handleSave} onAddExtra={handleQuickAdd} categories={allCategories} openCatModal={openCatModal} />;
      case "situation": return <SituationScreen setScreen={setScreen} setSituation={setSituation} categories={allCategories} />;
      case "recommend": return <RecommendScreen todos={todos} situation={situation} setScreen={setScreen} setEditTodo={setEditTodo} onToggle={handleToggle} categories={allCategories} />;
      case "list":      return <ListScreen todos={todos} setScreen={setScreen} setEditTodo={setEditTodo} onToggle={handleToggle} onDelete={handleDelete} categories={allCategories} />;
      case "detail":    return <DetailScreen todo={editTodo} setScreen={setScreen} setEditTodo={setEditTodo} onToggle={handleToggle} onSubtaskToggle={handleSubtaskToggle} categories={allCategories} />;
      case "calendar":  return <CalendarScreen todos={todos} setScreen={setScreen} setEditTodo={setEditTodo} onToggle={handleToggle} categories={allCategories} />;
      case "settings":  return <SettingsScreen setScreen={setScreen} settings={settings} setSettings={setSettings} user={user} onLogout={async () => { await signOut(auth); setScreen("home"); }} notifPermission={notifPermission} onRequestPermission={requestNotifPermission} customCategories={customCategories} onDeleteCategory={handleDeleteCategory} />;
      default:          return null;
    }
  };

  return (
    <div style={{ fontFamily: "-apple-system, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif", background: "#F9FAFB", minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "center" }}>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        @keyframes fadeUp  { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes pulse   { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }
        ::-webkit-scrollbar { display: none; }
        input[type=date]::-webkit-inner-spin-button,
        input[type=date]::-webkit-calendar-picker-indicator { opacity: 0.5; }
        button:active { opacity: 0.8; }
      `}</style>

      {/* Phone frame */}
      <div style={{ width: "min(390px, 100vw)", height: "min(844px, 100vh)", background: "#F9FAFB", borderRadius: "min(44px, 0px)", overflow: "hidden", display: "flex", flexDirection: "column", position: "relative", boxShadow: "0 40px 120px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.08)" }}>

        {authLoading ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 36, height: 36, borderRadius: 99, border: "3px solid #E5E7EB", borderTopColor: "#059669", animation: "spin 0.8s linear infinite" }} />
          </div>
        ) : !user ? (
          <LoginScreen
            onLogin={async () => { setLoginLoading(true); try { await signInWithPopup(auth, googleProvider); } catch(e) { console.error(e); } finally { setLoginLoading(false); } }}
            loginLoading={loginLoading}
          />
        ) : loading ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 99, border: "3px solid #E5E7EB", borderTopColor: "#059669", animation: "spin 0.8s linear infinite" }} />
            <p style={{ fontSize: 13, color: "#9CA3AF" }}>データを読み込み中...</p>
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", animation: "slideIn 0.25s ease both" }} key={screen}>
            {renderScreen()}
          </div>
        )}

        {/* Bottom Nav */}
        {!authLoading && user && (
          <div style={{ height: 80, background: "#fff", borderTop: "1px solid #F3F4F6", display: "flex", alignItems: "center", paddingBottom: 8, flexShrink: 0, boxShadow: "0 -4px 20px rgba(0,0,0,0.05)" }}>
            {navItems.map(item => {
              const isActive = screen === item.id;
              const isAdd    = item.id === "add";
              return (
                <button key={item.id} onClick={() => handleNav(item.id)} style={{ flex: 1, height: "100%", background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
                  {isAdd ? (
                    <div style={{ width: 44, height: 44, borderRadius: 14, marginTop: -20, background: "linear-gradient(135deg, #34D399, #059669)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(5,150,105,0.4)", fontSize: 22, color: "#fff" }}>＋</div>
                  ) : (
                    <>
                      <span style={{ fontSize: 20, lineHeight: 1 }}>{item.emoji}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: isActive ? settings.accentColor : "#9CA3AF" }}>{item.label}</span>
                      {isActive && <div style={{ width: 4, height: 4, borderRadius: 99, background: settings.accentColor, marginTop: -2 }} />}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Category Creator Modal */}
        {catModal && (
          <CategoryCreatorModal
            onSave={cat => { handleAddCategory(cat); catModal.onSave(cat); setCatModal(null); }}
            onClose={() => setCatModal(null)}
          />
        )}
      </div>
    </div>
  );
}
