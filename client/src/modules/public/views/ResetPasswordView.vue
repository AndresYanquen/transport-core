<script setup>
import { computed, reactive, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound } from "lucide-vue-next";

import goTaxiLogo from "@/assets/images/logo/gottaxi.png";
import { apiRequest } from "../../../services/api.js";

const route = useRoute();
const token = computed(() => String(route.query.token || "").trim());
const passwordVisible = ref(false);
const state = reactive({
  password: "",
  confirmPassword: "",
  loading: false,
  success: "",
  error: "",
});

const canSubmit = computed(
  () =>
    Boolean(token.value) &&
    state.password.length >= 6 &&
    state.password === state.confirmPassword &&
    !state.loading
);

async function submitReset() {
  state.error = "";
  state.success = "";

  if (!token.value) {
    state.error = "El enlace no incluye un token de recuperación válido.";
    return;
  }

  if (state.password.length < 6) {
    state.error = "La contraseña debe tener al menos 6 caracteres.";
    return;
  }

  if (state.password !== state.confirmPassword) {
    state.error = "Las contraseñas no coinciden.";
    return;
  }

  state.loading = true;
  try {
    await apiRequest("/api/auth/reset-password", {
      method: "POST",
      body: {
        token: token.value,
        password: state.password,
      },
    });
    state.success = "Tu contraseña fue actualizada. Ya puedes iniciar sesión.";
    state.password = "";
    state.confirmPassword = "";
  } catch (error) {
    state.error = error?.message || "No se pudo actualizar la contraseña.";
  } finally {
    state.loading = false;
  }
}
</script>

<template>
  <main class="reset-page">
    <section class="reset-shell">
      <RouterLink class="brand" :to="{ name: 'landing' }" aria-label="GotTaxi">
        <span class="brand-logo">
          <img :src="goTaxiLogo" alt="" />
        </span>
        <span>GotTaxi</span>
      </RouterLink>

      <div class="reset-panel">
        <div class="panel-icon">
          <KeyRound :size="28" aria-hidden="true" />
        </div>
        <p class="eyebrow">Recuperación de contraseña</p>
        <h1>Crea una nueva contraseña</h1>
        <p class="intro">
          Ingresa una contraseña nueva para recuperar el acceso a tu cuenta.
        </p>

        <form class="reset-form" @submit.prevent="submitReset">
          <div v-if="state.error" class="alert alert-error">{{ state.error }}</div>
          <div v-if="state.success" class="alert alert-success">
            <CheckCircle2 :size="18" aria-hidden="true" />
            <span>{{ state.success }}</span>
          </div>

          <label>
            Nueva contraseña
            <span class="password-field">
              <input
                v-model="state.password"
                autocomplete="new-password"
                minlength="6"
                name="password"
                required
                :type="passwordVisible ? 'text' : 'password'"
              />
              <button
                type="button"
                :aria-label="passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'"
                @click="passwordVisible = !passwordVisible"
              >
                <EyeOff v-if="passwordVisible" :size="18" aria-hidden="true" />
                <Eye v-else :size="18" aria-hidden="true" />
              </button>
            </span>
          </label>

          <label>
            Confirmar contraseña
            <input
              v-model="state.confirmPassword"
              autocomplete="new-password"
              minlength="6"
              name="confirmPassword"
              required
              :type="passwordVisible ? 'text' : 'password'"
            />
          </label>

          <button class="submit-button" type="submit" :disabled="!canSubmit">
            {{ state.loading ? "Actualizando..." : "Actualizar contraseña" }}
          </button>
        </form>

        <RouterLink class="back-link" :to="{ name: 'admin-login' }">
          <ArrowLeft :size="17" aria-hidden="true" />
          <span>Volver al inicio de sesión</span>
        </RouterLink>
      </div>
    </section>
  </main>
</template>

<style scoped>
.reset-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 28px;
  color: #f8fafc;
  background:
    linear-gradient(145deg, rgba(3, 8, 23, 0.94), rgba(17, 24, 39, 0.98)),
    radial-gradient(circle at 20% 20%, rgba(45, 212, 191, 0.18), transparent 32%);
}

.reset-shell {
  width: min(100%, 440px);
}

.brand,
.back-link,
.alert-success {
  display: inline-flex;
  align-items: center;
}

.brand {
  gap: 12px;
  margin-bottom: 22px;
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

.reset-panel {
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.82);
  padding: 30px;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.34);
}

.panel-icon {
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  border-radius: 8px;
  background: #2dd4bf;
  color: #05201b;
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

.intro {
  margin: 12px 0 0;
  color: #cbd5e1;
  line-height: 1.6;
}

.reset-form {
  display: grid;
  gap: 16px;
  margin-top: 24px;
}

label {
  display: grid;
  gap: 8px;
  color: #e2e8f0;
  font-size: 14px;
  font-weight: 700;
}

input {
  width: 100%;
  height: 44px;
  border: 1px solid rgba(148, 163, 184, 0.38);
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.55);
  color: #fff;
  font: inherit;
  outline: none;
  padding: 0 12px;
}

input:focus {
  border-color: #2dd4bf;
  box-shadow: 0 0 0 3px rgba(45, 212, 191, 0.14);
}

.password-field {
  position: relative;
}

.password-field input {
  padding-right: 46px;
}

.password-field button {
  position: absolute;
  top: 50%;
  right: 8px;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #cbd5e1;
  cursor: pointer;
  transform: translateY(-50%);
}

.submit-button {
  height: 46px;
  border: 0;
  border-radius: 8px;
  background: #2dd4bf;
  color: #05201b;
  cursor: pointer;
  font-weight: 800;
}

.submit-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.alert {
  border-radius: 8px;
  padding: 11px 12px;
  font-size: 14px;
  line-height: 1.45;
}

.alert-error {
  border: 1px solid rgba(251, 113, 133, 0.35);
  background: rgba(127, 29, 29, 0.32);
  color: #fecdd3;
}

.alert-success {
  gap: 8px;
  border: 1px solid rgba(45, 212, 191, 0.35);
  background: rgba(20, 83, 45, 0.28);
  color: #bbf7d0;
}

.back-link {
  gap: 8px;
  margin-top: 20px;
  color: #cbd5e1;
  font-size: 14px;
  font-weight: 700;
}

@media (max-width: 520px) {
  .reset-page {
    padding: 20px;
  }

  .reset-panel {
    padding: 24px;
  }
}
</style>
