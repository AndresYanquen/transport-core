<script setup>
import { onMounted, reactive, ref } from "vue";
import { apiRequest } from "../../../services/api.js";
import { useAuthStore } from "../../../stores/auth.js";
import ProfileEditor from "../components/ProfileEditor.vue";
import ProfilePreferences from "../components/ProfilePreferences.vue";
import IdentityEditor from "../components/IdentityEditor.vue";
const auth = useAuthStore();
const revision = ref(0);
const state = reactive({ notice: "", accountType: "client", phone: "", code: "", challengeId: "", busy: false, error: "" });
let deviceId = localStorage.getItem("taxi_profile_device");
if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem("taxi_profile_device", deviceId); }
async function login() {
  state.busy = true; state.error = "";
  try {
    if (!state.challengeId) {
      const result = await apiRequest("/api/auth/phone/request-otp", { method: "POST", body: { phoneNumber: state.phone, accountType: state.accountType, deviceId, requestId: crypto.randomUUID() } });
      state.challengeId = result.challengeId;
    } else {
      auth.applySession(await apiRequest("/api/auth/phone/verify-otp", { method: "POST", body: { challengeId: state.challengeId, code: state.code, deviceId } }));
      state.challengeId = ""; state.code = "";
    }
  } catch (e) { state.error = e.message; } finally { state.busy = false; }
}
function identityChanged(message) { revision.value++; state.notice = message || ""; }
function saved(user) { auth.applySession({ token: auth.state.token, user }); }
onMounted(() => auth.restore());
</script>
<template>
  <main class="mx-auto max-w-2xl space-y-5 p-5">
    <h1 class="text-2xl font-semibold">Mi perfil</h1>
    <p v-if="state.notice" role="status" class="text-green-700">{{ state.notice }}</p>
    <template v-if="auth.isAuthenticated.value && ['client', 'driver'].includes(auth.state.user?.role)">
      <ProfileEditor :key="revision" endpoint="/api/users/me" @saved="saved" />
      <ProfilePreferences :user="auth.state.user" @saved="saved" />
      <IdentityEditor :device-id="deviceId" @changed="identityChanged" />
      <button type="button" class="underline" @click="auth.logout()">Salir</button>
    </template>
    <p v-else-if="auth.isAuthenticated.value">Esta vista está disponible para conductores y pasajeros.</p>
    <form v-else class="space-y-3" @submit.prevent="login">
      <p>Ingresa con el teléfono de tu cuenta.</p>
      <p v-if="state.error" role="alert" class="text-red-700">{{ state.error }}</p>
      <label class="grid gap-1">Tipo de cuenta<select v-model="state.accountType" :disabled="!!state.challengeId || state.busy" class="rounded border p-2"><option value="client">Pasajero</option><option value="driver">Conductor</option></select></label>
      <label class="grid gap-1">Teléfono<input v-model="state.phone" :disabled="!!state.challengeId || state.busy" type="tel" placeholder="+573001234567" required class="rounded border p-2" /></label>
      <label v-if="state.challengeId" class="grid gap-1">Código OTP<input v-model="state.code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required class="rounded border p-2" /></label>
      <button :disabled="state.busy" class="rounded bg-slate-900 px-4 py-2 text-white">{{ state.busy ? 'Procesando…' : state.challengeId ? 'Entrar' : 'Solicitar código' }}</button>
      <button v-if="state.challengeId" type="button" :disabled="state.busy" class="ml-3 underline" @click="state.challengeId = ''; state.code = ''">Volver a solicitar</button>
    </form>
  </main>
</template>
