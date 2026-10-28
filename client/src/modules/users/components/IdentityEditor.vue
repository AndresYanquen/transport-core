<script setup>
import { reactive } from "vue";
import { apiRequest } from "../../../services/api.js";
import { useAuthStore } from "../../../stores/auth.js";
const props = defineProps({ deviceId: { type: String, required: true } });
const emit = defineEmits(["changed"]);
const auth = useAuthStore();
const state = reactive({ busy: false, error: "", success: "", currentPassword: "", reauthToken: "", proofId: "", proofCode: "", email: "", emailId: "", emailCode: "", phone: "", phoneId: "", phoneCode: "", password: "" });
const proof = () => ({ ...(state.currentPassword ? { currentPassword: state.currentPassword } : {}), ...(state.reauthToken ? { reauthToken: state.reauthToken } : {}) });
async function run(work) {
  state.busy = true; state.error = ""; state.success = "";
  try { await work(); } catch (e) { state.error = e.message; } finally { state.busy = false; }
}
const post = (path, body) => apiRequest(`/api/auth/${path}`, { method: "POST", body });
async function requestProof() { await run(async () => { state.proofId = (await post("reauth/email/request", {})).challengeId; state.success = "Código enviado al correo actual."; }); }
async function verifyProof() { await run(async () => { state.reauthToken = (await post("reauth/email/verify", { challengeId: state.proofId, code: state.proofCode })).reauthToken; state.proofId = ""; state.proofCode = ""; state.success = "Identidad confirmada por 5 minutos para una operación."; }); }
async function requestEmail() { await run(async () => { state.emailId = (await post("email/change/request", { email: state.email, ...proof() })).challengeId; state.reauthToken = ""; state.success = "Código enviado al nuevo correo. El correo actual sigue vigente."; }); }
function loginAgain(message) { state.currentPassword = ""; state.password = ""; state.reauthToken = ""; auth.logout(); emit("changed", message); }
async function verifyEmail() { await run(async () => { await post("email/change/verify", { challengeId: state.emailId, code: state.emailCode }); loginAgain("Correo actualizado. Inicia sesión otra vez."); }); }
async function requestPhone() { await run(async () => { state.phoneId = (await post("phone/change/request-otp", { phoneNumber: state.phone, deviceId: props.deviceId, requestId: crypto.randomUUID(), ...proof() })).challengeId; state.reauthToken = ""; state.success = "Código enviado al nuevo teléfono."; }); }
async function verifyPhone() { await run(async () => { const session = await post("phone/change/verify-otp", { challengeId: state.phoneId, code: state.phoneCode, deviceId: props.deviceId }); auth.applySession(session); state.phoneId = ""; state.phoneCode = ""; state.currentPassword = ""; emit("changed"); state.success = "Teléfono actualizado. Las sesiones anteriores se cerraron."; }); }
async function changePassword() { await run(async () => { await post("change-password", { password: state.password, ...proof() }); loginAgain("Contraseña guardada. Inicia sesión otra vez."); }); }
</script>
<template>
  <section class="space-y-4 rounded border bg-white p-4">
    <h2 class="font-semibold">Correo, teléfono y contraseña</h2>
    <p class="text-sm">Confirma tu identidad con tu contraseña actual o un código al correo verificado. También puedes realizar estos cambios durante los 5 minutos siguientes a iniciar sesión con OTP.</p>
    <p v-if="state.error" role="alert" class="text-red-700">{{ state.error }}</p><p v-if="state.success" role="status" class="text-green-700">{{ state.success }}</p>
    <fieldset :disabled="state.busy" class="space-y-3">
      <label class="grid gap-1">Contraseña actual<input v-model="state.currentPassword" type="password" autocomplete="current-password" class="rounded border p-2" /></label>
      <button type="button" class="underline" @click="requestProof">Confirmar por correo actual</button>
      <form v-if="state.proofId" class="flex gap-2" @submit.prevent="verifyProof"><input v-model="state.proofCode" aria-label="Código al correo actual" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required class="min-w-0 rounded border p-2" /><button>Confirmar identidad</button></form>
      <form class="grid gap-2" @submit.prevent="requestEmail"><label>Nuevo correo<input v-model="state.email" type="email" required class="w-full rounded border p-2" /></label><button class="text-left underline">Enviar código al nuevo correo</button></form>
      <form v-if="state.emailId" class="grid gap-2" @submit.prevent="verifyEmail"><input v-model="state.emailCode" aria-label="Código del nuevo correo" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required class="rounded border p-2" /><button>Verificar y cambiar correo</button></form>
      <form class="grid gap-2" @submit.prevent="requestPhone"><label>Nuevo teléfono<input v-model="state.phone" type="tel" placeholder="+573001234567" required class="w-full rounded border p-2" /></label><button class="text-left underline">Enviar OTP al nuevo teléfono</button></form>
      <form v-if="state.phoneId" class="grid gap-2" @submit.prevent="verifyPhone"><input v-model="state.phoneCode" aria-label="OTP del nuevo teléfono" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required class="rounded border p-2" /><button>Verificar y cambiar teléfono</button></form>
      <form class="grid gap-2" @submit.prevent="changePassword"><label>Nueva contraseña<input v-model="state.password" type="password" autocomplete="new-password" minlength="6" maxlength="72" required class="w-full rounded border p-2" /></label><button class="text-left underline">Guardar contraseña y cerrar sesiones</button></form>
    </fieldset>
  </section>
</template>
