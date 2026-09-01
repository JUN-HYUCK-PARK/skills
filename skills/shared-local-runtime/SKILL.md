---
name: shared-local-runtime
description: 병렬 에이전트를 위한 공유 로컬 런타임 운영 — 장수하는 공유 baseline 하나, 에이전트별 얇은 overlay, 호스트네임 폴스루 라우팅, 런타임 쓰기 단일 소유. 로컬 환경을 시작·점검·전환할 때, 여러 에이전트가 같은 머신에서 동시에 작업할 때, 새 프로젝트에 이 환경을 셋팅할 때 쓴다. 프로젝트 고유 값은 .agents/runtime-profile.yml에서 읽는다.
---

# 공유 로컬 런타임

여러 에이전트(워크트리)가 한 머신에서 동시에 일할 때 환경이 무너지는 방식은
정해져 있다: 포트 쟁탈, 중복 스택, 서로의 프로세스 킬, 유령 배포. 이 스킬은
그것을 막는 운영 모델이다.

**이 문서는 패턴만 말한다.** 도메인·포트·서비스 목록 같은 프로젝트 값은 그
프로젝트 루트의 `.agents/runtime-profile.yml`에 있다 — 작업 전에 먼저 읽어라.
프로파일이 없으면 [runtime-profile.md](references/runtime-profile.md)를 따라
만드는 것이 첫 작업이다.

## 운영 모델 — 네 기둥

### 1. 장수하는 공유 baseline 하나

공유는 두 층이다:

- **인프라 엔진(DB·캐시·브로커)은 머신에 하나.** 프로젝트가 소유하지 않는다.
  dev-infra의 `infra/`가 정본이며, 분리는 포트가 아니라 엔진 내부
  단위(database·계정·프리픽스)로 한다. 그 단위들의 공통 이름이 프로젝트
  **namespace**다(프로파일 `project.namespace`, 기본 = slug) — DB 이름·키
  프리픽스·토픽 프리픽스·k8s namespace가 전부 한 이름에서 나온다.
- **앱 baseline은 프로젝트당 하나.** 에이전트 수만큼 풀스택을 띄우지 않는다 —
  baseline 한 벌을 모두가 읽는다.

- 프로파일의 `runtime.profiles`가 실행 방식을 정한다. 가벼운 단계는
  docker-compose, overlay가 필요한 개발 단계는 k3d — 프로젝트가 고른다.
- 두 프로필은 같은 고정 포트를 소유하므로 **동시에 실행하지 않는다.** 전환은
  명시적으로: 기존 것을 내리고 새것을 올린다.

### 2. 에이전트별 얇은 overlay

에이전트가 자기 변경을 실행해 봐야 할 때는 풀스택 복제가 아니라 overlay를 쓴다:
**바꾼 서비스만** 자기 환경에 얹고, 나머지는 baseline으로 폴스루시킨다.

- overlay에 얹을 수 있는 서비스는 프로파일의 `overlay.attachable`이 정한다.
  `overlay.shared_only`에 있는 것(보통 인증·스케줄러·컨슈머)은 절대 얹지 않는다.
- developer(k3d) 백엔드에서는 앱 층도 같은 이름으로 구분한다: baseline은
  프로젝트 namespace, overlay 환경은 `<namespace>-<env>` namespace.
- overlay 이미지는 정확한 리비전(full git SHA)으로 태그한다. "최신"은 없다.
- 일이 끝나면 즉시 detach하고 환경을 destroy한다. overlay는 작업 수명이다.

### 3. 호스트네임 폴스루 라우팅

주소는 포트가 아니라 이름이다. 머신에 와일드카드 로컬 도메인 하나를 두고,
프로파일의 `addressing.scheme`이 이름 규칙을 정한다:

```
shared  : {service}.{tld}              baseline의 그 서비스
overlay : {service}--{env}.{tld}       env에 attach돼 있으면 overlay,
                                       아니면 자동으로 shared로 폴스루
```

여러 프로젝트를 한 머신에서 돌리면 스킴에 `{project}`를 넣어
`{service}.{project}.{tld}`로 충돌을 없앤다. TLD·프록시 선택지는
[runtime-profile.md](references/runtime-profile.md)의 addressing 절.

### 4. 런타임 쓰기 단일 소유

읽는 자는 많고 쓰는 자는 하나다 (`runtime.writers: 1`).

- **작업 워크트리에서 서비스를 기동하지 않는다.** 런타임 소유는 지정된 런타임
  환경에 있다.
- 에이전트는 공유 인프라를 시작·중지·재시작하지 않고, 공유 마이그레이션을
  돌리지 않고, 공유 DB에 직접 쓰지 않는다. 필요하면 소유자에게 선언한다.
- 데이터가 필요하면 프로파일의 `data.fixtures`가 허용한 경로(UI·공식 API·
  fixture 엔드포인트·시드 스크립트)로만 만들고, before/after probe를 남긴다.

## 절차

### 인프라 셋팅은 yml이 정본이다

프로젝트가 쓰는 엔진은 프로파일의 `data.engines` 선언이 전부다. 셋팅할 때
엔진을 손으로 고르지 말고 그 선언을 읽는 도구를 돌린다:

```bash
devinfra setup <프로젝트 루트>
# CLI 미설치면: node <dev-infra>/infra/bin/cli.mjs setup <프로젝트 루트>
```

선언된 엔진만 기동하고(`--wait`), database를 멱등 프로비저닝하고, 수를 붙인
요약(엔진 n/n, DB n/n)과 접속 URL을 출력한다. 새 엔진이 필요해지면 명령을
바꾸는 게 아니라 **yml에 선언을 추가하고 다시 돌린다.**

### 상태 확인이 항상 먼저다

무엇이든 하기 전에 현재 프로필과 상태를 조회한다. 프로파일의
`runtime.commands.status`가 명령을 정한다. "떠 있겠지"는 측정이 아니다 —
서비스별 health 엔드포인트(프로파일 `services.*.health`)를 실제로 친다.
health 경로는 앱마다 다르다. 추측하지 말고 프로파일을 읽어라.

### 시작과 전환

1. `status`로 현재 상태 확인. 다른 프로필이 떠 있으면 먼저 내린다.
2. plan-first: 적용 전에 무엇이 실행될지 출력하는 명령이 있으면 그것 먼저.
3. 시작 후 **결과물로 검증한다** — 명령이 0으로 끝난 것과 환경이 있는 것은
   다르다. health가 응답하는지, 인프라 포트가 열렸는지 센다.

### overlay 수명주기

```
create <env>                      환경 생성
attach <env> <service> --image <full-sha>   바꾼 서비스만
  → {service}--{env}.{tld} 로 검증
detach <env> <service>            그 오버라이드가 불필요해지는 즉시
destroy <env>                     작업 단위가 끝나면
```

### 반영 방식을 확인하고 나서 "안 바뀐다"고 말하라

서비스마다 변경 반영 방식이 다르다 — 프로파일의 `services.*.reflect`:

```
source    고치면 바로 반영
rebuild   다시 빌드 + 다시 띄워야 반영
restart   재시작만 필요 (env가 번들 시점에 박히는 류)
```

"화면이 안 바뀐다"의 최다 원인은 rebuild 서비스를 고쳐놓고 브라우저만 새로
고침하는 것이다.

## 새 프로젝트에 셋팅하기

1. [runtime-profile.md](references/runtime-profile.md)의 스키마를 따라 값을
   채운다. 인터뷰 순서: 서비스 목록 → 백엔드 티어 결정 → 주소 스킴 → 데이터
   정책. 예시는 [examples/](examples/)에 있다.
2. **티어를 과하게 잡지 마라.** 단일 서비스 프로젝트는 4번 기둥(주소·소유
   규칙)만 적용하고 overlay는 생략한다(`overlay: none`). k3d는 멀티서비스 +
   병렬 에이전트 + k8s 배포 대상일 때만 값이 있다.
3. 포트 등록부를 프로파일이 가리키는 파일(보통 README)에 두고, 그것을 정본으로
   선언한다. 등록부 밖의 임의 포트는 CORS·인증에서 먼저 죽는다.

## 약화 금지 목록

프로젝트가 프로파일로 바꿀 수 있는 것은 값이다. 다음은 값이 아니라 불변식이며,
프로파일로 약화할 수 없다:

- 상시 스택은 프로젝트당 하나 (`single_stack`)
- 런타임 쓰기 소유자는 하나 (`writers: 1`)
- 작업 워크트리에서 서비스 기동 금지
- 공유 DB 직접 쓰기 금지, fixture 경로로만 데이터 생성
- overlay 이미지는 정확한 리비전 태그
- 시작·설치의 성공 판정은 명령 종료코드가 아니라 결과물 존재
