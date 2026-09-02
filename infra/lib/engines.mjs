// 엔진 이름 → compose 서비스·컨테이너·프로비저닝 방법. 이 표가 setup이 아는
// 전부이며, compose 파일에 새 엔진을 더하면 여기도 같이 늘린다.
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
