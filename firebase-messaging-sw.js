// ============================================================
// 서비스워커 — 앱이 꺼져 있어도 알림을 받는 주체 (2026-10-01 신설)
// ============================================================
// 앱(index.html)이 종료되면 그 안의 코드는 전부 멈춘다. 이 파일만 브라우저가 따로 살려두고
// 푸시가 도착하면 깨워준다. 그래서 '앱 꺼진 상태 알림'은 이 파일 없이는 불가능하다.
//
// ★ 파일 이름을 바꾸지 말 것 — Firebase Messaging이 `firebase-messaging-sw.js`를
//   사이트 루트에서 찾는 것이 기본 동작이다.
// ★ 반드시 서빙 대상(tools/deploy-site.sh의 SERVE)에 들어 있어야 한다. 빠지면 조용히
//   알림만 안 온다(앱은 멀쩡히 돌아서 눈치채기 어렵다).
//
// 주의: 서비스워커는 한 번 설치되면 브라우저가 캐시한다. 이 파일을 고치면 폰에서 반영되기까지
// 시간이 걸릴 수 있다(앱을 완전히 닫았다 열면 빨라진다).
// ============================================================

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCHGeD4GBYeatmrsNFaMLJ7rradXnzbSE8",
  authDomain: "paradise-walk-residence.firebaseapp.com",
  projectId: "paradise-walk-residence",
  storageBucket: "paradise-walk-residence.firebasestorage.app",
  messagingSenderId: "539327839432",
  appId: "1:539327839432:web:40a824be8e420c9fa8b9fd"
});

const messaging = firebase.messaging();

// 앱이 꺼져 있거나 배경일 때 도착하는 알림
messaging.onBackgroundMessage(function (payload) {
  const d = (payload && payload.data) || {};
  const title = d.title || 'Paradise Walk';
  self.registration.showNotification(title, {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    // tag가 같으면 알림이 쌓이지 않고 갱신된다 — 같은 방 상태가 연달아 바뀌어도 하나만 남는다
    tag: d.tag || title,
    renotify: true,
    data: { url: d.url || './' }
  });
});

// 알림을 탭하면 앱을 연다. 이미 열려 있으면 그 창으로 포커스.
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (let i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});

// 설치 즉시 활성화 — 새 버전을 올렸을 때 폰이 옛 서비스워커를 붙들고 있지 않도록
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
