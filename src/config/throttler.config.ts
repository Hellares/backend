export const throttlerConfig = [
  {
    name: 'auth-endpoints',
    ttl: 900000, // 15 minutes
    limit: 5, // 5 attempts per 15 minutes
  },
  {
    name: 'general-endpoints',
    ttl: 900000, // 15 minutes
    limit: 100, // 100 requests per 15 minutes
  },
  {
    name: 'password-reset',
    ttl: 3600000, // 1 hour
    limit: 3, // 3 password reset attempts per hour
  },
];