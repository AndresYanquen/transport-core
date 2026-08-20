<script setup>
import {
  ArrowRight,
  BarChart3,
  Bell,
  Calendar,
  CheckCircle2,
  LayoutDashboard,
  MapPin,
  ShieldCheck,
  Users,
  Zap,
} from "lucide-vue-next";

import adminMapPreview from "@/assets/landing/admin-map-preview.jpg";
import goTaxiLogo from "@/assets/images/logo/gottaxi.png";

const featureCards = [
  {
    icon: LayoutDashboard,
    title: "Monitoreo en tiempo real",
    text: "Controla viajes, conductores e incidentes mientras ocurren.",
  },
  {
    icon: MapPin,
    title: "Mapa operativo",
    text: "Visualiza actividad, zonas y puntos de alta demanda.",
  },
  {
    icon: Users,
    title: "Gestión de equipos",
    text: "Administra operadores, roles y permisos por operación.",
  },
  {
    icon: BarChart3,
    title: "Reportes claros",
    text: "Toma decisiones con métricas útiles y accionables.",
  },
  {
    icon: ShieldCheck,
    title: "Seguridad primero",
    text: "JWT, accesos por rol y operación protegida.",
  },
  {
    icon: Bell,
    title: "Alertas operativas",
    text: "Recibe señales sobre eventos que requieren atención.",
  },
];

</script>

<template>
  <main class="landing-page">
    <header class="landing-nav">
      <RouterLink class="brand" :to="{ name: 'landing' }" aria-label="GoTaxi Admin">
        <img :src="goTaxiLogo" alt="" />
        <span>GoTaxi Admin</span>
      </RouterLink>

      <nav class="nav-links" aria-label="Principal">
        <a href="#features">Funciones</a>
        <a href="#security">Seguridad</a>
        <a href="#dashboard">Dashboard</a>
        <a href="#pricing">Planes</a>
        <a href="#contact">Contacto</a>
      </nav>

      <RouterLink class="login-link" :to="{ name: 'admin-login' }">
        <span>Admin login</span>
        <ArrowRight :size="18" />
      </RouterLink>
    </header>

    <section class="hero-section">
      <div class="hero-copy">
        <p class="eyebrow">Taxi operations admin</p>
        <h1>Controla tu operación. Protege tus pasajeros. Crece con <span>confianza.</span></h1>
        <p class="hero-text">
          GoTaxi Admin centraliza viajes, conductores y datos operativos en tiempo real
          para tomar mejores decisiones, más rápido.
        </p>

        <div class="hero-actions">
          <a class="primary-cta" href="#contact">
            <Calendar :size="20" />
            <span>Solicitar demo</span>
          </a>
          <a class="secondary-cta" href="#features">
            <span>Explorar funciones</span>
            <ArrowRight :size="20" />
          </a>
        </div>

        <div class="trust-row" aria-label="Beneficios clave">
          <span><ShieldCheck :size="20" /> Seguro por diseño</span>
          <span><Zap :size="20" /> Datos en tiempo real</span>
          <span><Users :size="20" /> Acceso por roles</span>
        </div>
      </div>

      <section id="dashboard" class="dashboard-preview" aria-label="Vista previa del dashboard">
        <div class="preview-window">
          <div class="window-dots" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <img
            :src="adminMapPreview"
            alt="Vista del mapa de conductores en GoTaxi Admin"
          />
        </div>
      </section>
    </section>

    <section id="features" class="features-section">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Built for operations</p>
          <h2>Todo lo que necesitas, en un solo lugar.</h2>
        </div>
        <p>
          Herramientas para administrar flota, empoderar a tu equipo y entregar un
          servicio más confiable.
        </p>
      </div>

      <div class="landing-feature-grid">
        <article v-for="feature in featureCards" :key="feature.title" class="landing-feature-card">
          <component :is="feature.icon" :size="34" />
          <h3>{{ feature.title }}</h3>
          <p>{{ feature.text }}</p>
        </article>
      </div>

      <div class="proof-grid" id="security">
        <article>
          <ShieldCheck :size="42" />
          <div>
            <strong>Seguridad empresarial</strong>
            <span>Datos protegidos y operación controlada.</span>
          </div>
        </article>
        <article>
          <CheckCircle2 :size="42" />
          <div>
            <strong>99.9% uptime</strong>
            <span>Infraestructura lista para operación diaria.</span>
          </div>
        </article>
        <article id="pricing">
          <Users :size="42" />
          <div>
            <strong>Construido para equipos</strong>
            <span>Diseñado para administradores y operadoras.</span>
          </div>
        </article>
      </div>
    </section>

    <section id="contact" class="contact-section">
      <div class="contact-copy">
        <p class="eyebrow">Empieza ahora</p>
        <h2>Activa una operación más clara y medible.</h2>
        <p>
          Conecta tu equipo, visualiza conductores en mapa y toma decisiones con datos
          operativos desde el primer día.
        </p>
        <div class="contact-metrics" aria-label="Beneficios de implementación">
          <span><CheckCircle2 :size="18" /> Panel en tiempo real</span>
          <span><ShieldCheck :size="18" /> Acceso por roles</span>
        </div>
      </div>
      <div class="contact-actions">
        <RouterLink class="contact-primary-cta" :to="{ name: 'admin-login' }">
          <span>Ir al panel</span>
          <ArrowRight :size="20" />
        </RouterLink>
        <a class="contact-secondary-cta" href="#dashboard">Ver producto</a>
        <RouterLink class="contact-policy-link" :to="{ name: 'privacy-policy' }">
          Privacy Policy
        </RouterLink>
      </div>
    </section>
  </main>
</template>

<style scoped>
.landing-page {
  --landing-max-width: 1320px;
  --landing-page-gutter: 24px;
  --landing-page-gutter-mobile: 16px;
  --landing-bg: #050e1f;
  --landing-surface: rgba(16, 31, 62, 0.58);
  --landing-surface-strong: rgba(7, 17, 37, 0.92);
  --landing-border: rgba(129, 152, 190, 0.2);
  --landing-border-strong: rgba(129, 152, 190, 0.3);
  --landing-text: #f8fbff;
  --landing-muted: #b9c4d2;
  --landing-muted-soft: #b4bfce;
  --landing-accent: #58e8b4;
  --landing-accent-bright: #5dffc0;
  --landing-ink-on-accent: #052016;
  --landing-radius: 8px;
  --landing-radius-lg: 12px;
  --landing-shadow: 0 26px 72px rgba(0, 0, 0, 0.36);

  min-height: 100vh;
  color: var(--landing-text);
  background:
    linear-gradient(180deg, rgba(4, 12, 28, 0.92), rgba(4, 13, 31, 0.98)),
    url("data:image/svg+xml,%3Csvg width='1600' height='1000' viewBox='0 0 1600 1000' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.72' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='1600' height='1000' filter='url(%23n)' opacity='.12'/%3E%3C/svg%3E");
}

.landing-nav {
  width: min(100% - (var(--landing-page-gutter) * 2), var(--landing-max-width));
  margin: 0 auto;
  min-height: 78px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.brand,
.login-link,
.hero-actions a,
.trust-row span,
.proof-grid article,
.contact-section {
  display: flex;
  align-items: center;
}

.brand {
  gap: 12px;
  color: #fff;
  font-size: 19px;
  font-weight: 800;
}

.brand img {
  width: 72px;
  height: 48px;
  object-fit: contain;
  object-position: center;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.94);
  padding: 5px 7px;
  box-shadow: 0 10px 30px rgba(255, 200, 0, 0.18);
}

.brand svg,
.eyebrow,
.trust-row svg,
.landing-feature-card svg,
.proof-grid svg {
  color: var(--landing-accent);
}

.nav-links {
  display: flex;
  align-items: center;
  gap: clamp(22px, 3vw, 38px);
  color: var(--landing-muted);
  font-size: 14px;
}

.nav-links a:hover {
  color: var(--landing-accent);
}

.login-link {
  gap: 10px;
  border: 1px solid color-mix(in srgb, var(--landing-accent) 55%, transparent);
  border-radius: var(--landing-radius);
  padding: 12px 18px;
  color: var(--landing-accent-bright);
  font-weight: 700;
}

.hero-section {
  width: min(100% - (var(--landing-page-gutter) * 2), var(--landing-max-width));
  margin: 28px auto 0;
  min-height: 480px;
  display: grid;
  grid-template-columns: minmax(390px, 0.72fr) minmax(620px, 1.28fr);
  gap: clamp(28px, 4vw, 52px);
  align-items: center;
}

.eyebrow {
  margin: 0 0 16px;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 12px;
  font-weight: 800;
}

.hero-copy h1 {
  margin: 0;
  max-width: 560px;
  color: #fff;
  font-size: clamp(38px, 3.4vw, 52px);
  line-height: 1.1;
  letter-spacing: 0;
}

.hero-copy h1 span {
  color: var(--landing-accent);
}

.hero-text {
  max-width: 540px;
  margin: 22px 0 0;
  color: var(--landing-muted);
  font-size: 17px;
  line-height: 1.7;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 28px;
}

.primary-cta,
.secondary-cta {
  min-height: 52px;
  gap: 12px;
  border-radius: var(--landing-radius);
  padding: 0 20px;
  font-weight: 800;
}

.primary-cta {
  background: var(--landing-accent);
  color: var(--landing-ink-on-accent);
}

.secondary-cta {
  color: var(--landing-text);
  border: 1px solid rgba(200, 214, 236, 0.42);
}

.trust-row {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  margin-top: 30px;
  color: var(--landing-muted);
}

.trust-row span {
  gap: 10px;
}

.dashboard-preview {
  border: 1px solid var(--landing-border-strong);
  border-radius: var(--landing-radius-lg);
  background: linear-gradient(135deg, rgba(31, 47, 76, 0.78), var(--landing-surface-strong));
  box-shadow: var(--landing-shadow);
  overflow: hidden;
  position: relative;
  display: grid;
  align-items: center;
  padding: 12px;
}

.dashboard-preview::before {
  content: "";
  position: absolute;
  inset: -35% -20% auto auto;
  width: 360px;
  height: 360px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--landing-accent) 16%, transparent);
  filter: blur(44px);
}

.preview-window {
  position: relative;
  z-index: 1;
  border: 1px solid rgba(222, 232, 247, 0.24);
  border-radius: 10px;
  overflow: hidden;
  background: #eef3f9;
  box-shadow: 0 20px 46px rgba(0, 0, 0, 0.32);
}

.window-dots {
  height: 26px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  background: var(--landing-bg);
  border-bottom: 1px solid var(--landing-border);
}

.window-dots span {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: rgba(180, 194, 216, 0.56);
}

.window-dots span:first-child {
  background: var(--landing-accent);
}

.preview-window img {
  display: block;
  width: 100%;
  height: auto;
}

.landing-feature-card,
.proof-grid article {
  border: 1px solid var(--landing-border);
  background: var(--landing-surface);
  border-radius: var(--landing-radius);
}

.features-section {
  margin-top: 38px;
  border-top: 1px solid var(--landing-border);
  padding: 42px max(var(--landing-page-gutter), calc((100vw - var(--landing-max-width)) / 2)) 28px;
}

.section-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 0.72fr);
  gap: clamp(28px, 5vw, 56px);
  align-items: end;
}

.section-heading h2,
.contact-section h2 {
  margin: 0;
  font-size: clamp(27px, 2.6vw, 36px);
  line-height: 1.12;
}

.section-heading > p {
  margin: 0;
  color: var(--landing-muted);
  line-height: 1.7;
}

.landing-feature-grid {
  margin-top: 26px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.landing-feature-card {
  min-height: 176px;
  padding: 24px;
  text-align: left;
}

.landing-feature-card h3 {
  margin: 22px 0 8px;
  color: var(--landing-text);
  font-size: 17px;
  font-weight: 800;
  line-height: 1.25;
}

.landing-feature-card p,
.proof-grid span {
  margin: 0;
  color: var(--landing-muted-soft);
  font-size: 15px;
  line-height: 1.55;
  overflow-wrap: normal;
  word-break: normal;
  hyphens: none;
}

.proof-grid {
  margin-top: 18px;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
}

.proof-grid article {
  gap: 16px;
  min-height: 84px;
  padding: 18px 24px;
}

.proof-grid strong,
.proof-grid span {
  display: block;
}

.contact-section {
  width: min(100% - (var(--landing-page-gutter) * 2), var(--landing-max-width));
  margin: 36px auto 0;
  padding: 34px;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  border: 1px solid var(--landing-border-strong);
  border-radius: 16px;
  background:
    linear-gradient(135deg, rgba(88, 232, 180, 0.12), transparent 38%),
    linear-gradient(180deg, rgba(16, 31, 62, 0.76), rgba(7, 17, 37, 0.88));
  box-shadow: var(--landing-shadow);
  position: relative;
  overflow: hidden;
}

.contact-section::after {
  content: "";
  position: absolute;
  right: -120px;
  top: -160px;
  width: 320px;
  height: 320px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--landing-accent) 18%, transparent);
  filter: blur(42px);
}

.contact-copy,
.contact-actions {
  position: relative;
  z-index: 1;
}

.contact-copy {
  max-width: 760px;
}

.contact-copy .eyebrow {
  margin-bottom: 12px;
}

.contact-copy p:not(.eyebrow) {
  max-width: 640px;
  margin: 16px 0 0;
  color: var(--landing-muted);
  font-size: 16px;
  line-height: 1.65;
}

.contact-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 20px;
}

.contact-metrics span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--landing-border);
  border-radius: 999px;
  padding: 8px 12px;
  color: var(--landing-muted);
  background: rgba(5, 14, 31, 0.36);
  font-size: 14px;
}

.contact-metrics svg {
  color: var(--landing-accent);
}

.contact-actions {
  display: grid;
  gap: 12px;
  min-width: 220px;
}

.contact-primary-cta,
.contact-secondary-cta {
  min-height: 54px;
  border-radius: var(--landing-radius);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 0 22px;
  font-weight: 900;
}

.contact-primary-cta {
  color: var(--landing-ink-on-accent);
  background: var(--landing-accent);
  box-shadow: 0 14px 34px rgba(88, 232, 180, 0.2);
}

.contact-secondary-cta,
.contact-policy-link {
  color: var(--landing-text);
  border: 1px solid rgba(200, 214, 236, 0.36);
  background: rgba(5, 14, 31, 0.38);
}

.contact-policy-link {
  min-height: auto;
  border-color: transparent;
  background: transparent;
  color: var(--landing-muted);
  font-size: 13px;
  font-weight: 700;
}

.contact-policy-link:hover {
  color: var(--landing-accent);
}

@media (max-width: 1160px) {
  .hero-section,
  .section-heading {
    grid-template-columns: 1fr;
  }

  .dashboard-preview {
    max-width: 860px;
  }

  .landing-feature-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .landing-nav {
    width: min(100% - (var(--landing-page-gutter-mobile) * 2), var(--landing-max-width));
    min-height: auto;
    padding: 18px 0;
  }

  .nav-links {
    display: none;
  }

  .brand {
    font-size: 17px;
  }

  .login-link {
    padding: 10px 12px;
    font-size: 14px;
  }

  .hero-section,
  .contact-section {
    width: min(100% - (var(--landing-page-gutter-mobile) * 2), var(--landing-max-width));
  }

  .hero-section {
    margin-top: 26px;
    gap: 36px;
  }

  .hero-copy h1 {
    font-size: 35px;
  }

  .hero-text {
    font-size: 16px;
  }

  .dashboard-preview {
    height: auto;
    min-height: 0;
    padding: 8px;
  }

  .landing-feature-grid,
  .proof-grid {
    grid-template-columns: 1fr;
  }

  .features-section {
    padding-inline: var(--landing-page-gutter-mobile);
  }

  .contact-section {
    align-items: flex-start;
    flex-direction: column;
    padding: 24px;
  }

  .contact-actions {
    width: 100%;
  }

  .contact-primary-cta,
  .contact-secondary-cta,
  .contact-policy-link {
    width: 100%;
  }
}
</style>
