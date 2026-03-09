# 원가 분석 프로그램

버셀에 공유 배포할 수 있도록 구성한 원가 운영 대시보드입니다.

## 실행

```bash
npm install
npm start
```

브라우저에서 `http://localhost:3000` 으로 접속합니다.

## 주요 구조

- `index.html`: 공유 URL의 메인 대시보드 진입점
- `public/app.js`: 한국어 UI, 원가 계산, 매출 예측, 서버 동기화 로직
- `api/state.js`: 공용 상태 조회/저장 API
- `api/extract.js`: 공급 링크 정보 추출 API
- `lib/state-store.js`: 로컬 개발용 파일 저장 + Vercel Blob 영구 저장 어댑터

## 포함 기능

- 식자재 정보: CSV 업로드, 링크 저장, 공급 정보 수정, 링크 메타데이터 추출
- 원가계산: 메뉴별 구성 변경, 사용 중량 기반 원가 계산, 원가율/수익률 표시
- 매출 예상: 일 매출, 월 매출, 고정비, 감가상각, 플랫폼/카드 수수료, 영업이익 대시보드
- 공용 저장: 여러 사용자가 같은 데이터를 보고 수정할 수 있도록 `/api/state` 기준으로 동기화

## CSV 권장 컬럼

`name,link,category,supplyWeight,supplyUnit,supplyPrice,vatRate,vendor,prepMethod,measureMethod`

## Vercel 배포

1. 저장소를 Vercel에 연결합니다.
2. Vercel Blob 스토어를 프로젝트에 연결합니다.
3. 환경 변수 `BLOB_READ_WRITE_TOKEN` 이 설정되어 있는지 확인합니다.
4. 배포 후 루트 URL에서 바로 대시보드가 열립니다.

로컬에서는 `.data/shared-state.json` 에 저장되고, Vercel에서는 Blob에 `cost-dashboard/shared-state.json` 으로 영구 저장됩니다.

## 참고

- 정확한 계산을 위해 브라우저에서는 4자리 고정소수점 정밀도 기반 계산을 사용합니다.
- 링크 자동 분석은 각 상품 페이지의 메타 태그와 JSON-LD를 읽는 방식입니다.
- 실제 `.xlsx` 직접 파싱과 더 정밀한 공급처별 추출 로직은 다음 단계에서 추가할 수 있습니다.
