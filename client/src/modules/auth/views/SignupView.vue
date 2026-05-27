<script setup>
import { computed, reactive, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { signUp } from "../services/auth.service.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <Card class="border-none bg-transparent shadow-none">
      <CardContent class="px-0 pt-0">
        <header class="screen-header">
          <RouterLink to="/login" class="back-arrow" aria-label="Go to login">‹</RouterLink>
        </header>

        <h1 class="screen-title">Finish Signing up</h1>
        <p class="screen-subtitle">Complete your profile details and create your account.</p>

        <p v-if="errorMessage" class="banner error">{{ errorMessage }}</p>

        <form class="stack" @submit.prevent="handleSubmit">
          <div class="field">
            <Label for="firstName">First Name</Label>
            <Input id="firstName" v-model.trim="form.firstName" type="text" autocomplete="given-name" required />
          </div>

          <div class="field">
            <Label for="lastName">Last Name</Label>
            <Input id="lastName" v-model.trim="form.lastName" type="text" autocomplete="family-name" required />
          </div>

          <div class="field">
            <Label for="signupEmail">Email</Label>
            <Input id="signupEmail" v-model.trim="form.email" type="email" autocomplete="email" required />
          </div>

          <div class="field">
            <Label for="accountType">Account Type</Label>
            <select id="accountType" v-model="form.accountType">
              <option value="client">Client</option>
              <option value="driver">Driver</option>
            </select>
          </div>

          <div class="field">
            <Label for="signupPassword">Password</Label>
            <Input id="signupPassword" v-model="form.password" type="password" autocomplete="new-password" required />
          </div>

          <div class="field">
            <Label for="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              v-model="form.confirmPassword"
              type="password"
              autocomplete="new-password"
              required
            />
          </div>

          <Button
            type="submit"
            class="primary-btn dark h-auto w-full py-4 text-base font-semibold"
            :disabled="!isFormValid || loading"
          >
            {{ loading ? "Creating profile..." : "Complete Profile" }}
          </Button>
        </form>

        <p class="footer-link">
          Already registered?
          <RouterLink to="/login">Log in</RouterLink>
        </p>
      </CardContent>
    </Card>
  </section>
</template>
