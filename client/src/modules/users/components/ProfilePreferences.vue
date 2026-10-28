<script setup>
import { onMounted, reactive } from "vue";
import { apiRequest } from "../../../services/api.js";
const props = defineProps({ user: { type: Object, required: true } });
const emit = defineEmits(["saved"]);
const state = reactive({ busy: false, loading: true, loaded: false, error: "", success: "", theme: "system", language: "es" });
async function run(work) {
  state.busy = true; state.error = ""; state.success = "";
  try { await work(); } catch (error) { state.error = error.message; } finally { state.busy = false; }
}
async function load() {
  try { const { preferences } = await apiRequest("/api/preferences"); state.theme = preferences.theme; state.language = preferences.language; state.loaded = true; }
  catch (error) { state.error = error.message; } finally { state.loading = false; }
}
async function save() { await run(async () => { await apiRequest("/api/preferences", { method: "PATCH", body: { theme: state.theme, language: state.language } }); state.success = "Preferencias guardadas."; }); }
async function upload(event) {
  const file = event.target.files?.[0]; if (!file) return;
  await run(async () => {
    if (file.size > 5 * 1024 * 1024) throw new Error("La imagen debe pesar máximo 5 MB.");
    const body = new FormData(); body.append("profileImage", file);
    emit("saved", (await apiRequest("/api/users/me/profile-image", { method: "POST", body })).user);
    state.success = "Foto actualizada.";
  });
  event.target.value = "";
}
async function remove() { await run(async () => { emit("saved", (await apiRequest("/api/users/me/profile-image", { method: "DELETE" })).user); state.success = "Foto eliminada."; }); }
onMounted(load);
</script>
<template>
  <section class="space-y-3 rounded border bg-white p-4">
    <h2 class="font-semibold">Foto y preferencias</h2>
    <p v-if="state.error" role="alert" class="text-red-700">{{ state.error }}</p><p v-if="state.success" role="status" class="text-green-700">{{ state.success }}</p>
    <img v-if="props.user.profileImageUrl" :src="props.user.profileImageUrl" alt="Foto de perfil" class="h-20 w-20 rounded-full object-cover" />
    <label class="grid gap-1">Cambiar foto (máximo 5 MB)<input type="file" accept="image/jpeg,image/png,image/webp" :disabled="state.busy" @change="upload" /></label>
    <button v-if="props.user.profileImageUrl" :disabled="state.busy" type="button" class="underline" @click="remove">Eliminar foto</button>
    <form v-if="state.loaded" class="grid gap-3" @submit.prevent="save">
      <label class="grid gap-1">Tema<select v-model="state.theme" class="rounded border p-2"><option value="light">Claro</option><option value="dark">Oscuro</option><option value="system">Sistema</option></select></label>
      <label class="grid gap-1">Idioma<input v-model="state.language" pattern="[a-z]{2}(-[A-Z]{2})?" placeholder="es-CO" required class="rounded border p-2" /></label>
      <button :disabled="state.busy" class="text-left underline">Guardar preferencias</button>
    </form>
    <p v-else-if="state.loading">Cargando preferencias…</p>
    <button v-else type="button" @click="load">Reintentar cargar preferencias</button>
  </section>
</template>
