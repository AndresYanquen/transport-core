<script setup>
import { ArrowLeft, Mail, ShieldCheck, UserX } from "lucide-vue-next";
import { RouterLink } from "vue-router";

import goTaxiLogo from "@/assets/images/logo/gottaxi.png";

const lastUpdated = "20 de agosto de 2026";

const requestEmail = "privacy@gottaxi.co";
const mailtoHref = `mailto:${requestEmail}?subject=${encodeURIComponent(
  "Solicitud de eliminación de cuenta y datos - GoTaxi"
)}&body=${encodeURIComponent(
  "Hola GoTaxi,\n\nSolicito la eliminación de mi cuenta y los datos personales asociados.\n\nNombre completo:\nCorreo o teléfono asociado a la cuenta:\nRol en la app (cliente, conductor, operador o administrador):\n\nGracias."
)}`;

const requestSteps = [
  "Envía la solicitud desde el correo asociado a tu cuenta, si tienes acceso a él.",
  "Incluye tu nombre completo, correo o teléfono asociado y tu rol en la app.",
  "Nuestro equipo puede pedir información adicional para verificar tu identidad antes de procesar la solicitud.",
];

const deletionScope = [
  "Datos de perfil y contacto asociados a la cuenta.",
  "Credenciales o accesos activos de la cuenta.",
  "Datos personales que no deban conservarse por obligaciones legales, seguridad, auditoría, prevención de fraude o registros operativos necesarios.",
];
</script>

<template>
  <main class="deletion-page">
    <header class="deletion-nav">
      <RouterLink class="brand" :to="{ name: 'landing' }" aria-label="GoTaxi">
        <span class="brand-logo">
          <img :src="goTaxiLogo" alt="" />
        </span>
        <span>GoTaxi</span>
      </RouterLink>

      <RouterLink class="back-link" :to="{ name: 'landing' }">
        <ArrowLeft :size="18" />
        <span>Volver</span>
      </RouterLink>
    </header>

    <section class="deletion-hero">
      <p class="eyebrow">Account deletion</p>
      <h1>Solicita la eliminación de tu cuenta</h1>
      <p>
        GoTaxi no permite crear cuentas directamente desde la app. Si tu cuenta fue
        creada por un administrador o por el equipo operativo, puedes solicitar que
        sea eliminada junto con los datos personales asociados.
      </p>
      <div class="hero-meta">
        <span><UserX :size="18" /> Solicitud por correo</span>
        <span><ShieldCheck :size="18" /> Última actualización: {{ lastUpdated }}</span>
      </div>
    </section>

    <section class="deletion-content" aria-label="Solicitud de eliminación de cuenta">
      <article class="request-card">
        <div>
          <h2>Enviar solicitud</h2>
          <p>
            Usa este enlace para contactar al equipo de privacidad y pedir la eliminación
            de tu cuenta y datos asociados.
          </p>
        </div>
        <a :href="mailtoHref">
          <Mail :size="18" />
          Solicitar eliminación
        </a>
      </article>

      <article class="info-card">
        <h2>Qué debes incluir</h2>
        <ul>
          <li v-for="step in requestSteps" :key="step">{{ step }}</li>
        </ul>
      </article>

      <article class="info-card">
        <h2>Qué datos se eliminan</h2>
        <ul>
          <li v-for="item in deletionScope" :key="item">{{ item }}</li>
        </ul>
      </article>

      <article class="info-card">
        <h2>Datos que podrían conservarse</h2>
        <p>
          Algunos registros pueden conservarse cuando sean necesarios para cumplir la ley,
          resolver disputas, prevenir fraude, mantener seguridad, completar obligaciones
          contables o preservar trazabilidad operativa de servicios prestados.
        </p>
      </article>

      <article class="info-card">
        <h2>Contacto directo</h2>
        <p>
          También puedes escribir directamente a
          <a :href="`mailto:${requestEmail}`">{{ requestEmail }}</a>.
        </p>
      </article>
    </section>
  </main>
</template>

<style scoped>
.deletion-page {
  --page-max-width: 980px;
  --page-gutter: 24px;
  --page-bg: #050e1f;
  --page-surface: rgba(16, 31, 62, 0.68);
  --page-border: rgba(129, 152, 190, 0.22);
  --page-text: #f8fbff;
  --page-muted: #b9c4d2;
  --page-accent: #58e8b4;
  --page-ink-on-accent: #052016;

  min-height: 100vh;
  color: var(--page-text);
  background:
    linear-gradient(180deg, rgba(4, 12, 28, 0.94), rgba(4, 13, 31, 0.99)),
    url("data:image/svg+xml,%3Csvg width='1600' height='1000' viewBox='0 0 1600 1000' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.72' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='1600' height='1000' filter='url(%23n)' opacity='.1'/%3E%3C/svg%3E");
}

.deletion-nav,
.deletion-hero,
.deletion-content {
  width: min(100% - (var(--page-gutter) * 2), var(--page-max-width));
  margin: 0 auto;
}

.deletion-nav {
  min-height: 78px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.brand,
.back-link,
.hero-meta span,
.request-card a {
  display: inline-flex;
  align-items: center;
}

.brand {
  gap: 12px;
  color: #fff;
  font-size: 20px;
  font-weight: 800;
}

.brand-logo {
  display: inline-flex;
  width: 72px;
  height: 48px;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.94);
  padding: 5px 7px;
}

.brand-logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.back-link {
  gap: 8px;
  border: 1px solid color-mix(in srgb, var(--page-accent) 52%, transparent);
  border-radius: 8px;
  padding: 10px 14px;
  color: var(--page-accent);
  font-size: 14px;
  font-weight: 700;
}

.deletion-hero {
  padding: 54px 0 34px;
}

.eyebrow {
  margin: 0 0 14px;
  color: var(--page-accent);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.deletion-hero h1 {
  max-width: 780px;
  margin: 0;
  font-size: clamp(40px, 7vw, 72px);
  font-weight: 800;
  letter-spacing: 0;
  line-height: 1;
}

.deletion-hero > p {
  max-width: 780px;
  margin: 22px 0 0;
  color: var(--page-muted);
  font-size: 18px;
  line-height: 1.7;
}

.hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 24px;
}

.hero-meta span {
  gap: 8px;
  border: 1px solid var(--page-border);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  padding: 9px 13px;
  color: #d8e1ee;
  font-size: 14px;
}

.hero-meta svg,
.info-card a {
  color: var(--page-accent);
}

.deletion-content {
  display: grid;
  gap: 14px;
  padding: 10px 0 72px;
}

.request-card,
.info-card {
  border: 1px solid var(--page-border);
  border-radius: 10px;
  background: var(--page-surface);
  padding: clamp(20px, 3vw, 30px);
  box-shadow: 0 20px 54px rgba(0, 0, 0, 0.22);
}

.request-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.request-card h2,
.info-card h2 {
  margin: 0 0 12px;
  color: #fff;
  font-size: 20px;
  font-weight: 800;
}

.request-card p,
.info-card p,
.info-card li {
  color: var(--page-muted);
  font-size: 15px;
  line-height: 1.75;
}

.request-card p,
.info-card p {
  margin: 0;
}

.info-card ul {
  margin: 0;
  padding-left: 20px;
}

.info-card li + li {
  margin-top: 8px;
}

.request-card a {
  flex: 0 0 auto;
  gap: 8px;
  border-radius: 8px;
  background: var(--page-accent);
  padding: 12px 16px;
  color: var(--page-ink-on-accent);
  font-weight: 800;
}

@media (max-width: 720px) {
  .deletion-page {
    --page-gutter: 16px;
  }

  .deletion-nav {
    min-height: 70px;
  }

  .brand {
    font-size: 18px;
  }

  .brand-logo {
    width: 62px;
    height: 42px;
  }

  .deletion-hero {
    padding-top: 36px;
  }

  .deletion-hero h1 {
    font-size: 40px;
  }

  .deletion-hero > p {
    font-size: 16px;
  }

  .request-card {
    align-items: stretch;
    flex-direction: column;
  }

  .request-card a {
    justify-content: center;
  }
}
</style>
