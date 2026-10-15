<script setup>
import { computed, onMounted, reactive, ref, toRaw } from 'vue';
import { ImagePlus, Plus, ShieldCheck, Megaphone, X, Save, Eye, ArrowRight, Trash2, RefreshCw } from 'lucide-vue-next';
import { apiRequest } from '../../../services/api.js';

const base = '/api/admin/home-content';
const state = reactive({ loading: false, busy: false, uploading: false, error: '', success: '', sections: [], items: [], assets: [] });
const active = ref('promotions');
const editor = ref(null);
const previewPublished = ref(false);
const fileInput = ref(null);
const sectionForm = reactive({ enabled: false, sortOrder: 10, carouselIntervalSeconds: 5, revision: 1 });
const meta = {
  promotions: { title: 'Promociones', description: 'Banners y novedades para el inicio de la app de pasajeros.', icon: Megaphone },
  safety: { title: 'Seguridad', description: 'Una tarjeta informativa con recomendaciones y pantalla de detalle.', icon: ShieldCheck },
};
const items = computed(() => state.items.filter(i => i.section_key === active.value).sort((a, b) => a.draft.sortOrder - b.draft.sortOrder));
const preview = computed(() => previewPublished.value && editor.value?.published ? editor.value.published : editor.value?.content);
const previewAsset = computed(() => state.assets.find(a => a.id === preview.value?.assetId));
const unusedAssets = computed(() => state.assets.filter(a => a.section_key === active.value && !state.items.some(i => i.draft?.assetId === a.id || i.published?.assetId === a.id) && editor.value?.content.assetId !== a.id));
function syncSection() {
  const s = state.sections.find(s => s.key === active.value);
  if (s) Object.assign(sectionForm, { enabled: s.enabled, sortOrder: s.sort_order, carouselIntervalSeconds: s.carousel_interval_seconds, revision: s.revision });
}
async function load() {
  state.loading = true;
  try { const data = await apiRequest(base); Object.assign(state, data); syncSection(); }
  catch (e) { state.error = e.message; }
  finally { state.loading = false; }
}
function choose(key) { active.value = key; state.error = ''; state.success = ''; syncSection(); }
function notify(message) { state.success = message; state.error = ''; }
async function saveSection() {
  state.busy = true; state.error = '';
  try {
    await apiRequest(`${base}/sections/${active.value}`, { method: 'PATCH', body: { ...sectionForm } });
    await load(); notify('Configuración de la sección guardada.');
  } catch (e) { state.error = e.message; }
  finally { state.busy = false; }
}
function edit(item = null) {
  state.error = ''; state.success = ''; previewPublished.value = false;
  editor.value = {
    id: item?.id || null, revision: item?.revision, published: item?.published || null,
    content: item ? structuredClone(toRaw(item.draft)) : {
      title: '', summary: '', altText: '', assetId: null, buttonLabel: active.value === 'safety' ? 'Conoce más' : 'Descubre más',
      sortOrder: items.value.length ? Math.max(...items.value.map(i => i.draft.sortOrder)) + 10 : 10,
      startsAt: null, endsAt: null, action: { type: 'detail' }, blocks: [],
    },
  };
}
function closeEditor() { if (!state.busy && !state.uploading) editor.value = null; }
async function saveItem(publish = false) {
  if (!editor.value || state.busy || state.uploading) return;
  state.busy = true; state.error = ''; state.success = '';
  try {
    const current = editor.value;
    const { item } = await apiRequest(`${base}/items${current.id ? `/${current.id}` : ''}`, {
      method: current.id ? 'PATCH' : 'POST', body: { sectionKey: active.value, revision: current.revision, content: current.content },
    });
    current.id = item.id; current.revision = item.revision;
    current.content = structuredClone(toRaw(item.draft));
    if (publish) {
      const result = await apiRequest(`${base}/items/${item.id}/publish`, { method: 'POST', body: { revision: item.revision } });
      current.revision = result.item.revision; current.published = result.item.published;
    }
    await load(); notify(publish ? 'Contenido publicado. Será visible si la sección está activa y su vigencia lo permite.' : 'Borrador guardado. La versión publicada conserva su contenido.');
  } catch (e) { state.error = e.message; await load(); }
  finally { state.busy = false; }
}
async function archive(item) {
  state.busy = true; state.error = '';
  try { await apiRequest(`${base}/items/${item.id}/archive`, { method: 'POST', body: { revision: item.revision } }); await load(); notify('Contenido archivado. Ya no se entrega a la app.'); }
  catch (e) { state.error = e.message; }
  finally { state.busy = false; }
}
async function uploadImage(event) {
  const file = event.target.files?.[0];
  if (!file || !editor.value) return;
  state.error = '';
  if (file.size > 5 * 1024 * 1024) { state.error = 'La imagen debe pesar máximo 5 MB.'; event.target.value = ''; return; }
  state.uploading = true;
  try {
    const body = new FormData(); body.append('sectionKey', active.value); body.append('image', file);
    const { asset } = await apiRequest(`${base}/assets`, { method: 'POST', body });
    state.assets.unshift(asset); editor.value.content.assetId = asset.id; previewPublished.value = false;
  } catch (e) { state.error = e.message; }
  finally { state.uploading = false; event.target.value = ''; }
}
async function deleteAsset(asset) {
  state.busy = true; state.error = '';
  try { await apiRequest(`${base}/assets/${asset.id}`, { method: 'DELETE' }); state.assets = state.assets.filter(a => a.id !== asset.id); notify('Imagen sin uso eliminada de R2.'); }
  catch (e) { state.error = e.message; }
  finally { state.busy = false; }
}
function status(item) {
  if (item.status === 'archived') return 'Archivado';
  if (item.status !== 'published') return 'Borrador';
  if (item.published.endsAt && Date.parse(item.published.endsAt) <= Date.now()) return 'Vencido';
  if (item.published.startsAt && Date.parse(item.published.startsAt) > Date.now()) return 'Programado';
  return 'Publicado';
}
function localDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function setDate(key, value) { editor.value.content[key] = value ? new Date(value).toISOString() : null; }
function imageFor(item) { return state.assets.find(a => a.id === item.draft.assetId)?.url; }
onMounted(load);
</script>

<template>
  <section class="space-y-6 p-4 md:p-6">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div><p class="text-xs font-semibold uppercase tracking-widest text-slate-500">Configuración general</p><h1 class="mt-1 text-2xl font-semibold text-slate-950">Contenido de inicio</h1><p class="mt-2 text-sm text-slate-500">Configura lo que ven los pasajeros en Promociones y Seguridad.</p></div>
      <button class="hc-button" :disabled="state.loading || state.busy" @click="load"><RefreshCw class="h-4 w-4" :class="{ 'animate-spin': state.loading }" />Actualizar</button>
    </header>
    <p v-if="state.error && !editor" role="alert" class="hc-error">{{ state.error }}</p>
    <p v-if="state.success && !editor" role="status" class="hc-success">{{ state.success }}</p>
    <div class="flex gap-2 border-b border-slate-200 pb-3" aria-label="Secciones de inicio">
      <button v-for="(section, key) in meta" :key="key" class="hc-button" :class="active === key ? 'bg-slate-950 text-white' : 'bg-white'" @click="choose(key)"><component :is="section.icon" class="h-4 w-4" />{{ section.title }}</button>
    </div>
    <p v-if="state.loading" class="text-sm text-slate-500">Cargando contenido…</p>
    <template v-else-if="state.sections.length">
      <form class="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-[1fr_auto]" @submit.prevent="saveSection">
        <div><h2 class="font-semibold text-slate-950">{{ meta[active].title }}</h2><p class="mt-1 text-sm text-slate-500">{{ meta[active].description }}</p><label class="mt-4 flex items-center gap-2 text-sm"><input v-model="sectionForm.enabled" type="checkbox" />Mostrar esta sección en la app</label></div>
        <div class="flex flex-wrap items-end gap-3">
          <label class="hc-field">Orden de sección<input v-model.number="sectionForm.sortOrder" type="number" min="0" max="10000" required /></label>
          <label v-if="active === 'promotions'" class="hc-field">Carrusel (segundos)<input v-model.number="sectionForm.carouselIntervalSeconds" type="number" min="3" max="30" required /></label>
          <button class="hc-button" :disabled="state.busy"><Save class="h-4 w-4" />Guardar sección</button>
        </div>
      </form>
      <div class="flex flex-wrap items-center justify-between gap-3"><p class="text-sm text-slate-500">{{ active === 'safety' ? 'Solo una tarjeta de Seguridad puede estar publicada.' : 'El orden y la vigencia se aplican al publicar cada banner.' }}</p><button class="hc-button bg-slate-950 text-white" :disabled="state.busy" @click="edit()"><Plus class="h-4 w-4" />{{ active === 'safety' ? 'Nueva tarjeta' : 'Nueva promoción' }}</button></div>
      <div class="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <article v-for="item in items" :key="item.id" class="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <img v-if="imageFor(item)" :src="imageFor(item)" :alt="item.draft.altText" class="aspect-[16/7] w-full object-cover" />
          <div v-else class="grid aspect-[16/7] place-items-center bg-slate-100 text-slate-400"><component :is="meta[active].icon" class="h-10 w-10" /></div>
          <div class="space-y-3 p-4"><div class="flex items-center justify-between gap-2"><span class="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium">{{ status(item) }}</span><span class="text-xs text-slate-500">Orden {{ item.draft.sortOrder }}</span></div><h3 class="font-semibold">{{ item.draft.title }}</h3><p class="line-clamp-2 text-sm text-slate-500">{{ item.draft.summary }}</p><p v-if="item.published && JSON.stringify(item.draft) !== JSON.stringify(item.published)" class="text-xs text-amber-700">Hay cambios en borrador sin publicar.</p><div class="flex gap-2"><button class="hc-button" :disabled="state.busy" @click="edit(item)"><Eye class="h-4 w-4" />Editar y previsualizar</button><button v-if="item.status !== 'archived'" class="hc-button text-rose-700" :disabled="state.busy" @click="archive(item)">Archivar</button></div></div>
        </article>
      </div>
      <div v-if="!items.length" class="rounded-xl border border-dashed border-slate-300 p-12 text-center text-slate-500">Crea {{ active === 'safety' ? 'la primera tarjeta de seguridad' : 'el primer banner de promociones' }} para comenzar.</div>
      <details v-if="unusedAssets.length" class="rounded-xl border border-slate-200 bg-white p-4"><summary class="cursor-pointer text-sm font-medium">Imágenes sin uso ({{ unusedAssets.length }})</summary><p class="mt-2 text-xs text-slate-500">Puedes eliminar estas imágenes de R2: no están asociadas a borradores ni publicaciones.</p><div class="mt-3 flex flex-wrap gap-3"><div v-for="asset in unusedAssets" :key="asset.id" class="space-y-2 rounded-lg border border-slate-200 p-2"><img :src="asset.url" alt="Imagen sin uso" class="h-16 w-28 object-cover" /><button class="hc-button text-rose-700" :disabled="state.busy" @click="deleteAsset(asset)"><Trash2 class="h-3 w-3" />Eliminar</button></div></div></details>
    </template>
    <Teleport to="body">
      <div v-if="editor" class="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-3 md:p-6" role="dialog" aria-modal="true" aria-labelledby="home-editor-title" @keydown.esc="closeEditor">
        <section class="mx-auto max-w-6xl rounded-xl bg-white shadow-2xl">
          <header class="flex items-center justify-between gap-3 border-b border-slate-200 p-5"><div><h2 id="home-editor-title" class="text-xl font-semibold">{{ editor.id ? 'Editar' : 'Crear' }} · {{ meta[active].title }}</h2><p class="mt-1 text-sm text-slate-500">Guarda un borrador o publica cuando esté listo.</p></div><button class="hc-button" aria-label="Cerrar editor" :disabled="state.busy || state.uploading" @click="closeEditor"><X class="h-4 w-4" /></button></header>
          <form @submit.prevent="saveItem(false)">
            <fieldset :disabled="state.busy || state.uploading" class="grid min-w-0 gap-6 p-5 lg:grid-cols-[1.2fr_1fr]">
              <div class="min-w-0 space-y-4">
                <label class="hc-field">Título<input v-model="editor.content.title" maxlength="120" required /></label>
                <label class="hc-field">Resumen<textarea v-model="editor.content.summary" maxlength="500" rows="3" :required="active === 'safety'" /></label>
                <div class="rounded-lg border border-dashed border-slate-300 p-4"><p class="text-sm font-medium">Imagen {{ active === 'safety' ? '(opcional)' : 'del banner' }}</p><p class="mt-1 text-xs text-slate-500">JPEG, PNG o WEBP · máximo 5 MB · mínimo 320 × 160 px. Para banners se recomienda proporción 16:7; se recortan al centro.</p><input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" @change="uploadImage" /><div class="mt-3 flex gap-2"><button type="button" class="hc-button" @click="fileInput.click()"><ImagePlus class="h-4 w-4" />{{ state.uploading ? 'Subiendo…' : 'Cargar imagen' }}</button><button v-if="editor.content.assetId" type="button" class="hc-button" @click="editor.content.assetId = null">Quitar</button></div></div>
                <label class="hc-field">Texto alternativo de imagen<input v-model="editor.content.altText" maxlength="250" /></label>
                <div class="grid gap-3 sm:grid-cols-2"><label class="hc-field">Texto del botón<input v-model="editor.content.buttonLabel" maxlength="40" /></label><label class="hc-field">Orden<input v-model.number="editor.content.sortOrder" type="number" min="0" max="10000" required /></label></div>
                <label class="hc-field">Acción<select v-model="editor.content.action.type" :disabled="active === 'safety'"><option value="detail">Abrir pantalla de detalle</option><option value="request_ride">Pedir un viaje</option><option value="external">Abrir enlace HTTPS</option></select></label>
                <label v-if="editor.content.action.type === 'external'" class="hc-field">Enlace<input v-model="editor.content.action.url" type="url" placeholder="https://" required /></label>
                <div class="grid gap-3 sm:grid-cols-2"><label class="hc-field">Inicio (opcional)<input type="datetime-local" :value="localDate(editor.content.startsAt)" @input="setDate('startsAt', $event.target.value)" /></label><label class="hc-field">Fin (opcional)<input type="datetime-local" :value="localDate(editor.content.endsAt)" @input="setDate('endsAt', $event.target.value)" /></label></div><p class="text-xs text-slate-500">Las fechas usan la zona horaria de tu navegador y se guardan en UTC.</p>
                <section class="space-y-3"><h3 class="text-sm font-semibold">Contenido de la pantalla de detalle</h3><div v-for="(block, index) in editor.content.blocks" :key="index" class="space-y-2 rounded-lg border border-slate-200 p-3"><div class="flex gap-2"><select v-model="block.type" class="hc-input flex-1" :aria-label="`Tipo del bloque ${index + 1}`"><option value="heading">Encabezado</option><option value="paragraph">Párrafo</option><option value="bullet">Recomendación</option></select><button type="button" class="hc-button" :aria-label="`Subir bloque ${index + 1}`" :disabled="index === 0" @click="editor.content.blocks.splice(index - 1, 0, editor.content.blocks.splice(index, 1)[0])">↑</button><button type="button" class="hc-button" aria-label="Eliminar bloque" @click="editor.content.blocks.splice(index, 1)"><X class="h-4 w-4" /></button></div><textarea v-model="block.text" class="hc-input w-full" maxlength="3000" rows="3" :aria-label="`Texto del bloque ${index + 1}`" required /></div><button type="button" class="hc-button" :disabled="editor.content.blocks.length >= 40" @click="editor.content.blocks.push({ type: 'paragraph', text: '' })"><Plus class="h-4 w-4" />Agregar bloque</button></section>
              </div>
              <aside class="min-w-0"><div class="sticky top-4 space-y-4"><div class="flex flex-wrap items-center justify-between gap-2"><h3 class="text-sm font-semibold">Vista previa móvil</h3><label v-if="editor.published" class="flex items-center gap-2 text-xs"><input v-model="previewPublished" type="checkbox" />Ver versión publicada</label></div><div class="mx-auto max-w-sm rounded-[2rem] border-8 border-slate-900 bg-slate-50 p-4"><p class="mb-4 text-lg font-semibold">{{ meta[active].title }}</p><article class="overflow-hidden rounded-xl bg-white shadow-sm"><img v-if="previewAsset" :src="previewAsset.url" :alt="preview.altText" class="aspect-[16/7] w-full object-cover" /><div v-else class="grid aspect-[16/7] place-items-center bg-emerald-50 text-emerald-700"><component :is="meta[active].icon" class="h-12 w-12" /></div><div class="space-y-2 p-4"><h4 class="font-semibold">{{ preview.title || 'Título de la tarjeta' }}</h4><p class="whitespace-pre-line text-sm text-slate-500">{{ preview.summary || 'Descripción del contenido' }}</p><span class="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">{{ preview.buttonLabel || 'Descubre más' }}<ArrowRight class="h-4 w-4" /></span></div></article><div v-if="preview.action.type === 'detail'" class="mt-5 space-y-3 border-t border-slate-200 pt-4"><p class="text-xs uppercase tracking-wide text-slate-400">Pantalla de detalle</p><h4 class="text-lg font-semibold">{{ preview.title }}</h4><template v-for="(block, index) in preview.blocks" :key="index"><h5 v-if="block.type === 'heading'" class="font-semibold">{{ block.text }}</h5><p v-else class="whitespace-pre-line text-sm text-slate-600">{{ block.type === 'bullet' ? '• ' : '' }}{{ block.text }}</p></template></div></div><p class="text-xs text-slate-500">Vista de referencia. La app móvil consumirá este contenido mediante la API.</p></div></aside>
            </fieldset>
            <footer class="sticky bottom-0 space-y-3 rounded-b-xl border-t border-slate-200 bg-white p-4"><p v-if="state.error" role="alert" class="hc-error">{{ state.error }}</p><p v-if="state.success" role="status" class="hc-success">{{ state.success }}</p><div class="flex flex-wrap justify-end gap-2"><button v-if="editor.id" type="button" class="hc-button" :disabled="state.busy || state.uploading" @click="edit(state.items.find(i => i.id === editor.id))">Recargar guardado</button><button type="button" class="hc-button" :disabled="state.busy || state.uploading" @click="closeEditor">Cerrar</button><button class="hc-button" :disabled="state.busy || state.uploading"><Save class="h-4 w-4" />Guardar borrador</button><button type="button" class="hc-button bg-emerald-700 text-white" :disabled="state.busy || state.uploading" @click="saveItem(true)">{{ state.busy ? 'Procesando…' : 'Guardar y publicar' }}</button></div></footer>
          </form>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
@reference "../../../style.css";
.hc-button { display: inline-flex; align-items: center; justify-content: center; gap: .5rem; border: 1px solid #e2e8f0; border-radius: .5rem; padding: .5rem .75rem; font-size: .875rem; font-weight: 500; cursor: pointer; }
.hc-button:disabled { opacity: .5; cursor: not-allowed; }
.hc-field { display: flex; flex-direction: column; gap: .375rem; color: #475569; font-size: .75rem; font-weight: 500; }
.hc-field input:not([type=checkbox]), .hc-field textarea, .hc-field select, .hc-input { min-width: 0; border: 1px solid #cbd5e1; border-radius: .5rem; background: white; padding: .625rem .75rem; font: inherit; font-size: .875rem; color: #0f172a; }
.hc-error { border-radius: .5rem; background: #fff1f2; color: #be123c; padding: .75rem; font-size: .875rem; }
.hc-success { border-radius: .5rem; background: #ecfdf5; color: #047857; padding: .75rem; font-size: .875rem; }
</style>
