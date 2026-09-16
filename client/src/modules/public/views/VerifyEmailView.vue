<script setup>
import { onMounted, reactive } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { CheckCircle2, Loader2, MailCheck, XCircle } from "lucide-vue-next";

import goTaxiLogo from "@/assets/images/logo/gottaxi.png";
import { apiRequest } from "../../../services/api.js";

const route = useRoute();
const state = reactive({
  loading: true,
  success: "",
  error: "",
});

onMounted(async () => {
  const token = String(route.query.token || "").trim();
  if (!token) {
    state.loading = false;
    state.error = "El enlace no incluye un token de verificación válido.";
    return;
  }

  try {
    await apiRequest("/api/auth/verify-email", {
      method: "POST",
      body: { token },
    });
    state.success = "Tu correo fue verificado correctamente.";
  } catch (error) {
    state.error = error?.message || "No se pudo verificar el correo.";
  } finally {
    state.loading = false;
  }
});
</script>

<template>
  <main class="verify-page">
    <section class="verify-panel">
      <RouterLink class="brand" :to="{ name: 'landing' }" aria-label="GotTaxi">
        <span class="brand-logo">
          <img :src="goTaxiLogo" alt="" />
        </span>
        <span>GotTaxi</span>
      </RouterLink>

      <div class="status-icon" :class="{ error: state.error }">
        <Loader2 v-if="state.loading" class="spin" :size="30" aria-hidden="true" />
        <CheckCircle2 v-else-if="state.success" :size="30" aria-hidden="true" />
        <XCircle v-else :size="30" aria-hidden="true" />
      </div>

      <p class="eyebrow">Verificación de correo</p>
      <h1>{{ state.loading ? "Verificando..." : state.success ? "Correo verificado" : "No se pudo verificar" }}</h1>
      <p>
        {{ state.loading ? "Estamos confirmando tu enlace de verificación." : state.success || state.error }}
      </p>

      <RouterLink class="login-link" :to="{ name: 'admin-login' }">
        <MailCheck :size="18" aria-hidden="true" />
        <span>Ir al inicio de sesión</span>
      </RouterLink>
    </section>
  </main>
</template>

<style scoped>
.verify-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 28px;
  color: #f8fafc;
  background: linear-gradient(145deg, #030817, #111827);
}

.verify-panel {
  width: min(100%, 430px);
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.86);
  padding: 30px;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.34);
}

.brand,
.login-link {
  display: inline-flex;
  align-items: center;
}

.brand {
  gap: 12px;
  color: #fff;
  font-size: 20px;
  font-weight: 800;
}

.brand-logo {
  display: grid;
  width: 68px;
  height: 46px;
  place-items: center;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.95);
  padding: 5px 7px;
}

.brand-logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.status-icon {
  display: grid;
  width: 56px;
  height: 56px;
  place-items: center;
  margin-top: 28px;
  border-radius: 8px;
  background: #2dd4bf;
  color: #05201b;
}

.status-icon.error {
  background: #fb7185;
  color: #450a0a;
}

.spin {
  animation: spin 1s linear infinite;
}

.eyebrow {
  margin: 20px 0 8px;
  color: #67e8f9;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-size: 30px;
  line-height: 1.1;
}

p {
  margin: 12px 0 0;
  color: #cbd5e1;
  line-height: 1.6;
}

.login-link {
  gap: 8px;
  margin-top: 24px;
  border-radius: 8px;
  background: #2dd4bf;
  color: #05201b;
  padding: 12px 14px;
  font-size: 14px;
  font-weight: 800;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
