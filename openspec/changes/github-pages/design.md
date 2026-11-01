# Design
## Context
Vite собирает dist. Camera уже использует import.meta.env.BASE_URL; модели находятся в Git, WASM копируется из зависимости при сборке.
## Decisions
- Использовать штатные configure-pages, upload-pages-artifact и deploy-pages.
- Передать base_path из configure-pages в CLI Vite, без отдельной конфигурации сборщика.
- Node 24 и фиксированная версия pnpm, установка с frozen lockfile; тесты до сборки.
- Публиковать только dist, ограничить запуск веткой main. Секреты вручную не нужны.
## Risks / Trade-offs
Pages должен быть включён пользователем через Settings → Pages → GitHub Actions. Локальная проверка подтверждает сборку и пути; реальный workflow проверяется после отправки коммита.
