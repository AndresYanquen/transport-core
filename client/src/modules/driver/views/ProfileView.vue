<script setup>
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { clearSession, sessionRole, sessionState } from "../../../stores/session.js";
import { updateDriverStatus } from "../services/driver.service.js";

const router = useRouter();
const status = ref("online");
const loading = ref(false);
const message = ref("");
const errorMessage = ref("");

const canManageDriverStatus = computed(() => {
  return sessionRole.value === "driver" || sessionRole.value === "admin";
});

async function saveStatus() {
  const driverId = sessionState.user?.id;
  if (!driverId) {
    errorMessage.value = "Missing authenticated driver profile.";
    return;
  }

  loading.value = true;
  message.value = "";
  errorMessage.value = "";

  try {
    await updateDriverStatus(driverId, status.value);
    message.value = "Driver status updated.";
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    loading.value = false;
  }
}

function handleLogout() {
  clearSession();
  router.push({ name: "login" });
}
</script>

<template>
  <section class="screen profile-screen">
    <h1 class="profile-title">Profile</h1>

    <article class="profile-card">
      <p class="profile-label">Account</p>
      <h2>{{ sessionState.user?.firstName || "User" }} {{ sessionState.user?.lastName || "" }}</h2>
      <p>{{ sessionState.user?.email }}</p>
      <p class="role-pill">Role: {{ sessionRole }}</p>
    </article>

    <article v-if="canManageDriverStatus" class="outline-card">
      <h3>Driver Availability</h3>
      <p v-if="message" class="banner success">{{ message }}</p>
      <p v-if="errorMessage" class="banner error">{{ errorMessage }}</p>

      <form class="stack" @submit.prevent="saveStatus">
        <label class="field">
          <span>Status</span>
          <select v-model="status">
            <option value="online">Online</option>
            <option value="busy">Busy</option>
            <option value="unavailable">Unavailable</option>
            <option value="offline">Offline</option>
          </select>
        </label>

        <button class="small-dark-btn" type="submit" :disabled="loading">
          {{ loading ? "Saving..." : "Save status" }}
        </button>
      </form>
    </article>

    <button class="logout-btn" type="button" @click="handleLogout">Logout</button>
  </section>
</template>
