export const USER_CACHE_KEY = 'gdf:user-cache'

export function clearUserSessionCache() {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(USER_CACHE_KEY)
  } catch {
    /* ignore */
  }
}
