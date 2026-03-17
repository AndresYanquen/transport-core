<script setup>
import { computed, reactive, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { logIn } from "../services/auth.service.js";
import { setSession } from "../../../stores/session.js";

const router = useRouter();
const route = useRoute();

const form = reactive({
  email: "",
  password: "",
});

const loading = ref(false);
const errorMessage = ref("");

const infoMessage = computed(() => {
  if (route.query.registered) return "Account created. You can log in now.";
  if (route.query.reason === "expired") return "Your session expired. Please log in again.";
  if (route.query.reason === "unauthorized") return "Your session is no longer valid. Please log in again.";
  if (route.query.reason === "required") return "Please log in to continue.";
  return "";
});

const isFormValid = computed(() => !!form.email && !!form.password);

async function handleSubmit() {
  if (!isFormValid.value || loading.value) return;

  loading.value = true;
  errorMessage.value = "";

  try {
    const session = await logIn({ email: form.email, password: form.password });
    setSession(session);

    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/";
    router.push(redirect);
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="screen auth-screen" data-node-id="1:24">
    <header class="screen-header">
      <RouterLink to="/signup" class="back-arrow" aria-label="Go to signup">‹</RouterLink>
    </header>

    <h1 class="screen-title">Welcome aboard or back</h1>
    <p class="screen-subtitle">To sign in, enter your email and password</p>

    <p v-if="infoMessage" class="banner success">{{ infoMessage }}</p>
    <p v-if="errorMessage" class="banner error">{{ errorMessage }}</p>

    <form class="stack" @submit.prevent="handleSubmit">
      <label class="field">
        <span>Email</span>
        <input v-model.trim="form.email" type="email" autocomplete="email" placeholder="you@example.com" required />
      </label>

      <label class="field">
        <span>Password</span>
        <input v-model="form.password" type="password" autocomplete="current-password" placeholder="••••••••" required />
      </label>

      <button class="primary-btn dark" type="submit" :disabled="!isFormValid || loading">
        {{ loading ? "Logging in..." : "Continue" }}
      </button>
    </form>

    <p class="footer-link">
      New here?
      <RouterLink to="/signup">Finish signup</RouterLink>
    </p>
  </section>
</template>
