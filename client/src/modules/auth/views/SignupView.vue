<script setup>
import { computed, reactive, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { signUp } from "../services/auth.service.js";

const router = useRouter();

const form = reactive({
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  confirmPassword: "",
  accountType: "client",
});

const loading = ref(false);
const errorMessage = ref("");

const isFormValid = computed(() => {
  return (
    !!form.firstName &&
    !!form.lastName &&
    !!form.email &&
    !!form.password &&
    form.password.length >= 6 &&
    form.password === form.confirmPassword
  );
});

async function handleSubmit() {
  if (!isFormValid.value || loading.value) return;

  loading.value = true;
  errorMessage.value = "";

  try {
    await signUp({
      email: form.email,
      password: form.password,
      firstName: form.firstName,
      lastName: form.lastName,
      accountType: form.accountType,
      ...(form.accountType === "driver"
        ? {
            driverProfile: {
              licenseNumber: "PENDING-LICENSE",
              vehicleMake: "Unknown",
              vehicleModel: "Unknown",
              vehiclePlate: `TEMP-${Date.now()}`,
            },
          }
        : {}),
    });

    router.push({ name: "login", query: { registered: "true" } });
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="screen auth-screen" data-node-id="1:18">
    <header class="screen-header">
      <RouterLink to="/login" class="back-arrow" aria-label="Go to login">‹</RouterLink>
    </header>

    <h1 class="screen-title">Finish Signing up</h1>
    <p class="screen-subtitle">Complete your profile details and create your account.</p>

    <p v-if="errorMessage" class="banner error">{{ errorMessage }}</p>

    <form class="stack" @submit.prevent="handleSubmit">
      <label class="field">
        <span>First Name</span>
        <input v-model.trim="form.firstName" type="text" autocomplete="given-name" required />
      </label>

      <label class="field">
        <span>Last Name</span>
        <input v-model.trim="form.lastName" type="text" autocomplete="family-name" required />
      </label>

      <label class="field">
        <span>Email</span>
        <input v-model.trim="form.email" type="email" autocomplete="email" required />
      </label>

      <label class="field">
        <span>Account Type</span>
        <select v-model="form.accountType">
          <option value="client">Client</option>
          <option value="driver">Driver</option>
        </select>
      </label>

      <label class="field">
        <span>Password</span>
        <input v-model="form.password" type="password" autocomplete="new-password" required />
      </label>

      <label class="field">
        <span>Confirm Password</span>
        <input v-model="form.confirmPassword" type="password" autocomplete="new-password" required />
      </label>

      <button class="primary-btn dark" type="submit" :disabled="!isFormValid || loading">
        {{ loading ? "Creating profile..." : "Complete Profile" }}
      </button>
    </form>

    <p class="footer-link">
      Already registered?
      <RouterLink to="/login">Log in</RouterLink>
    </p>
  </section>
</template>
