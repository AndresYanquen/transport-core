# Edición de usuarios y perfiles

La implementación conserva los endpoints existentes y la estructura de módulos. Las respuestas de perfil usan el mismo objeto público `user` que `/api/auth/me`. Ninguna respuesta incluye hashes de contraseña, tokens internos o códigos OTP.

## Instalación y verificación

Aplicar las migraciones antes de iniciar el backend actualizado:

```sh
npm run migrate:latest
npm test
npm run test:profiles:integration
npm run test:auth:integration
npm run build --prefix client
```

La migración `20261028_add_user_profile_changes.js` agrega auditoría, desafíos de identidad, versión de credenciales y el propósito `change` al OTP existente. Las pruebas de integración crean y eliminan esquemas temporales; necesitan PostgreSQL con PostGIS y permisos para crear esquemas. Usan correo y SMS simulados. No enviar códigos de prueba a proveedores reales.

Para los cambios de identidad se requiere el correo SMTP configurado si se usa verificación por correo y la configuración SMS existente para OTP. Cuando SMTP no está configurado, los nuevos flujos devuelven `503` y no imprimen códigos en logs.

## Rutas y permisos

Todas estas rutas requieren `Authorization: Bearer <accessToken>`.

| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `/api/users/me` | `client`, `driver`, perfil propio |
| PATCH | `/api/users/me` | `client`, `driver`, perfil propio |
| GET | `/api/admin/users/:userId` | `admin`; `operator` solo consulta pasajeros |
| PATCH | `/api/admin/users/:userId` | `admin` |
| PATCH | `/api/admin/users/:userId/status` | `admin`, excepto su propia cuenta |
| POST | `/api/auth/reauth/email/request` | Usuario autenticado con correo verificado |
| POST | `/api/auth/reauth/email/verify` | Usuario autenticado, desafío propio |
| POST | `/api/auth/email/change/request` | Usuario autenticado y comprobación de identidad |
| POST | `/api/auth/email/change/verify` | Usuario autenticado, desafío propio |
| POST | `/api/auth/phone/change/request-otp` | Conductor o pasajero y comprobación de identidad |
| POST | `/api/auth/phone/change/verify-otp` | Conductor o pasajero, desafío e instalación propios |
| POST | `/api/auth/change-password` | Usuario autenticado y comprobación de identidad |

Crear cuentas sigue usando `POST /api/auth/signup` o `POST /api/admin/users`. Foto, tema/idioma, disponibilidad, ubicación operativa, servicios, favoritos y aprobación conservan sus endpoints.

## Actualización parcial

```json
{
  "firstName": "Ana",
  "lastName": "Gómez",
  "clientProfile": {
    "defaultPaymentMethod": "cash",
    "homeLocation": { "lat": 4.711, "lng": -74.0721 }
  }
}
```

Se actualizan únicamente los campos enviados. `null` elimina los valores opcionales; un objeto vacío o campos desconocidos generan `400`. No se puede modificar el perfil de otro rol. No se puede cambiar `email`, `phoneNumber`, `role`, `status`, verificaciones, saldos o calificaciones mediante el PATCH general.

Campos comunes: `firstName`, `lastName` (texto de hasta 100 caracteres o `null`).

Pasajero: `clientProfile.defaultPaymentMethod` (preferencia de texto de hasta 100 caracteres o `null`, sin credenciales de pago), `clientProfile.homeLocation` (`{lat,lng}` numéricos dentro de los límites geográficos o `null`). No se cobra ni se autoriza un medio de pago mediante este campo.

Conductor: `driverProfile.licenseNumber`, `vehicleMake`, `vehicleModel`, `vehiclePlate` (texto obligatorio cuando se envía), `vehicleYear` (entero entre 1900 y el año actual + 1 o `null`), `vehicleColor`, `vehicleType` (texto o `null`). Los límites coinciden con las columnas actuales.

`driverProfile.documents` acepta exclusivamente `licenseFront`, `licenseBack`, `vehicleRegistration`, `insurance`. Cada valor es una referencia HTTPS sin usuario/contraseña en la URL; `null` elimina esa referencia. Se conservan las otras claves existentes. Este endpoint guarda referencias: no sube archivos ni los descarga para inspeccionarlos. Deben utilizarse referencias estables, accesibles para la revisión administrativa.

```json
{
  "driverProfile": {
    "vehiclePlate": "ABC123",
    "documents": {
      "insurance": "https://storage.example/insurance.pdf",
      "licenseBack": null
    }
  }
}
```

Cambiar efectivamente licencia, marca, modelo, año, placa, tipo de vehículo o documentos requiere nueva aprobación: se establece `approvalStatus = pending`, se limpian los datos de revisión anteriores y el conductor queda `offline` con intención de disponibilidad `offline`. Si hay un viaje no finalizado, se rechaza toda la actualización con `409`, incluidos los campos comunes enviados en la misma solicitud. Nombre, apellido y color no reinician la aprobación. Reenviar el mismo valor no reinicia la revisión.

Respuesta:

```json
{ "user": { "id": "…" }, "approvalRequired": true }
```

El objeto `user` completo se devuelve dentro de la respuesta. Las escrituras, la nueva aprobación y la auditoría se realizan en una transacción. La auditoría almacena actor, usuario afectado, operación y nombres de campos; no guarda valores personales ni secretos.

El estado administrativo se modifica por separado:

```http
PATCH /api/admin/users/:userId/status
```

```json
{ "status": "suspended" }
```

Valores: `active`, `inactive`, `suspended`. Cambiar el estado invalida las sesiones previas y registra la operación. Suspender o desactivar también desconecta la disponibilidad del conductor.

## Comprobación de identidad

Para solicitar cambiar correo/teléfono o agregar/cambiar contraseña, proporcionar uno de estos mecanismos:

1. `currentPassword`: contraseña actual correcta.
2. Sesión móvil activa creada al verificar OTP en los últimos 5 minutos. La antigüedad proviene de PostgreSQL; refrescar un JWT no renueva esa antigüedad.
3. `reauthToken`: comprobante temporal obtenido mediante un código al correo ya verificado. Válido por 5 minutos y para una sola operación.

Para obtener `reauthToken`:

```http
POST /api/auth/reauth/email/request
{}
```

Respuesta: `{ "challengeId": "uuid", "expiresIn": 600 }`. Se envía un código al correo actual verificado.

```http
POST /api/auth/reauth/email/verify
```

```json
{ "challengeId": "uuid", "code": "123456" }
```

Respuesta: `{ "reauthToken": "…", "expiresIn": 300 }`. No se devuelve ningún código por API. Los desafíos de correo admiten hasta 5 intentos y 5 solicitudes por usuario/propósito cada 15 minutos, además del límite actual de autenticación por IP. Se guarda un HMAC del código o comprobante.

## Correo

```http
POST /api/auth/email/change/request
```

```json
{ "email": "nuevo@example.com", "currentPassword": "contraseña actual" }
```

Puede reemplazarse `currentPassword` por `reauthToken`; con una sesión OTP reciente se omiten ambos. El código se envía al nuevo correo; el correo actual sigue vigente.

```http
POST /api/auth/email/change/verify
```

```json
{ "challengeId": "uuid", "code": "123456" }
```

Respuesta: `{ "user": { "id": "…" }, "requiresLogin": true }`. Se cambia el correo, se marca verificado y se invalidan las sesiones previas. Un correo duplicado genera `409`; el índice existente resuelve también las carreras entre solicitudes.

## Teléfono

La vinculación inicial sigue disponible en `/api/auth/phone/link/*`. Cambiar un número verificado usa:

```http
POST /api/auth/phone/change/request-otp
```

```json
{
  "phoneNumber": "+573001234567",
  "deviceId": "uuid-de-la-instalacion",
  "requestId": "uuid-unico-para-la-solicitud",
  "currentPassword": "contraseña actual"
}
```

El propósito del desafío queda ligado al usuario y a la versión de sus credenciales. Se reutilizan normalización, países habilitados, restricciones, presupuesto e idempotencia del proveedor SMS existente.

```http
POST /api/auth/phone/change/verify-otp
```

```json
{ "challengeId": "uuid", "code": "123456", "deviceId": "uuid-de-la-instalacion" }
```

La verificación cambia el número y revoca las sesiones anteriores dentro de la transacción OTP. Devuelve una nueva sesión con el mismo formato de `/api/auth/phone/verify-otp`. El cliente debe reemplazar sus tokens con la respuesta. No fusiona cuentas; no permite vincular un número perteneciente a otro usuario. Si las credenciales cambian entre solicitud y verificación, el desafío no es válido.

## Contraseña

```http
POST /api/auth/change-password
```

```json
{ "password": "nueva contraseña", "currentPassword": "contraseña actual" }
```

Para una cuenta sin contraseña, usar sesión OTP reciente o `reauthToken`. Admite de 6 caracteres a 72 bytes (límite de bcrypt). Respuesta: `{ "success": true, "requiresLogin": true }`. Se invalidan las sesiones y enlaces de recuperación previos. Los flujos existentes de recuperación siguen disponibles.

## Errores

- `400`: cuerpo inválido, campo restringido o perfil de otro rol.
- `401`: comprobación de identidad faltante, código incorrecto/expirado/usado o credenciales revocadas.
- `403`: rol sin permiso o cuenta no activa.
- `404`: usuario/perfil inexistente; usuarios que el operador no puede consultar.
- `409`: conflicto de datos únicos, viaje activo o intento de cambiar el estado del propio administrador.
- `429`: límite de solicitudes o verificaciones.
- `503`: correo/SMS sin configurar o proveedor no disponible.

## Interfaz

- Administración: botón **Editar** en la tabla de Usuarios. Permite completar datos personales, perfil por rol, referencias de documentos y estado administrativo.
- `/profile`: acceso con OTP como pasajero o conductor; perfil propio, hogar/vehículo/documentos, foto y preferencias usando rutas existentes; confirmación y cambio de correo, teléfono y contraseña. El formulario envía únicamente los campos modificados.
- Los cambios de correo o contraseña cierran la sesión local y requieren ingresar otra vez. El cambio de teléfono instala la nueva sesión que devuelve el backend.

## Nombre pendiente después de registro OTP

La cuenta y la sesión se crean al verificar el OTP, aunque aún falte el nombre.
El objeto público `user` incluye `registrationComplete` y
`missingRegistrationFields`. Para `client`/`driver` sin nombre o con nombre
compuesto solo por espacios: `false` y `["firstName"]`. Con nombre guardado:
`true` y `[]`. Para roles administrativos: `true` y `[]`.

Flutter debe conservar los tokens y mostrar el formulario de nombre cuando el
indicador sea falso. Guardar `{ "firstName": "Ana" }` con `PATCH /api/users/me`
y usar el `user` devuelto para continuar. El indicador se recalcula en consultas,
login y refresh, por lo que sigue pendiente tras cerrar y abrir la aplicación.
No depende de `isNewUser`; no se acepta modificar los indicadores directamente.
No se agregan bloqueos de viajes ni un token temporal. Este cambio no requiere
migración adicional.
