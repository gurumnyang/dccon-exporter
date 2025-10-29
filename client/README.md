# DCCon Exporter Client

Vue 3 + Vite 프런트엔드입니다. Cloudflare Pages에 정적 배포하고, API 서버는 별도의 도메인(예: 개인 서버)으로 접근하는 구성을 기준으로 합니다.

## 개발

```bash
npm install
npm run dev
```

## Cloudflare Pages 배포

1. **빌드**: `npm run build`
2. **미리보기**: 로컬에서 Cloudflare Pages 환경을 흉내 내고 싶다면  
   `npm run pages:preview`
3. **배포**: `npm run pages:deploy`  
   (처음 실행 시 `wrangler`가 Cloudflare 로그인을 안내합니다.)

### 프로젝트 설정

- Cloudflare Pages에서 저장소 루트는 `client`가 되도록 지정하세요.
- 빌드 명령: `npm run build`
- 출력 디렉터리: `dist`
- 환경 변수: `VITE_API_BASE_URL=https://your-api-domain.example.com`

배포 후에는 브라우저가 `VITE_API_BASE_URL`에 설정한 백엔드 도메인으로 요청합니다. 로컬에서는 기본값(`http://localhost:4000`)으로 동작합니다.

## 스크립트 요약

| 명령                 | 설명                                       |
| -------------------- | ------------------------------------------ |
| `npm run dev`        | 개발 서버 실행                             |
| `npm run build`      | 프로덕션 번들 생성                         |
| `npm run preview`    | Vite 미리보기                              |
| `npm run pages:preview` | Cloudflare Pages 미리보기 (로컬)         |
| `npm run pages:deploy`  | Cloudflare Pages 퍼블리시                |

> 참고: `wrangler` 스크립트는 프로젝트 이름을 지정하지 않았으므로 최초 실행 시 CLI 프롬프트에서 입력하면 됩니다. 필요하다면 `wrangler.toml`을 추가해 프로젝트 이름을 고정할 수도 있습니다.
