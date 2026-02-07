.PHONY: format format-python format-js format-rust lint test

format: format-python format-js format-rust

format-python:
	docker compose exec api-django black /app

format-js:
	docker compose exec web-next npx prettier --write "**/*.{js,jsx,ts,tsx,json,css,md}" --ignore-path .gitignore

format-rust:
	docker compose exec service-rust cargo fmt

format-check:
	docker compose exec api-django black --check /app
	docker compose exec web-next npx prettier --check "**/*.{js,jsx,ts,tsx,json,css,md}" --ignore-path .gitignore
	docker compose exec service-rust cargo fmt -- --check

test:
	docker compose exec api-django python manage.py test
	docker compose exec service-rust cargo test
	docker compose exec web-next pnpm test
	cd packages/ui && pnpm test

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