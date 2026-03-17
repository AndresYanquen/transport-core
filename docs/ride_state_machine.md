# Ride State Machine

This document captures the canonical ride lifecycle used by the service layer, Socket.IO events, and background jobs. Each status value maps directly to `rides.status` and `ride_events.status`.

## Status Vocabulary

- `requested` – client submits a ride request with a valid payment hold.
- `pending_driver` – system is searching for an available driver.
- `driver_assigned` – a specific driver has been offered and accepted the trip, but has not yet gone en route.
- `driver_en_route` – driver is navigating to the pickup point.
- `driver_arrived` – driver is on location and waiting for the rider.
- `in_progress` – rider is onboard and the trip is underway.
- `completed` – trip finished successfully; fare captured.
- `canceled_by_client` – client canceled the ride.
- `canceled_by_driver` – driver canceled the ride.
- `canceled_by_system` – automated cancellation (fraud, payment failure, no driver found).
- `no_show` – rider failed to appear within the grace window after driver arrival.

## State Transitions

| From | To | Actor | Trigger |
| --- | --- | --- | --- |
| `requested` | `pending_driver` | system | Ride enters matching queue. |
| `requested` | `canceled_by_client` | client | Client cancels before matching begins. |
| `requested` | `canceled_by_system` | system | Payment hold fails or request invalid. |
| `pending_driver` | `driver_assigned` | system | Driver accepts offer through dispatch. |
| `pending_driver` | `canceled_by_client` | client | Client cancels while waiting for match. |
| `pending_driver` | `canceled_by_system` | system | Matching exceeds SLA or no drivers available. |
| `driver_assigned` | `driver_en_route` | driver | Driver confirms navigation to pickup. |
| `driver_assigned` | `pending_driver` | system | Driver fails to go en route within SLA; request re-queued. |
| `driver_assigned` | `canceled_by_client` | client | Client cancels after seeing assigned driver. |
| `driver_assigned` | `canceled_by_driver` | driver | Driver backs out before heading to pickup. |
| `driver_assigned` | `canceled_by_system` | system | Driver goes offline or violates policy. |
| `driver_en_route` | `driver_arrived` | driver | Driver reaches pickup geofence. |
| `driver_en_route` | `canceled_by_client` | client | Client cancels while driver is approaching. |
| `driver_en_route` | `canceled_by_driver` | driver | Driver cancels due to incident or obstruction. |
| `driver_en_route` | `canceled_by_system` | system | ETA breach, driver location stale, or safety flag. |
| `driver_arrived` | `in_progress` | driver | Driver starts the trip with rider onboard. |
| `driver_arrived` | `canceled_by_client` | client | Client cancels after driver arrival. |
| `driver_arrived` | `canceled_by_driver` | driver | Driver cancels after waiting (e.g., rider refuses trip). |
| `driver_arrived` | `no_show` | system/driver | Grace period expires without rider check-in. |
| `driver_arrived` | `canceled_by_system` | system | Safety escalation or support intervention. |
| `in_progress` | `completed` | driver/system | Driver ends trip; backend finalizes fare. |
| `in_progress` | `canceled_by_client` | client | Client requests termination mid-trip (converted to stop/partial fare). |
| `in_progress` | `canceled_by_driver` | driver | Driver ends trip early due to incident. |
| `in_progress` | `canceled_by_system` | system | Emergency stop triggered by safety/support tooling. |

Terminal states (`completed`, any `canceled_*`, `no_show`) do not allow outbound transitions; further actions require support intervention and new ride creation.

Admin/system tooling may transition rides between non-terminal states through audited commands; these interventions should emit `ride_events` with `actor_type = 'system'` unless a dedicated support role is introduced later.

## Timeout & Auto-Cancellation Policies

Durations are configurable per market; suggested defaults provide guardrails for backend jobs and Socket.IO timers.

| State | Condition | Duration (default) | Auto Transition | Actor | Notes |
| --- | --- | --- | --- | --- | --- |
| `requested` | Payment authorization not confirmed | immediate | `canceled_by_system` | system | Reject invalid requests before matching. |
| `pending_driver` | No driver accepts offer | 90 s | `canceled_by_system` | system | Optionally retry matching before final cancel. |
| `driver_assigned` | Driver does not go en route | 45 s | `pending_driver` | system | Re-offer ride; record abandonment event for driver quality scoring. |
| `driver_assigned` | Driver explicitly declines | immediate | `canceled_by_driver` | driver | Client notified and optionally re-queued. |
| `driver_en_route` | Driver ETA exceeds promised window (ETA + 5 min) | dynamic | `canceled_by_system` | system | Trip can be re-queued or escalated to support. |
| `driver_arrived` | Rider absent | 5 min | `no_show` | system/driver | Driver may trigger earlier with photo/proof; fee rules apply. |
| `driver_arrived` | Support escalation | immediate | `canceled_by_system` | system | Safety or compliance intervention. |
| `in_progress` | Trip exceeds expected duration by >30% without movement | dynamic | `canceled_by_system` | system | Trigger wellness check before forced cancel. |
| `in_progress` | Driver ends trip | at dropoff | `completed` | driver/system | Final fare capture, close sockets, release geofences. |

Background workers should evaluate these conditions idempotently and write corresponding records into `ride_events` alongside any notifications pushed over Socket.IO. The repository now includes a timeout sweep service/job scaffold for these transitions.
