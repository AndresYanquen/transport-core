# Contenido de inicio: Promociones y Seguridad

## Despliegue

1. Aplicar `npm run migrate:latest` en el entorno correspondiente antes de desplegar el backend.
2. Usar la configuración R2 existente: `R2_ENDPOINT` o `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`. El dominio público debe servir imágenes por HTTPS.
3. Desplegar backend y frontend. Abrir `/admin/configuracion/general` como administrador.
4. Crear contenido, guardar y publicar; activar su sección con **Guardar sección**.

Ambas secciones se crean desactivadas y sin contenido. La migración no altera la tarjeta de pedir viaje. El proyecto Flutter no está incluido en este repositorio.

## Administración

Todos los endpoints bajo `/api/admin/home-content` requieren Bearer token de administrador.

- `GET /`: secciones, ítems y metadatos de imágenes.
- `POST /items`: `{ sectionKey, content }`.
- `PATCH /items/:id`: `{ sectionKey, revision, content }`. Sustituye todo el borrador, no la publicación.
- `POST /items/:id/publish`: `{ revision }`. Valida y copia el borrador a la versión publicada.
- `POST /items/:id/archive`: `{ revision }`. Retira la publicación y conserva el borrador.
- `PATCH /sections/:key`: `{ revision, enabled, sortOrder, carouselIntervalSeconds }`.
- `POST /assets`: multipart con `image` y `sectionKey`; no establecer Content-Type manualmente.
- `DELETE /assets/:id`: elimina de R2 y BD únicamente si ningún borrador o publicación referencia la imagen.

Las respuestas de cambios incluyen la nueva `revision`. Un conflicto devuelve 409; recargar el contenido antes de reintentar. Publicar una segunda tarjeta de Seguridad requiere archivar primero la existente, incluso si su vigencia terminó. Las fechas son opcionales, ISO 8601 con zona horaria; el backend normaliza UTC. Inicio inclusivo y fin exclusivo. No se puede publicar contenido ya vencido.

Los assets tienen claves únicas e inmutables `home/{sectionKey}/{uuid}.{extension}`. Subir una nueva imagen no elimina la anterior, porque puede seguir usándose en la versión publicada. Si falla el registro en BD después de subir a R2, se intenta eliminar el objeto y se registra cualquier fallo de compensación. La pantalla permite eliminar imágenes sin uso, incluidos uploads de ediciones canceladas. Si la eliminación de R2 falla, se conserva el registro para reintentar.

## Contrato para Flutter

`GET /api/home-content` requiere Bearer token. Devuelve únicamente secciones activas con contenido publicado vigente, ordenadas por `sortOrder`; los ítems se ordenan por su propio `sortOrder` y luego ID. No entrega borradores, usuarios administradores ni claves internas de R2. Sin contenido elegible, devuelve `sections: []`. No utiliza caché HTTP para que cambios y vencimientos se reflejen en la siguiente consulta.

```json
{
  "schemaVersion": 1,
  "audience": "client",
  "sections": [
    {
      "key": "promotions",
      "sortOrder": 10,
      "carouselIntervalSeconds": 5,
      "items": [
        {
          "id": "00000000-0000-0000-0000-000000000001",
          "title": "Descubre GotTaxi",
          "summary": "Conoce nuestras novedades",
          "altText": "Taxi en la ciudad",
          "buttonLabel": "Descubre más",
          "sortOrder": 10,
          "startsAt": null,
          "endsAt": null,
          "action": { "type": "detail", "itemId": "00000000-0000-0000-0000-000000000001" },
          "blocks": [{ "type": "paragraph", "text": "Contenido de la promoción." }],
          "image": { "url": "https://cdn.example/home/promotions/banner.webp", "width": 1600, "height": 700, "altText": "Taxi en la ciudad" },
          "publishedAt": "2026-10-15T00:00:00.000Z"
        }
      ]
    }
  ]
}
```

`GET /api/home-content/items/:id` devuelve `{ item }` con el mismo formato. Devuelve 404 si está archivado, fuera de vigencia o su sección está desactivada. La app debe manejar ese caso al abrir un detalle desde una pantalla anterior.

Acciones admitidas:

- `detail`: consultar el detalle por ID y renderizar bloques `heading`, `paragraph` y `bullet` como widgets nativos. Los textos son texto plano, no HTML.
- `request_ride`: abrir el flujo existente de pedir viaje. No se aceptan rutas internas arbitrarias.
- `external`: abrir `action.url` HTTPS; no representa un cupón ni cambia tarifas.

Seguridad usa `key: "safety"`, admite una sola tarjeta publicada y siempre abre detalle. Si `image` es null, Flutter debe mostrar su icono de seguridad. Promociones requiere imagen al publicar. Una promoción se muestra como tarjeta; varias, como carrusel con el intervalo configurado. Proporción de referencia del banner: 16:7 con recorte al centro. Pausar el carrusel al interactuar y respetar las preferencias de movimiento del dispositivo.

Consultar al cargar o retomar el inicio. Ocultar secciones vacías y tolerar fallos de imágenes o API sin bloquear el flujo de viaje. Mantener disponible la acción principal de pedir viaje. La primera versión no incluye segmentación por ciudad/usuario, descuentos automáticos ni sustitución de funciones de emergencia.

## Verificación

- `node --test tests/home-content.test.js`
- `npm test`
- `npm run build --prefix client`

Las pruebas del módulo usan dobles de PostgreSQL y R2: no suben imágenes ni modifican bases remotas. Antes de producción, verificar en staging migración, carga real a R2, URL pública, permisos, publicación, vencimiento y consumo desde Flutter.

## Iconos de tipos de servicio en el inicio Flutter

El catálogo existente `GET /api/service-types` (Bearer token) devuelve `{ serviceTypes: [...] }`. Cada tipo incluye `code`, `name`, `icon`, `color`, `isActive` y `sortOrder`; para pasajeros el servidor entrega únicamente los activos, ordenados por `sort_order` y nombre.

Las tarjetas o accesos de tipos de servicio del inicio deben usar el mismo resolvedor de iconos que el selector de servicios, basado en `serviceType.icon`, y el color `serviceType.color` si es válido. No duplicar una tabla de iconos basada en el nombre comercial ni asignar a todos un icono fijo. `icon` actualmente es un identificador (por ejemplo `car`, `gem`, `bus`, `users`, `package`, `utensils`, `wrench`, `battery-charging`, `disc`), no una URL de imagen de R2. Si falta o es desconocido, mostrar el icono de vehículo predeterminado; si falta el color, usar el tema de la app.

Mantener la navegación actual enviando `serviceType.code` al flujo de solicitud. Actualizar el catálogo junto con el inicio para reflejar cambios de administración. Esta información procede del catálogo de servicios, no de `/api/home-content`; las dos peticiones pueden ejecutarse independientemente. No asignar automáticamente un icono de servicio a los banners de Promociones o Seguridad.
