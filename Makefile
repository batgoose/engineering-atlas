.PHONY: format format-python format-js lint test

format: format-python format-js

format-python:
	docker compose exec api-django black /app

format-js:
	docker compose exec web-next npx prettier --write "**/*.{js,jsx,ts,tsx,json,css,md}"

format-check:
	docker compose exec api-django black --check /app
	docker compose exec web-next npx prettier --check "**/*.{js,jsx,ts,tsx,json,css,md}"

test:
	docker compose exec api-django python manage.py test
	docker compose exec web-next pnpm test

restart:
	docker compose restart

logs:
	docker compose logs -f

shell-django:
	docker compose exec api-django python manage.py shell

shell-next:
	docker compose exec web-next sh