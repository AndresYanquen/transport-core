import { apiRequest } from "../../../services/api.js";

export function updateDriverStatus(driverId, status) {
  return apiRequest(`/api/drivers/${driverId}/status`, {
    method: "PATCH",
    body: { status },
  });
}
