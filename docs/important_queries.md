# Important Queries

## Conductores invitados a un viaje

Usa este query para revisar los conductores invitados a una solicitud o viaje especifico.

```sql
SELECT
  i.id AS invite_id,
  i.ride_id,
  i.driver_id,
  i.status AS invite_status,
  i.invited_at,
  i.responded_at,
  u.first_name,
  u.last_name,
  u.email,
  u.phone_number,
  d.status AS driver_status,
  d.vehicle_make,
  d.vehicle_model,
  d.vehicle_plate,
  d.rating
FROM ride_driver_invites i
JOIN drivers d ON d.user_id = i.driver_id
JOIN users u ON u.id = i.driver_id
WHERE i.ride_id = 'd605f56f-4172-4daa-a87a-adad9277c83e'
ORDER BY i.invited_at ASC;
```

Version base, solo con los datos de invitaciones:

```sql
SELECT *
FROM ride_driver_invites
WHERE ride_id = 'd605f56f-4172-4daa-a87a-adad9277c83e'
ORDER BY invited_at ASC;
```

## Diagnosticar conductores cercanos a un servicio

Usa este query para saber si hay conductores cerca del punto de recogida y ver por que un conductor puede no estar recibiendo el servicio.

```sql
WITH params AS (
  SELECT
    'd605f56f-4172-4daa-a87a-adad9277c83e'::uuid AS ride_id,
    2000::double precision AS radius_meters,
    90::double precision AS presence_stale_seconds
),
target_ride AS (
  SELECT
    r.id,
    r.status AS ride_status,
    r.service_type,
    r.pickup_point
  FROM rides r
  JOIN params p ON p.ride_id = r.id
)
SELECT
  d.user_id AS driver_id,
  u.first_name,
  u.last_name,
  u.email,
  d.status AS driver_status,
  d.approval_status,
  d.last_seen_at,
  ROUND(EXTRACT(EPOCH FROM (NOW() - d.last_seen_at))::numeric, 1) AS seconds_since_seen,
  d.vehicle_plate,
  d.vehicle_make,
  d.vehicle_model,
  COALESCE(driver_services.service_types, ARRAY[]::text[]) AS driver_service_types,
  r.service_type AS ride_service_type,
  ROUND(ST_Distance(d.current_location, r.pickup_point)::numeric, 2) AS distance_meters,
  EXISTS (
    SELECT 1
    FROM ride_driver_invites i
    WHERE i.ride_id = r.id
      AND i.driver_id = d.user_id
  ) AS already_invited,
  (d.status = 'online') AS passes_online,
  (d.approval_status = 'approved') AS passes_approved,
  (
    d.last_seen_at >= NOW() - (p.presence_stale_seconds * INTERVAL '1 second')
  ) AS passes_recent_presence,
  ST_DWithin(d.current_location, r.pickup_point, p.radius_meters) AS passes_radius,
  (r.service_type = ANY(COALESCE(driver_services.service_types, ARRAY[]::text[]))) AS passes_service_type,
  (
    d.status = 'online'
    AND d.approval_status = 'approved'
    AND d.last_seen_at >= NOW() - (p.presence_stale_seconds * INTERVAL '1 second')
    AND d.current_location IS NOT NULL
    AND ST_DWithin(d.current_location, r.pickup_point, p.radius_meters)
    AND r.service_type = ANY(COALESCE(driver_services.service_types, ARRAY[]::text[]))
  ) AS should_receive_service
FROM target_ride r
CROSS JOIN params p
JOIN drivers d ON d.current_location IS NOT NULL
JOIN users u ON u.id = d.user_id
LEFT JOIN LATERAL (
  SELECT array_agg(dst.service_type_code ORDER BY st.sort_order ASC, st.name ASC) AS service_types
  FROM driver_service_types dst
  JOIN service_types st ON st.code = dst.service_type_code
  WHERE dst.driver_id = d.user_id
    AND dst.is_active = true
    AND st.is_active = true
) driver_services ON true
WHERE ST_DWithin(d.current_location, r.pickup_point, p.radius_meters)
ORDER BY should_receive_service DESC, distance_meters ASC;
```

## Revisar estado real de un conductor

Usa este query para confirmar el estado operativo real que usa el matching. `status` define si puede recibir servicios; `availability_intent` solo indica la intencion del conductor.

```sql
SELECT
  user_id,
  status,
  availability_intent,
  approval_status,
  last_seen_at,
  EXTRACT(EPOCH FROM (NOW() - last_seen_at)) AS seconds_since_seen,
  offline_reason,
  updated_at
FROM drivers
WHERE user_id = 'c6f97644-52b4-4b94-8ed7-02bf4dff32ee';
```

## Buscar viajes activos de un conductor

Usa este query cuando un conductor aparece `busy` para validar si realmente tiene un servicio activo.

```sql
SELECT
  id,
  status,
  service_type,
  client_id,
  driver_id,
  requested_at,
  accepted_at,
  driver_arrived_at,
  started_at,
  completed_at,
  canceled_at,
  pickup_address,
  dropoff_address,
  cancellation_reason
FROM rides
WHERE driver_id = 'c6f97644-52b4-4b94-8ed7-02bf4dff32ee'
  AND status IN (
    'driver_assigned',
    'driver_en_route',
    'driver_arrived',
    'in_progress'
  )
ORDER BY requested_at DESC;
```

## Ultimos viajes de un conductor

Usa este query para revisar si los ultimos viajes quedaron correctamente finalizados o cancelados.

```sql
SELECT
  id,
  status,
  service_type,
  client_id,
  driver_id,
  requested_at,
  accepted_at,
  driver_arrived_at,
  started_at,
  completed_at,
  canceled_at,
  updated_at
FROM rides
WHERE driver_id = 'c6f97644-52b4-4b94-8ed7-02bf4dff32ee'
ORDER BY updated_at DESC
LIMIT 10;
```

## Eventos recientes de viajes de un conductor

Usa este query para auditar las transiciones recientes de los viajes asociados a un conductor.

```sql
SELECT
  e.id,
  e.ride_id,
  e.status,
  e.actor_type,
  e.actor_id,
  e.payload,
  e.occurred_at,
  e.created_at
FROM ride_events e
JOIN rides r ON r.id = e.ride_id
WHERE r.driver_id = 'c6f97644-52b4-4b94-8ed7-02bf4dff32ee'
ORDER BY e.created_at DESC
LIMIT 30;
```

## Destrabar conductor ocupado sin viajes activos

Usa este update solo en pruebas o soporte operativo despues de confirmar que el conductor no tiene viajes activos.

```sql
UPDATE drivers
SET
  status = 'online',
  availability_intent = 'online',
  last_seen_at = NOW(),
  offline_reason = NULL,
  updated_at = NOW()
WHERE user_id = 'c6f97644-52b4-4b94-8ed7-02bf4dff32ee';
```
