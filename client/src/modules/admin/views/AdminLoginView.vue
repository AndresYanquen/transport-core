<script setup>
import { computed, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Eye, EyeOff, LockKeyhole, LogIn, ShieldCheck } from "lucide-vue-next";
import { useAuthStore } from "../../../stores/auth.js";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const passwordVisible = ref(false);
const isOperatorLogin = computed(() => route.meta.loginRole === "operator");

const form = reactive({
  email: "",
  password: "",
  rememberMe: true,
});

const destination = computed(() => {
  const redirect = route.query.redirect;
  if (typeof redirect === "string" && redirect.startsWith("/")) return redirect;
  return isOperatorLogin.value ? "/operator" : "/admin/dashboard";
});

async function submit() {
  try {
    await auth.login(form);
    const role = String(auth.state.user?.role || "").toLowerCase();
    const expectedRole = isOperatorLogin.value ? "operator" : "admin";
    if (role !== expectedRole) {
      auth.logout();
      auth.state.error = `Esta cuenta no tiene rol de ${isOperatorLogin.value ? "operadora" : "administrador"}.`;
      return;
    }
    await router.replace(destination.value);
  } catch {
    // The auth store owns the user-facing error message.
  }
}
</script>

<template>
  <main class="grid min-h-screen bg-slate-950 text-slate-100 lg:grid-cols-[minmax(420px,0.8fr)_1fr]">
    <section class="flex min-h-screen items-center justify-center px-5 py-8">
      <form
        class="w-full max-w-[420px] rounded-lg border border-white/10 bg-white p-6 text-slate-950 shadow-2xl shadow-black/20"
        @submit.prevent="submit"
      >
        <div class="mb-6 flex items-start justify-between gap-4">
          <div>
            <div class="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md bg-slate-950 text-white">
              <LockKeyhole class="h-5 w-5" />
            </div>
            <h1 class="text-2xl font-semibold tracking-normal text-slate-950">
              {{ isOperatorLogin ? "Ingreso de operadora" : "Admin sign in" }}
            </h1>
            <p class="mt-1 text-sm leading-6 text-slate-600">
              {{ isOperatorLogin
                ? "Usa una cuenta de operadora para acceder al centro de operaciones."
                : "Use an administrator account to access operations." }}
            </p>
          </div>
        </div>

        <div v-if="auth.state.error" class="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {{ auth.state.error }}
        </div>

        <div class="grid gap-4">
          <label class="grid gap-1.5 text-sm font-medium text-slate-800">
            Email
            <input
              v-model.trim="form.email"
              autocomplete="email"
              class="h-10 rounded-md border border-slate-300 px-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
              name="email"
              :placeholder="isOperatorLogin ? 'operator1@example.com' : 'admin@example.com'"
              required
              type="email"
            />
          </label>

          <label class="grid gap-1.5 text-sm font-medium text-slate-800">
            Password
            <span class="relative">
              <input
                v-model="form.password"
                autocomplete="current-password"
                class="h-10 w-full rounded-md border border-slate-300 py-2 pl-3 pr-10 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                name="password"
                required
                :type="passwordVisible ? 'text' : 'password'"
              />
              <button
                :aria-label="passwordVisible ? 'Hide password' : 'Show password'"
                :aria-pressed="passwordVisible"
                class="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center text-slate-500 transition hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-900"
                type="button"
                @click="passwordVisible = !passwordVisible"
              >
                <EyeOff v-if="passwordVisible" class="h-4 w-4" aria-hidden="true" />
                <Eye v-else class="h-4 w-4" aria-hidden="true" />
              </button>
            </span>
          </label>

          <label class="flex items-center gap-2 text-sm text-slate-700">
            <input
              v-model="form.rememberMe"
              class="h-4 w-4 rounded border-slate-300 text-slate-950"
              type="checkbox"
            />
            Keep me signed in
          </label>

          <button
            class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="auth.state.loading"
            type="submit"
          >
            <LogIn class="h-4 w-4" />
            {{ auth.state.loading ? "Signing in..." : "Sign in" }}
          </button>
        </div>
      </form>
    </section>

    <section class="hidden min-h-screen border-l border-white/10 bg-slate-900 px-10 py-8 lg:flex lg:flex-col lg:justify-between">
      <div class="flex items-center gap-2 text-sm font-medium text-slate-300">
        <ShieldCheck class="h-4 w-4 text-emerald-300" />
        {{ isOperatorLogin ? "Centro de operaciones" : "Taxi operations admin" }}
      </div>

      <div class="max-w-xl">
        <p class="text-sm font-medium uppercase tracking-[0.18em] text-emerald-300">Protected workspace</p>
        <h2 class="mt-4 text-5xl font-semibold leading-tight tracking-normal text-white">
          {{ isOperatorLogin
            ? "Gestiona solicitudes, asignaciones, conductores e incidencias desde un solo lugar."
            : "Monitor rides, drivers, and operational state from one secured panel." }}
        </h2>
        <p class="mt-5 text-base leading-7 text-slate-300">
          El acceso usa la sesión JWT del API y respeta los permisos configurados para cada rol.
        </p>
      </div>

      <div class="grid grid-cols-3 gap-3 text-sm text-slate-300">
        <div class="rounded-md border border-white/10 p-3">
          <div class="text-white">JWT</div>
          <div class="mt-1 text-slate-400">Bearer auth</div>
        </div>
        <div class="rounded-md border border-white/10 p-3">
          <div class="text-white">Role</div>
          <div class="mt-1 text-slate-400">{{ isOperatorLogin ? "Operator only" : "Admin only" }}</div>
        </div>
        <div class="rounded-md border border-white/10 p-3">
          <div class="text-white">Session</div>
          <div class="mt-1 text-slate-400">Restored on load</div>
        </div>
      </div>
    </section>
  </main>
</template>
