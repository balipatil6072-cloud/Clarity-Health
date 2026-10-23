import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE || '/api', withCredentials: true });
api.interceptors.response.use((response) => response, (error) => Promise.reject(new Error(error.response?.data?.error || 'Could not connect to the service. Please try again.')));
export default api;
