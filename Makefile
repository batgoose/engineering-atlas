.PHONY: format format-python format-js format-rust format-go lint test

format: format-python format-js format-rust format-go

format-python:
	docker compose exec api-django black /app

format-js:
	docker compose exec web-next npx prettier --write '**/*.{js,jsx,ts,tsx,json,css,md}'

format-rust:
	docker compose exec service-rust cargo fmt

format-go:
	docker compose exec service-go go fmt ./...

format-check:
	docker compose exec api-django black --check /app
	docker compose exec web-next npx prettier --check "**/*.{js,jsx,ts,tsx,json,css,md}" --ignore-path .gitignore
	docker compose exec service-rust cargo fmt -- --check
	docker compose exec service-go sh -c 'if [ -n "$$(gofmt -l .)" ]; then echo "Go code needs formatting"; exit 1; fi'

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