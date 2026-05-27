import { apiRequest } from "../../../services/api.js";

export function signUp(payload) {
  return apiRequest("/api/auth/signup", {
    method: "POST",
    body: payload,
    auth: false,
  });
}

export function logIn(payload) {
  return apiRequest("/api/auth/login", {
    method: "POST",
    body: payload,
    auth: false,
  });
}
