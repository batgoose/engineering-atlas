.PHONY: format format-python format-js format-rust format-go format-check check lint lint-python lint-js lint-go lint-fix lint-fix-js test nfl-overlay nfl-bootstrap

format: format-python format-js format-rust format-go

format-python:
	docker compose exec api-django black /app

format-js:
	pnpm exec prettier --write "**/*.{js,jsx,ts,tsx,json,css,md}" --ignore-path .gitignore

format-rust:
	docker compose run --rm --no-deps service-rust cargo fmt

format-go:
	docker compose exec service-go go fmt ./...

format-check:
	docker compose exec api-django black --check /app
	pnpm exec prettier --check "**/*.{js,jsx,ts,tsx,json,css,md}" --ignore-path .gitignore
	docker compose run --rm --no-deps service-rust cargo fmt -- --check
	docker compose exec service-go sh -c 'if [ -n "$$(gofmt -l .)" ]; then echo "Go code needs formatting"; exit 1; fi'

check: format-check lint-js lint-go

lint: lint-python lint-js lint-go

lint-python:
	docker compose exec api-django black --check /app

lint-js:
	docker compose exec web-next pnpm lint

lint-go:
	docker compose exec service-go golangci-lint run ./...

lint-fix: lint-fix-js

lint-fix-js:
	docker compose exec web-next pnpm lint -- --fix

test:
	docker compose exec api-django pytest -v
	docker compose run --rm -e TEST_DATABASE_URL=postgres://admin:password@postgres-nfl:5432/nfl_data service-rust cargo test
	docker compose exec web-next pnpm test
	cd packages/ui && pnpm test
	pnpm --filter @atlas/web-next exec vitest --root ../.. run packages/sdk/src/__tests__
	docker compose exec service-go go test ./...

restart:
	docker compose restart

logs:
	docker compose logs -f

shell-django:
	docker compose exec api-django python manage.py shell

shell-next:
	docker compose exec web-next sh

shell-rust:
	docker compose run --rm service-rust sh

shell-go:
	docker compose exec service-go sh

check-nfl:
	docker compose exec api-django python manage.py check_data_health --verbose

nfl-overlay:
	./scripts/nfl/create_version_overlay.sh --version $(if $(VERSION),$(VERSION),3)

nfl-bootstrap:
	./scripts/nfl/bootstrap_versioned_db.sh --version $(if $(VERSION),$(VERSION),3)
