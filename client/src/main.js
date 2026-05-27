import { createApp } from "vue";
import App from "./App.vue";
import router from "./router/index.js";
import { initializeSession, onAuthRequired } from "./stores/session.js";
import "./style.css";

initializeSession();

onAuthRequired((reason) => {
  const currentRoute = router.currentRoute.value;

  if (currentRoute.name === "login") {
    return;
  }

  const redirect = currentRoute.fullPath;
  router.push({
    name: "login",
    query: { redirect, reason },
  });
});

createApp(App).use(router).mount("#app");
