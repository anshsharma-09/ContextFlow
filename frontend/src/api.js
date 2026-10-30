const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const API_ROOT = `${API_BASE_URL}/api`;

export async function api(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export const jsonBody = value => JSON.stringify(value);
