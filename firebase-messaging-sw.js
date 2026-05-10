importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyC7LCkPsk8rHym3FuwsFY2myxvsJFdtJpc",
  authDomain: "todo-life-66.firebaseapp.com",
  projectId: "todo-life-66",
  storageBucket: "todo-life-66.firebasestorage.app",
  messagingSenderId: "780074358701",
  appId: "1:780074358701:web:d58ce90241ece58cbdb324",
});

const messaging = firebase.messaging();

// FCMバックグラウンドメッセージ（アプリが閉じている・バックグラウンド時）
messaging.onBackgroundMessage(payload => {
  const n = payload.notification || {};
  return self.registration.showNotification(n.title || "TODO LIFE ✅", {
    body: n.body || "",
    icon: "/logo192.png",
    badge: "/logo192.png",
    tag: "todo-life-push",
    data: { url: payload.data?.url || self.location.origin + self.location.pathname.replace(/firebase-messaging-sw\.js$/, "") },
    requireInteraction: false,
  });
});

// 通知タップ → アプリを開く
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = event.notification.data?.url || self.location.origin;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
      const alive = cs.find(c => c.url.startsWith(url.replace(/\/$/, "")) && "focus" in c);
      if (alive) return alive.focus();
      return clients.openWindow(url);
    })
  );
});

// クライアントからのスケジュール通知予約
let scheduledIds = [];
self.addEventListener("message", event => {
  if (event.data?.type !== "SCHEDULE_NOTIFS") return;
  // 既存の予約をクリア
  scheduledIds.forEach(id => clearTimeout(id));
  scheduledIds = [];

  const { todos, endMs } = event.data;
  if (!todos?.length || !endMs) return;

  const now = Date.now();
  const remaining = endMs - now;
  if (remaining <= 0) return;

  // 残り時間に応じてランダムな間隔で最大3回予約
  const count = Math.min(3, Math.floor(remaining / (25 * 60 * 1000)));
  for (let i = 0; i < count; i++) {
    const slotStart = Math.floor(remaining * (i / count));
    const slotEnd   = Math.floor(remaining * ((i + 1) / count));
    const delay     = slotStart + Math.floor(Math.random() * (slotEnd - slotStart));
    if (delay <= 0) continue;
    const title = todos[Math.floor(Math.random() * todos.length)];
    const id = setTimeout(() => {
      self.registration.showNotification("TODO LIFE ✅", {
        body: title,
        icon: "/logo192.png",
        badge: "/logo192.png",
        tag: `todo-life-sched-${i}`,
        data: { url: self.location.origin + self.location.pathname.replace(/firebase-messaging-sw\.js$/, "") },
      });
    }, delay);
    scheduledIds.push(id);
  }
});
