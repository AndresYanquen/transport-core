<script setup>
import { ArrowLeft, Mail, ShieldCheck } from "lucide-vue-next";
import { RouterLink } from "vue-router";

import goTaxiLogo from "@/assets/images/logo/gottaxi.png";

const lastUpdated = "20 de agosto de 2026";

const sections = [
  {
    title: "1. Información que recopilamos",
    body: [
      "Podemos recopilar datos de cuenta como nombre, correo, teléfono, rol de usuario y credenciales de acceso.",
      "Para operar servicios de transporte, podemos tratar datos de viajes, direcciones de recogida y destino, ubicación aproximada o en tiempo real, conductores asignados, estados del servicio, pagos, calificaciones e incidencias reportadas.",
      "También podemos registrar datos técnicos como dirección IP, dispositivo, navegador, fechas de acceso, eventos de seguridad y registros de actividad dentro de la plataforma.",
    ],
  },
  {
    title: "2. Cómo usamos la información",
    body: [
      "Usamos la información para crear y administrar cuentas, autenticar usuarios, coordinar solicitudes de transporte, asignar conductores, mostrar mapas operativos y gestionar el estado de los servicios.",
      "También usamos datos para soporte, seguridad, prevención de fraude, auditoría, cumplimiento legal, análisis operativo y mejora de la experiencia.",
    ],
  },
  {
    title: "3. Ubicación y mapas",
    body: [
      "La app puede usar información de ubicación para visualizar conductores, calcular zonas operativas, apoyar asignaciones y mejorar la precisión del servicio.",
      "Los mapas, tiles o servicios geográficos pueden depender de proveedores externos. En esos casos, el tratamiento por parte del proveedor se rige por sus propias políticas.",
    ],
  },
  {
    title: "4. Compartición de datos",
    body: [
      "Podemos compartir datos estrictamente necesarios entre administradores, operadores, conductores y clientes para prestar el servicio.",
      "También podemos usar proveedores tecnológicos para infraestructura, base de datos, autenticación, mapas, analítica, soporte o comunicaciones, bajo medidas razonables de seguridad.",
      "No vendemos datos personales.",
    ],
  },
  {
    title: "5. Seguridad",
    body: [
      "Aplicamos controles de acceso, autenticación, registros de auditoría y medidas técnicas orientadas a proteger la información.",
      "Ningún sistema es completamente infalible, por lo que recomendamos usar contraseñas seguras, proteger los dispositivos y reportar accesos sospechosos.",
    ],
  },
  {
    title: "6. Conservación",
    body: [
      "Conservamos información mientras sea necesaria para operar la plataforma, cumplir obligaciones legales, resolver disputas, prevenir fraude y mantener registros administrativos.",
      "Cuando la información ya no sea necesaria, podemos eliminarla, anonimizarla o conservarla de forma restringida según corresponda.",
    ],
  },
  {
    title: "7. Derechos del usuario",
    body: [
      "Según la ley aplicable, puedes solicitar acceso, actualización, corrección, eliminación, portabilidad u oposición al tratamiento de tus datos.",
      "Algunas solicitudes pueden requerir verificación de identidad y podrían estar limitadas por obligaciones legales u operativas.",
    ],
  },
  {
    title: "8. Cambios a esta política",
    body: [
      "Podemos actualizar esta política para reflejar cambios legales, técnicos u operativos.",
      "La versión vigente se publicará en esta página con su fecha de última actualización.",
    ],
  },
];
</script>

<template>
  <main class="privacy-page">
    <header class="privacy-nav">
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

    <section class="privacy-hero">
      <p class="eyebrow">Legal</p>
      <h1>Privacy Policy</h1>
      <p>
        Esta política explica cómo GoTaxi recopila, usa, comparte y protege la
        información personal relacionada con sus aplicaciones, paneles y servicios
        operativos.
      </p>
      <div class="hero-meta">
        <span><ShieldCheck :size="18" /> Última actualización: {{ lastUpdated }}</span>
      </div>
    </section>

    <section class="policy-content" aria-label="Contenido de la política de privacidad">
      <article v-for="section in sections" :key="section.title" class="policy-section">
        <h2>{{ section.title }}</h2>
        <p v-for="paragraph in section.body" :key="paragraph">{{ paragraph }}</p>
      </article>

      <article class="contact-card">
        <div>
          <h2>Contacto</h2>
          <p>
            Para consultas sobre privacidad o solicitudes relacionadas con tus datos,
            contacta al equipo responsable de GoTaxi.
          </p>
        </div>
        <a href="mailto:privacy@gottaxi.co">
          <Mail :size="18" />
          privacy@gottaxi.co
        </a>
      </article>
    </section>
  </main>
</template>

<style scoped>
.privacy-page {
  --privacy-max-width: 980px;
  --privacy-gutter: 24px;
  --privacy-bg: #050e1f;
  --privacy-surface: rgba(16, 31, 62, 0.68);
  --privacy-border: rgba(129, 152, 190, 0.22);
  --privacy-text: #f8fbff;
  --privacy-muted: #b9c4d2;
  --privacy-accent: #58e8b4;
  --privacy-ink-on-accent: #052016;

  min-height: 100vh;
  color: var(--privacy-text);
  background:
    linear-gradient(180deg, rgba(4, 12, 28, 0.94), rgba(4, 13, 31, 0.99)),
    url("data:image/svg+xml,%3Csvg width='1600' height='1000' viewBox='0 0 1600 1000' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.72' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='1600' height='1000' filter='url(%23n)' opacity='.1'/%3E%3C/svg%3E");
}

.privacy-nav,
.privacy-hero,
.policy-content {
  width: min(100% - (var(--privacy-gutter) * 2), var(--privacy-max-width));
  margin: 0 auto;
}

.privacy-nav {
  min-height: 78px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.brand,
.back-link,
.hero-meta span,
.contact-card a {
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
  border: 1px solid color-mix(in srgb, var(--privacy-accent) 52%, transparent);
  border-radius: 8px;
  padding: 10px 14px;
  color: var(--privacy-accent);
  font-size: 14px;
  font-weight: 700;
}

.privacy-hero {
  padding: 54px 0 34px;
}

.eyebrow {
  margin: 0 0 14px;
  color: var(--privacy-accent);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.privacy-hero h1 {
  margin: 0;
  font-size: clamp(42px, 7vw, 76px);
  font-weight: 800;
  letter-spacing: 0;
  line-height: 0.98;
}

.privacy-hero > p {
  max-width: 760px;
  margin: 22px 0 0;
  color: var(--privacy-muted);
  font-size: 18px;
  line-height: 1.7;
}

.hero-meta {
  margin-top: 24px;
}

.hero-meta span {
  gap: 8px;
  border: 1px solid var(--privacy-border);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  padding: 9px 13px;
  color: #d8e1ee;
  font-size: 14px;
}

.hero-meta svg,
.contact-card svg {
  color: var(--privacy-accent);
}

.policy-content {
  display: grid;
  gap: 14px;
  padding: 10px 0 72px;
}

.policy-section,
.contact-card {
  border: 1px solid var(--privacy-border);
  border-radius: 10px;
  background: var(--privacy-surface);
  padding: clamp(20px, 3vw, 30px);
  box-shadow: 0 20px 54px rgba(0, 0, 0, 0.22);
}

.policy-section h2,
.contact-card h2 {
  margin: 0 0 12px;
  color: #fff;
  font-size: 20px;
  font-weight: 800;
}

.policy-section p,
.contact-card p {
  margin: 0;
  color: var(--privacy-muted);
  font-size: 15px;
  line-height: 1.75;
}

.policy-section p + p {
  margin-top: 10px;
}

.contact-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.contact-card a {
  flex: 0 0 auto;
  gap: 8px;
  border-radius: 8px;
  background: var(--privacy-accent);
  padding: 12px 16px;
  color: var(--privacy-ink-on-accent);
  font-weight: 800;
}

.contact-card a svg {
  color: currentColor;
}

@media (max-width: 720px) {
  .privacy-page {
    --privacy-gutter: 16px;
  }

  .privacy-nav {
    min-height: 70px;
  }

  .brand {
    font-size: 18px;
  }

  .brand-logo {
    width: 62px;
    height: 42px;
  }

  .privacy-hero {
    padding-top: 36px;
  }

  .privacy-hero h1 {
    font-size: 42px;
  }

  .privacy-hero > p {
    font-size: 16px;
  }

  .contact-card {
    align-items: stretch;
    flex-direction: column;
  }

  .contact-card a {
    justify-content: center;
  }
}
</style>
