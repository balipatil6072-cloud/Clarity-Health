import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE || '/api', withCredentials: true });

function formatErrorMessage(error) {
  const data = error?.response?.data;
  if (data) {
    if (typeof data.error === 'string') return data.error;
    if (data.error && typeof data.error === 'object') {
      return data.error.message || data.error.code || JSON.stringify(data.error);
    }
    if (typeof data.message === 'string') return data.message;
    if (typeof data === 'string') {
      if (data.trim().startsWith('<')) {
        return `Server error (${error.response.status} ${error.response.statusText || 'Error'}). Please check server logs.`;
      }
      return data;
    }
    if (typeof data === 'object') {
      try {
        return JSON.stringify(data);
      } catch { }
    }
  }
  if (typeof error?.message === 'string' && error.message && error.message !== '[object Object]') {
    return error.message;
  }
  return 'Could not connect to the service. Please try again.';
}

api.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(new Error(formatErrorMessage(error)))
);

export default api;
