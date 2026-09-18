self.addEventListener("push", function (event) {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    console.error("Push data error:", error);
    data = {};
  }

  const title = data.title || "⚽ AliScore";

  const options = {
    body: data.body || "Yeni bildiriş",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: {
      url: data.url || "/"
    },
    vibrate: [200, 100, 200],
    tag: "aliscore-notification",
    renotify: true
  };

  event.waitUntil(
    self.registration.showNotification(
      title,
      options
    )
  );
});


self.addEventListener(
  "notificationclick",
  function (event) {

    event.notification.close();

    const url =
      event.notification &&
      event.notification.data &&
      event.notification.data.url
        ? event.notification.data.url
        : "/";

    event.waitUntil(
      clients.matchAll({
        type: "window",
        includeUncontrolled: true
      }).then(function (clientList) {

        for (const client of clientList) {

          if ("focus" in client) {

            client.navigate(url);

            return client.focus();

          }

        }

        if (clients.openWindow) {

          return clients.openWindow(url);

        }

      })
    );

  }
);


self.addEventListener(
  "install",
  function () {

    self.skipWaiting();

  }
);


self.addEventListener(
  "activate",
  function (event) {

    event.waitUntil(
      clients.claim()
    );

  }
);
