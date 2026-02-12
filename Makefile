.PHONY: format format-python format-js format-rust format-go format-check check lint lint-python lint-js lint-go lint-fix lint-fix-js test

format: format-python format-js format-rust format-go

format-python:
	docker compose exec api-django black /app

format-js:
	pnpm exec prettier --write "**/*.{js,jsx,ts,tsx,json,css,md}" --ignore-path .gitignore

format-rust:
	docker compose exec service-rust cargo fmt

format-go:
	docker compose exec service-go go fmt ./...

format-check:
	docker compose exec api-django black --check /app
	pnpm exec prettier --check "**/*.{js,jsx,ts,tsx,json,css,md}" --ignore-path .gitignore
	docker compose exec service-rust cargo fmt -- --check
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
	docker compose exec api-django python manage.py test
	docker compose exec service-rust cargo test
	docker compose exec web-next pnpm test
	cd packages/ui && pnpm test
	# New: Go Tests
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
	docker compose exec service-rust sh

shell-go:
	docker compose exec service-go sh
