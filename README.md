# Grove

de-novo 스킬. 한 머신에서 여러 프로젝트와 에이전트가 같이 쓰는 개발 땅.

이 레포는 Grove의 정본이다 — 패턴은 스킬, 공용 엔진은 `infra/`, 프로젝트
고유 값(도메인, 포트, 서비스 목록)은 각 프로젝트의 프로파일에 있다.
**여기를 고치면 모든 프로젝트가 따라오고, 프로파일을 고치면 그 프로젝트만
바뀐다.**

개발자·에이전트는 포트를 고르지 않는다. 이름 붙은 URL이 스택을 가리킨다.
확인 도구(브라우저·e2e)는 이 레포 밖이다.

한 머신에 **n개 프로젝트**, 프로젝트마다 **m개 앱**, 공용 인프라는 **한 벌**.

```
+----------------------------------------------------------------------------+
|                         one developer machine                              |
|                                                                            |
|  n projects  x  m apps each  x  1 shared infra                             |
|  pick hostnames, never ports                                               |
|                                                                            |
|    acme                      sideapp                    ... n              |
|    api.acme.localhost        web.sideapp.localhost            |            |
|    catalog.acme.localhost    api.sideapp.localhost            |            |
|    web.acme.localhost                |                        |            |
|    api--w1.acme.localhost  (overlay) |                        |            |
|             |                        |                        |            |
|             |                        |                        |            |
|             |                        |                        |            |
|       +-----+------------------------+------------------------+----+       |
|       | Caddy   127.0.0.1:80   one listener (opt-in)               |       |
|       +------------------------------------------------------------+       |
|       | route by hostname                                          |       |
|       | unattached overlay  ->  that project's baseline            |       |
|       +-----+------------------------+------------------------+----+       |
|             |                        |                        |            |
|             |                        |                        |            |
|  +----------+---------+   +----------+---------+   +----------+---------+  |
|  | PROJECT  acme      |   | PROJECT  sideapp   |   | PROJECT  n         |  |
|  +--------------------+   +--------------------+   +--------------------+  |
|  | baseline (1)       |   | baseline (1)       |   | .                  |  |
|  |  [api] [catalog]   |   |  [web] [api]       |   | .                  |  |
|  |  [web] [worker]    |   |                    |   | .                  |  |
|  |           m apps   |   |           m apps   |   |                    |  |
|  | overlay w1 [api]   |   | overlay: none      |   | (more projects)    |  |
|  |                    |   |                    |   |                    |  |
|  +----------+---------+   +----------+---------+   +----------+---------+  |
|             |                        |                        |            |
|             |                        |                        |            |
|             +------------------------+------------------------+            |
|                                      |                                     |
|                                      v                                     |
|       +------------------------------+-----------------------------+       |
|       | SHARED INFRA   (this repo, one set)                        |       |
|       +------------------------------------------------------------+       |
|       |                                                            |       |
|       |  +-------+   +-------+   +-------+   +-------+             |       |
|       |  | mysql |   |  pg   |   | redis |   | kafka |             |       |
|       |  | :3306 |   | :5432 |   | :6379 |   | :9092 |             |       |
|       |  +-------+   +-------+   +-------+   +-------+             |       |
|       |                                                            |       |
|       |  isolate by database / prefix, not port                    |       |
|       |    acme_      sideapp_      ..._                           |       |
|       +------------------------------------------------------------+       |
+----------------------------------------------------------------------------+
```

- 앱 baseline은 프로젝트당 하나. 에이전트 수만큼 풀스택을 안 띄운다.
- overlay는 바꾼 앱만. 안 붙인 `{app}--{env}` 호스트는 그 프로젝트 baseline으로 폴스루.
- 엔진은 머신에 하나. 프로젝트 분리는 포트가 아니라 database·prefix (`acme_` / `sideapp_`).

```
  이 레포                          소비 프로젝트
  --------                         --------------
  엔진 compose                     .agents/runtime-profile.yml 값
  머신 TLD · Caddy (옵트인)        앱 compose / k8s  (m개)
  overlay 라우팅 표                overlay 워크로드 기동 · 이미지 빌드
  프로파일 불변식                  runtime.commands.*
  스킬 정본                        확인 도구
```

```
infra/                      머신 공유 인프라 — MySQL·PG·Redis(+Kafka·Mongo·…) 한 벌.
                            엔진은 머신에 하나, 분리는 database·계정·프리픽스로
skills/grove/               Grove 스킬 정본
docs/unified-local-infra.md 설계
```

## 프로젝트에 적용하기

1. `devinfra init <프로젝트 루트>` — 최소 `.agents/runtime-profile.yml`을
   심는다 (`overlay: none`). `--slug` `--engines` `--services`로 값을 넣는다.
2. `devinfra validate <프로젝트 루트>` — docker 없이 불변식을 센다.
3. `devinfra setup <프로젝트 루트>` — yml을 읽어 필요한 엔진만 기동하고
   database를 프로비저닝한다. 멱등이라 몇 번을 돌려도 안전하다.

CLI 설치는 이 체크아웃에서 한 번: `npm install && npm link`. 그 뒤에는
어디서든 `devinfra init | validate | setup | up | status | provision` 을 쓴다 (링크 없이
`node infra/bin/cli.mjs …` 로도 동작한다). 내리는 명령은 일부러 없다 —
여러 프로젝트가 살고 있는 인프라의 중지는 사람이 직접 결정한다.
4. 스킬을 전역 스킬 디렉토리(`~/.claude/skills/` 등)에 두거나, 쓰는 에이전트
   도구의 스킬 공유 채널로 배포한다.
5. 프로젝트 안에서는 정본을 도구 중립 경로(`.agents/skills/`)에 두고, 도구별
   디렉토리(`.claude/skills/` 등)에는 symlink 어댑터만 둔다 — 본문을 어댑터에
   복사하지 않는다.

## 원칙

- 패턴과 값을 한 파일에 섞지 않는다. 섞는 순간 두 번째 프로젝트에서 갈라진다.
- 스킬 본문에 특정 프로젝트의 도메인·포트·서비스 이름을 적지 않는다.
  예시가 필요하면 `examples/`의 프로파일 인스턴스를 가리킨다.
