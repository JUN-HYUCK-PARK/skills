// Engine name → compose service, container, provision method. This table is
// all setup knows; add a row when you add an engine to compose.
export const ENGINES = {
  mysql: { service: 'mysql8', container: 'dev-mysql8', composeProfile: null, provision: 'mysql' },
  pg: { service: 'pg16', container: 'dev-pg16', composeProfile: null, provision: 'pg' },
  redis: { service: 'redis7', container: 'dev-redis7', composeProfile: null },
  kafka: { service: 'kafka', container: 'dev-kafka', composeProfile: 'kafka' },
  mongo: { service: 'mongo7', container: 'dev-mongo7', composeProfile: 'mongo' },
  mail: { service: 'mailpit', container: 'dev-mailpit', composeProfile: 'mail' },
  minio: { service: 'minio', container: 'dev-minio', composeProfile: 'minio' },
};
export const ALIASES = { postgres: 'pg', postgresql: 'pg', mailpit: 'mail', s3: 'minio' };
