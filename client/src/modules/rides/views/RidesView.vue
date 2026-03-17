<script setup>
import { computed, onMounted, ref } from "vue";
import { listRides } from "../services/rides.service.js";
import { sessionState } from "../../../stores/session.js";

const rides = ref([]);
const loading = ref(true);
const errorMessage = ref("");

const topRides = computed(() => rides.value.slice(0, 3));

async function fetchRides() {
  loading.value = true;
  errorMessage.value = "";

  try {
    rides.value = await listRides();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    loading.value = false;
  }
}

onMounted(fetchRides);
</script>

<template>
  <section class="screen home-screen" data-node-id="1:22">
    <div class="home-hero-shape"></div>

    <h1 class="home-title">Hi, {{ sessionState.user?.firstName || "there" }}</h1>

    <div class="search-box">
      <span class="search-icon">◌</span>
      <span>Where are you going?</span>
    </div>

    <div class="quick-actions">
      <button class="chip">⏱ Schedule</button>
      <button class="chip">◎ Change Ride</button>
    </div>

    <div class="locations-list">
      <div class="location-item" v-for="(ride, index) in topRides" :key="ride.id">
        <span class="location-dot">◎</span>
        <div>
          <strong>{{ ride.pickupAddress || `Saved place ${index + 1}` }}</strong>
          <p>{{ ride.dropoffAddress || ride.status || "No destination yet" }}</p>
        </div>
      </div>

      <div class="location-item" v-if="!loading && !topRides.length">
        <span class="location-dot">⌂</span>
        <div>
          <strong>Home</strong>
          <p>Add your first ride to see recent locations</p>
        </div>
      </div>
    </div>

    <h2 class="section-title">You are here</h2>
    <p v-if="errorMessage" class="banner error">{{ errorMessage }}</p>

    <div class="map-card" :class="{ loading }">
      <div class="map-grid"></div>
      <span class="map-pin">Current Location</span>
      <span class="map-car car-a">🚕</span>
      <span class="map-car car-b">🚕</span>
      <span class="map-car car-c">🚕</span>
      <span class="map-car car-d">🚕</span>
    </div>
  </section>
</template>
