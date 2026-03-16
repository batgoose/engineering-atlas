# Ansible Bootstrap (Versioned NFL DB)

This is an optional wrapper around the local shell scripts:

- `scripts/nfl/create_version_overlay.sh`
- `scripts/nfl/bootstrap_versioned_db.sh`

Use it when you want one command that is easy to reuse in CI or on a fresh machine.

## Requirements

- Ansible installed on the host
- Docker + Docker Compose plugin installed
- Repo cloned locally

## Quick start (v3)

```bash
ansible-playbook \
  -i infrastructure/ansible/inventory/localhost.yml \
  infrastructure/ansible/playbooks/bootstrap_nfl_version.yml \
  -e nfl_version=3
```

## Useful overrides

```bash
# Restrict raw ingest year range
ansible-playbook \
  -i infrastructure/ansible/inventory/localhost.yml \
  infrastructure/ansible/playbooks/bootstrap_nfl_version.yml \
  -e nfl_version=3 \
  -e nfl_start_year=2020 \
  -e nfl_end_year=2025

# Include ESPN sync and strict QA
ansible-playbook \
  -i infrastructure/ansible/inventory/localhost.yml \
  infrastructure/ansible/playbooks/bootstrap_nfl_version.yml \
  -e nfl_version=3 \
  -e nfl_include_espn_sync=true \
  -e nfl_strict_qa=true
```

## Notes

- The playbook creates `docker-compose.nfl-vN.yml` if missing.
- Django aliases like `nfl_v3` are auto-registered from env vars such as
  `NFL_DATABASE_V3_URL` in `apps/api-django/config/settings.py`.
- This does not change cutover defaults; it only provisions and populates a new
  versioned database.
