# runtime-profile.yml — 프로젝트가 소유하는 값

프로젝트 루트의 `.agents/runtime-profile.yml`. 스킬은 패턴을 말하고, 이 파일은
그 패턴에 들어가는 이 프로젝트의 값을 말한다. **스킬 본문을 복사해 오지 마라** —
여기에는 값·경로·명령만 둔다. 최상위 키는 `version` `project` `addressing`
`runtime` `services` `overlay` `data` 만 — `qa` 같은 모르는 키는
`devinfra validate` 가 거절한다.

## 전체 스키마 (주석이 스펙이다)

```yaml
version: 1

project:
  slug: myproject               # 호스트네임·머신 등록부에 쓰는 식별자
  # namespace: myproject_dev    # 모든 내부 분리 단위의 공통 이름. 생략하면 slug
  # host: myproject             # DNS 라벨. 생략하면 slug의 _→-

addressing:
  tld: local.myproject.dev      # 머신 공용 와일드카드 네임스페이스 (아래 참조)
  # proxy: none                 # 생략=none. none|machine|project|portless
  scheme:
    shared: "{service}.{tld}"
    overlay: "{service}--{env}.{tld}"
    # 한 머신에 여러 프로젝트면: "{service}.{project}.{tld}"
  ports:
    blocks: { api: 5000, web: 5100, infra: 7000 }
    registry: README.md         # 포트 등록부 정본의 위치. 여기와 다르면 저기가 이긴다

runtime:
  default: developer
  single_stack: true            # 불변식 — false로 바꿀 수 없다
  writers: 1                    # 불변식 — 늘릴 수 없다
  profiles:
    planner:                    # 가벼운 확인·기획용
      backend: docker-compose
      compose_file: docker-compose.yml
    developer:                  # overlay가 필요한 개발용. 필요 없으면 생략
      backend: k3d
      cluster: local
  commands:                     # 스킬 절차가 호출할 실제 명령
    profile: node tools/dev-environment.mjs profile
    status: node tools/dev-environment.mjs status
    up: node tools/dev-environment.mjs up --apply
    overlay: node tools/dev-overlay.mjs   # overlay: none이면 생략

services:
  my-api:
    kind: api
    port: 5001
    health: /api/health         # 실측해서 적는다. 앱마다 다르고 추측하면 404다
    reflect: rebuild            # source | rebuild | restart
  my-web:
    kind: web
    port: 5101
    health: /
    reflect: source

overlay:                        # 단일 서비스 프로젝트면 `overlay: none`
  attachable: [my-web, my-api]
  shared_only: [auth-api]       # 인증·스케줄러·컨슈머류 — 절대 attach 금지
  image_tag: full-git-sha

data:
  infra: machine                # machine(기본) | project(레거시 — 이관 전만)
  engines:                      # machine: 머신 인프라에서 쓰는 엔진과 내부 단위
    mysql: [myproject]          #   bin/provision 으로 만든 database 이름들
    redis: { prefix: "myproject:" }
  migrate: pnpm run db:migrate:local
  fixtures: [ui, official-api, fixture-endpoint, seed-script]
  forbid_direct_db_writes: true # 불변식
```

## 값을 정하는 법

### addressing.proxy

이 프로젝트 호스트네임을 **누가 듣는지**. 머신 Caddy를 쓸지와 다르다.

| 값 | 의미 |
| --- | --- |
| `none` (생략 기본) | URL만 그린다. 리스너를 안 연다 |
| `machine` | 이 레포 Caddy가 `{service}.{project}.{tld}` 를 듣는다 |
| `project` | 프로젝트(k3d Gateway 등)가 듣는다. 머신 Caddy 라우트에서 빠진다 |
| `portless` | 호스트 프로세스 래퍼. 머신 폴스루의 정본이 아니다 |

k3d가 이미 `:80`을 쓰는 프로젝트는 `project`를 **명시**한다. 생략이 `machine`이면 setup만으로 그 포트를 뺏는다.

### addressing.tld — "다양한 도메인"의 자리

머신에 와일드카드 네임스페이스 **하나**를 정하고 모든 프로젝트가 그 안에서
산다. 선택지는 세 가지, 위에서부터 좋다:

| 방식 | HTTPS | 셋업 | 언제 |
| --- | --- | --- | --- |
| 소유한 실도메인 (`*.local.example.co.kr` → 127.0.0.1) | 실인증서 가능 (DNS-01) | DNS 레코드 1개 | OAuth 리다이렉트·팀 공유 URL이 필요할 때 |
| `*.localhost` | mkcert 자체서명 | 없음 (OS가 루프백 해석) | 개인 머신, 외부 콜백 없음 |
| dnsmasq 커스텀 TLD | mkcert | dnsmasq 설치 | 실도메인이 없고 localhost가 안 맞을 때 |

프록시는 `portless`(`PORTLESS_TLD`가 이미 파라미터다), traefik, caddy 중
프로젝트가 정한다. 어느 것이든 **도메인 네임스페이스는 머신에 하나만** —
프로젝트마다 새 TLD를 만들면 인증서·신뢰 설정이 프로젝트 수만큼 늘어난다.

### runtime.profiles — 티어를 고르는 기준

```
서비스 1~2개, 병렬 에이전트 없음   → planner(compose)만. developer 생략
멀티서비스, 병렬 에이전트          → developer 추가. backend는:
  k8s로 배포하는 프로젝트           → k3d (매니페스트 재사용)
  그 외                             → compose + 프록시 라우팅으로 충분
```

developer(k3d)를 넣는 순간 SHA별 이미지 빌드 파이프라인이 전제된다. 그 비용을
낼 프로젝트인지 먼저 판단하라.

### ports.blocks

**앱** 포트 얘기다 — 인프라 엔진은 머신 공유(dev-infra `infra/`, 표준 포트)라서
프로젝트 포트 계획에 들어가지 않는다. 층별 블록(api/web)은 관례일 뿐 값은
자유다. 한 머신에서 여러 프로젝트가 고정 포트를 쓰면 블록이 겹치지 않게
프로젝트별로 100 단위를 할당한다. 프록시 라우팅을 쓰면 포트는 내부 관심사가
되므로 겹침 압력 자체가 준다.

### data.infra

기본은 `machine`: 엔진은 dev-infra의 머신 공유 인프라를 쓰고, 이 프로젝트는
자기 database·프리픽스만 선언한다. `project`는 프로젝트가 아직 인프라를 직접
띄우는 이관 전 상태를 기록하는 값이다 — 새 프로젝트가 고를 값이 아니다.

### project.namespace — 분리 단위의 공통 이름

머신 공유 인프라에서 이 프로젝트를 가르는 모든 이름이 여기서 나온다:
database(`<ns>`), redis 키 프리픽스(`<ns>:`), kafka 토픽·그룹
프리픽스(`<ns>.`), minio bucket, 그리고 developer(k3d) 백엔드를 쓰면 앱 층의
k8s namespace까지 같은 이름으로 잇는다. 엔진별 선언은 이 기본값을 덮어쓸
때만 쓴다.

엔진마다 문자 제약이 달라 셋팅 도구가 자동 변환한다: database에서는
`-`→`_`, bucket·k8s에서는 `_`→`-`. 변환이 싫으면 처음부터 `[a-z][a-z0-9]*`
로 지으면 어디서나 원형 그대로다.

### data.engines — 선언이 곧 셋팅 입력이다

`devinfra setup <프로젝트 루트>` 가 이 선언을 읽어 필요한 엔진만 기동하고
database를 멱등 프로비저닝한다. 값 형태:

| 엔진                       | 값                                        | 셋팅이 하는 일               |
| -------------------------- | ----------------------------------------- | ---------------------------- |
| `mysql` / `pg` (postgres)  | `true`(= slug) 또는 `[db이름, …]`         | database + 전용 계정 생성    |
| `redis`                    | `true` 또는 `{ prefix: "slug:" }`         | 기동만 — 프리픽스는 앱 규약  |
| `kafka`                    | `true` 또는 `{ topic_prefix: "slug." }`   | 기동만 — 프리픽스는 앱 규약  |
| `mongo`                    | `true` 또는 `[db이름, …]`                 | 기동만 — DB는 접속 시 생성   |
| `mail` / `minio`           | `true` (minio는 `{ bucket }` 가능)        | 기동만                       |

여기 없는 엔진 이름은 셋팅이 거절한다 — dev-infra의 compose와 ENGINES 표에
엔진을 먼저 추가한 뒤에 선언한다.

### services.*.health / reflect

**실측해서 적는다.** health는 실제로 200이 나온 경로를, reflect는 변경 하나를
넣고 반영되는 방식을 확인한 뒤에 적는다. 잰 날짜를 주석으로 남기면 다음
사람이 낡음을 의심할 수 있다.

## 검증

프로파일을 쓰거나 고친 뒤:

1. `commands.status`가 실제로 돌고 서비스 목록과 일치하는가.
2. health 경로 전부에 요청을 보내 기대 응답을 받는가 (0개 확인은 확인이
   아니다 — 몇 개 중 몇 개가 응답했는지 센다).
3. 주소 스킴대로 만든 호스트네임 하나가 실제로 라우팅되는가.
4. 포트 등록부(`ports.registry`)와 이 파일이 일치하는가.
