<script setup>
import { computed, reactive, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { logIn } from "../services/auth.service.js";
import { setSession } from "../../../stores/session.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <Card class="border-none bg-transparent shadow-none">
      <CardContent class="px-0 pt-0">
        <header class="screen-header">
          <RouterLink to="/signup" class="back-arrow" aria-label="Go to signup">‹</RouterLink>
        </header>

        <h1 class="screen-title">Welcome aboard or back</h1>
        <p class="screen-subtitle">To sign in, enter your email and password</p>

        <p v-if="infoMessage" class="banner success">{{ infoMessage }}</p>
        <p v-if="errorMessage" class="banner error">{{ errorMessage }}</p>

        <form class="stack" @submit.prevent="handleSubmit">
          <div class="field">
            <Label for="email">Email</Label>
            <Input
              id="email"
              v-model.trim="form.email"
              type="email"
              autocomplete="email"
              placeholder="you@example.com"
              required
            />
          </div>

          <div class="field">
            <Label for="password">Password</Label>
            <Input
              id="password"
              v-model="form.password"
              type="password"
              autocomplete="current-password"
              placeholder="••••••••"
              required
            />
          </div>

          <Button
            type="submit"
            class="primary-btn dark h-auto w-full py-4 text-base font-semibold"
            :disabled="!isFormValid || loading"
          >
            {{ loading ? "Logging in..." : "Continue" }}
          </Button>
        </form>

        <p class="footer-link">
          New here?
          <RouterLink to="/signup">Finish signup</RouterLink>
        </p>
        <p class="footer-link">
          Driver?
          <RouterLink to="/driver-login">Use driver login</RouterLink>
        </p>
      </CardContent>
    </Card>
  </section>
</template>
