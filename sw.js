self.addEventListener("push", function (event) {

  let data = {};

  try {
    data = event.data
      ? event.data.json()
      : {};
  } catch (error) {
    data = {
      title: "⚽ AliScore",
      body: event.data
        ? event.data.text()
        : "Yeni bildiriş"
    };
  }

  const title =
    data.title || "⚽ AliScore";

  const options = {
    body:
      data.body ||
      "AliScore-da yeni hadisə var.",
    icon:
      data.icon ||
      "/icon-192.png",
    badge:
      data.badge ||
      "/icon-192.png",
    data:
      data.data || {},
    vibrate: [200, 100, 200],
    tag:
      data.data?.type ||
      "aliscore-notification",
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

    event.waitUntil(
      clients.matchAll({
        type: "window",
        includeUncontrolled: true
      }).then(function (clientList) {

        for (const client of clientList) {

          if ("focus" in client) {
            return client.focus();
          }

        }

        if (clients.openWindow) {
          return clients.openWindow("/");
        }

      })
    );

  }
);
