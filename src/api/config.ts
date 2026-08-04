// EXPO_PUBLIC_* vars are inlined at build time by Expo. Set in .env for
// dev; for release builds set it in eas.json (Task 16).
export const API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000';
