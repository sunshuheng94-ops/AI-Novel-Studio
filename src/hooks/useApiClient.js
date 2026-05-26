import { useMemo } from 'react';

export function useApiClient(token) {
  return useMemo(() => async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '请求失败');
    return data;
  }, [token]);
}
