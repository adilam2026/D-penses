// Client API minimal (Lot 0) — pointe vers le backend local par défaut.
// Sera étendu (auth, intercepteur JWT) avec l'écran de connexion, hors périmètre Lot 0.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function checkHealth(): Promise<{ status: string; timestamp: string }> {
  const res = await fetch(`${API_BASE_URL}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}
