self.addEventListener("push",event=>{
 let data={title:"AliScore",body:"Yeni bildiriş var.",url:"/"};
 try{if(event.data)data=event.data.json()}catch(e){}
 event.waitUntil(self.registration.showNotification(data.title||"AliScore",{
  body:data.body||"Yeni hadisə baş verdi.",icon:"/favicon.ico",badge:"/favicon.ico",data:{url:data.url||"/"}
 }));
});
self.addEventListener("notificationclick",event=>{
 event.notification.close();
 const url=event.notification.data?.url||"/";
 event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
  for(const client of list){if("focus"in client){client.navigate(url);return client.focus()}}
  return clients.openWindow(url);
 }));
});