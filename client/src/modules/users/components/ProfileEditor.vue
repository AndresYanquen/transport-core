<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { apiRequest } from "../../../services/api.js";
const props = defineProps({ endpoint: { type: String, required: true }, administrative: Boolean });
const emit = defineEmits(["saved"]);
const user = ref(null);
const original = ref({});
const form = reactive({});
const state = reactive({ loading: true, saving: false, error: "", success: "" });
const fields = computed(() => [
  { key: "firstName", label: "Nombre", max: 100 }, { key: "lastName", label: "Apellido", max: 100 },
  ...(user.value?.role === "client" ? [{ key: "defaultPaymentMethod", label: "Método de pago preferido", max: 100 }] : []),
  ...(user.value?.role === "driver" ? [
    { key: "licenseNumber", label: "Licencia", required: true, max: 100 },
    { key: "vehicleMake", label: "Marca", required: true, max: 100 },
    { key: "vehicleModel", label: "Modelo", required: true, max: 100 },
    { key: "vehiclePlate", label: "Placa", required: true, max: 50 },
    { key: "vehicleYear", label: "Año", type: "number" },
    { key: "vehicleColor", label: "Color", max: 50 }, { key: "vehicleType", label: "Tipo de vehículo", max: 50 },
  ] : []),
]);
const documentFields = [
  { key: "licenseFront", label: "Licencia (frente)" }, { key: "licenseBack", label: "Licencia (reverso)" },
  { key: "vehicleRegistration", label: "Tarjeta de propiedad" }, { key: "insurance", label: "Seguro" },
];
function populate(value) {
  user.value = value;
  for (const f of fields.value) form[f.key] = value[f.key] ?? value.clientProfile?.[f.key] ?? value.driverProfile?.[f.key] ?? "";
  const point = value.clientProfile?.homeLocation?.coordinates;
  form.lat = point?.[1] ?? ""; form.lng = point?.[0] ?? "";
  for (const f of documentFields) form[f.key] = value.driverProfile?.documents?.[f.key] || "";
  original.value = JSON.parse(JSON.stringify(form));
}
async function load() {
  state.loading = true; state.error = "";
  try { populate((await apiRequest(props.endpoint)).user); }
  catch (e) { state.error = e.message; }
  finally { state.loading = false; }
}
function patchBody() {
  const body = {};
  for (const field of fields.value) {
    const value = field.type === "number" ? (form[field.key] === "" ? null : Number(form[field.key])) : (String(form[field.key]).trim() || null);
    const before = field.type === "number" ? (original.value[field.key] === "" ? null : Number(original.value[field.key])) : (String(original.value[field.key]).trim() || null);
    if (value === before) continue;
    const group = ["firstName", "lastName"].includes(field.key) ? body : (body[user.value.role === "client" ? "clientProfile" : "driverProfile"] ||= {});
    group[field.key] = value;
  }
  if (user.value.role === "client" && (String(form.lat) !== String(original.value.lat) || String(form.lng) !== String(original.value.lng))) {
    if ((form.lat === "") !== (form.lng === "")) throw new Error("Completa ambas coordenadas o deja ambas vacías.");
    (body.clientProfile ||= {}).homeLocation = form.lat === "" ? null : { lat: Number(form.lat), lng: Number(form.lng) };
  }
  if (user.value.role === "driver") {
    for (const f of documentFields) if (form[f.key].trim() !== original.value[f.key]) {
      ((body.driverProfile ||= {}).documents ||= {})[f.key] = form[f.key].trim() || null;
    }
  }
  return body;
}
async function save() {
  state.saving = true; state.error = ""; state.success = "";
  try {
    const body = patchBody();
    if (!Object.keys(body).length) { state.success = "No hay cambios pendientes."; return; }
    const result = await apiRequest(props.endpoint, { method: "PATCH", body });
    populate(result.user);
    state.success = result.approvalRequired ? "Datos guardados. El conductor queda pendiente de revisión y desconectado." : "Datos guardados.";
    emit("saved", result.user);
  } catch (e) { state.error = e.message; }
  finally { state.saving = false; }
}
async function changeStatus(event) {
  const status = event.target.value;
  if (!status || status === user.value.status) return;
  state.saving = true; state.error = ""; state.success = "";
  try {
    const result = await apiRequest(`${props.endpoint}/status`, { method: "PATCH", body: { status } });
    populate(result.user); state.success = "Estado actualizado. Las sesiones anteriores se cerraron."; emit("saved", result.user);
  } catch (e) { state.error = e.message; event.target.value = user.value.status; }
  finally { state.saving = false; }
}
onMounted(load);
</script>
<template>
  <div class="space-y-4">
    <p v-if="state.loading" role="status">Cargando perfil…</p>
    <p v-if="state.error" class="text-red-700" role="alert">{{ state.error }}</p>
    <p v-if="state.success" class="text-green-700" role="status">{{ state.success }}</p>
    <button v-if="!user && !state.loading" type="button" @click="load">Reintentar</button>
    <form v-if="user" class="space-y-4" @submit.prevent="save">
      <p class="text-sm text-slate-600">{{ user.email || user.phoneNumber }} · {{ user.role }}</p>
      <p v-if="user.role === 'driver'" class="text-sm">Aprobación: {{ user.driverProfile?.approvalStatus }}. Los cambios de licencia o vehículo requieren revisión.</p>
      <fieldset :disabled="state.saving" class="grid gap-3 sm:grid-cols-2">
        <label v-for="field in fields" :key="field.key" class="grid gap-1 text-sm">{{ field.label }}
          <input v-model="form[field.key]" :type="field.type || 'text'" :required="field.required" :maxlength="field.max" :min="field.type === 'number' ? 1900 : undefined" :max="field.type === 'number' ? new Date().getFullYear() + 1 : undefined" class="rounded border border-slate-300 p-2" />
        </label>
        <template v-if="user.role === 'driver'">
          <label v-for="field in documentFields" :key="field.key" class="grid gap-1 text-sm">{{ field.label }} (enlace HTTPS)
            <input v-model="form[field.key]" type="url" pattern="https://.*" maxlength="2048" class="rounded border p-2" />
          </label>
        </template>
        <template v-if="user.role === 'client'">
          <label class="grid gap-1 text-sm">Latitud del hogar<input v-model="form.lat" type="number" step="any" min="-90" max="90" class="rounded border p-2" /></label>
          <label class="grid gap-1 text-sm">Longitud del hogar<input v-model="form.lng" type="number" step="any" min="-180" max="180" class="rounded border p-2" /></label>
        </template>
      </fieldset>
      <button :disabled="state.saving" class="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">{{ state.saving ? "Guardando…" : "Guardar cambios" }}</button>
    </form>
    <label v-if="administrative && user" class="grid gap-1 text-sm">Estado de cuenta
      <select :value="user.status" :disabled="state.saving" class="rounded border p-2" @change="changeStatus">
        <option value="active">Activo</option><option value="inactive">Inactivo</option><option value="suspended">Suspendido</option>
      </select>
    </label>
  </div>
</template>
