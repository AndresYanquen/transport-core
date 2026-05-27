import { apiRequest } from "../../../services/api.js";

export function listRides() {
  return apiRequest("/api/rides", { method: "GET" });
}
