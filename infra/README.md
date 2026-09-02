# 머신 공유 인프라

이 머신의 **모든 프로젝트**가 쓰는 데이터베이스·캐시·브로커. 프로젝트마다
MySQL·Redis·PG를 새로 띄우지 않는다.

원칙은 하나다: **엔진은 머신에 하나, 분리는 엔진 안에서.** 머신에 하나뿐이므로
포트도 표준 포트 그대로다 — 모든 도구의 기본 설정이 그냥 맞는다. 분리는 포트가
아니라 엔진의 내부 단위로 한다:

| 엔진     | 분리 단위                            | 만드는 법                          |
| -------- | ------------------------------------ | ---------------------------------- |
| MySQL    | database + 전용 계정                 | `bin/provision mysql <slug>`       |
| Postgres | database + 전용 role                 | `bin/provision pg <slug>`          |
| Redis    | 키 프리픽스 `<slug>:` (기본)         | 규약 — 앱 설정에 프리픽스 지정     |
|          | 또는 논리 DB 번호 (0–15)             | 아래 등록부에 번호를 적고 사용     |
| Kafka    | 토픽·컨슈머그룹 프리픽스 `<slug>.`   | 규약                               |
| Mongo    | database                             | 접속 시 자동 생성                  |
| MinIO    | bucket `<slug>-*`                    | 콘솔 또는 mc로 생성                |

이 내부 단위들의 공통 이름이 프로젝트 **namespace**다 — 프로파일의
`project.namespace`(기본 = slug) 하나에서 database·프리픽스·bucket 이름이
전부 나오고, k8s를 쓰는 프로젝트는 앱 층의 k8s namespace도 같은 이름으로
잇는다. 엔진별 문자 제약(`-`/`_`)은 셋팅 도구가 변환한다.

계정이 자기 database에만 GRANT되어 있는 것이 프로젝트 간 경계다. root/postgres
계정은 프로비저닝 전용이지 앱 접속용이 아니다.

## 시작

CLI(체크아웃에서 `npm install && npm link` 후 `de-novo-skills`)가 정면이고,
compose가 바닥이다:

```bash
de-novo-skills up              # 기본 3종 (mysql pg redis)
de-novo-skills up kafka        # 선택 엔진 추가
de-novo-skills status          # 엔진별 상태와 준비 수
# 같은 일: docker compose -f infra/docker-compose.yml [--profile kafka] up -d --wait
```

`restart: unless-stopped`라서 Docker 엔진(OrbStack/Docker Desktop)이 로그인 시
뜨면 인프라도 따라 뜬다. "매번 띄우는 일"은 여기서 끝난다.

성공 판정은 명령 종료코드가 아니라 결과물이다:

```bash
docker compose -f infra/docker-compose.yml ps   # 전부 healthy 인지 센다
```

## 엔진 목록

전부 127.0.0.1, 표준 포트. 자격증명은 로컬 개발 전용.

| 엔진        | 컨테이너    | 접속                        | 프로필 |
| ----------- | ----------- | --------------------------- | ------ |
| MySQL 8.4   | dev-mysql8  | localhost:3306 (root/root)  | 기본   |
| Postgres 16 | dev-pg16    | localhost:5432 (postgres/…) | 기본   |
| Redis 7     | dev-redis7  | localhost:6379              | 기본   |
| Kafka 3.9   | dev-kafka   | localhost:9092              | kafka  |
| Mongo 7     | dev-mongo7  | localhost:27017             | mongo  |
| Mailpit     | dev-mailpit | SMTP 1025 · UI 8025         | mail   |
| MinIO       | dev-minio   | 9000 · 콘솔 9001            | minio  |

프로젝트 compose 안의 컨테이너에서 붙을 때는 `host.docker.internal:<port>`,
또는 external 네트워크 `dev-infra`에 조인해서 컨테이너 이름으로
(kafka는 `dev-kafka:19092`).

새 메이저 버전이 필요하면 기존 컨테이너를 갈지 않고 별도 서비스로 나란히
띄운다(그때만 비표준 포트가 생긴다) — 다른 프로젝트가 기존 버전 위에 살고 있다.

## 프로젝트 온보딩과 등록부

프로젝트가 쓰는 엔진은 그 프로젝트의 `.agents/runtime-profile.yml`
(`data.engines`)이 정본이다. 셋팅은 그 yml을 읽어서 한다:

```bash
de-novo-skills setup <프로젝트 루트>   # 선언된 엔진 기동 + DB 프로비저닝, 멱등
```

`de-novo-skills provision (mysql|pg) <이름>` 은 setup이 쓰는 저수준 도구다 —
프로파일 없이 급히 DB 하나 만들 때만 직접 쓴다.

database·계정 이름은 프로젝트 slug, 한 프로젝트가 여러 개면 `<slug>_<용도>`.

온보딩하면 **git에 안 들어가는 로컬 등록부**에 한 줄 추가한다 — 어느 머신에
어떤 프로젝트가 사는지는 머신의 상태지 이 레포의 내용이 아니다:

```
infra/registry.local.md        (.gitignore 됨 — 이 머신의 분할 등록부 정본)
```

형식 (가상 예시):

| 프로젝트 | 엔진         | namespace | 비고                    |
| -------- | ------------ | --------- | ----------------------- |
| acme     | mysql, redis | acme      | db+계정 acme, 프리픽스 acme: |

## 규칙 (약화 금지)

- **프로젝트는 여기 있는 엔진을 자기 compose에 다시 선언하지 않는다.** 두
  인스턴스가 생기는 순간 "지금 어느 DB를 보고 있나"에 답이 없어진다.
- **프로젝트도 에이전트도 머신 인프라를 내리거나 재시작하지 않는다.** 다른
  프로젝트가 지금 그 위에서 돌고 있다. 문제가 있으면 사람이 결정한다.
- **다른 프로젝트의 database·프리픽스에 붙지 않는다.**
- 실데이터·실비밀을 넣지 않는다.
- 데이터는 named volume에 산다. `docker compose down -v`는 **모든 프로젝트의
  로컬 데이터**를 지우는 파괴적 명령이다 — 지울 일이 있으면 개별 볼륨만.

## 기존 프로젝트 이관

자기 compose/k8s 스택 안에 인프라를 소유하던 프로젝트는 점진 이관한다. 기존
스택이 비표준 포트를 쓰고 있었다면 머신 인프라(표준 포트)와 **동시에 떠도
충돌이 없다.** 절차: ① `provision`으로 database 생성 ② 앱 설정의 인프라
주소를 머신 인프라로 변경 ③ 마이그레이션·데이터 이전 ④ 프로젝트 스택에서
인프라 서비스 제거. 두 벌이 공존하는 동안 "지금 어느 쪽을 보고 있나"는 앱
설정으로 판정한다 — 추측하지 않는다. 프로젝트별 이관 상태는
`registry.local.md`에 적는다.
