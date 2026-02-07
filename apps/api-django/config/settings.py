# ============================================================================
# Django Settings Updates for Docker
# ============================================================================
# Add these configurations to your existing settings.py
# Replace the relevant sections with these Docker-aware versions
# ============================================================================

import os
from pathlib import Path
import environ

# 1. Environment Setup
env = environ.Env(DEBUG=(bool, False))
BASE_DIR = Path(__file__).resolve().parent.parent
environ.Env.read_env(os.path.join(BASE_DIR, ".env"))

# 2. Core Security Settings
SECRET_KEY = env("SECRET_KEY")
DEBUG = env("DEBUG")

# DOCKER UPDATE: Add both localhost and Traefik routing
ALLOWED_HOSTS = [
    "localhost",
    "127.0.0.1",
    "api.localhost",  # Traefik internal routing
    "lxjshlcs-80.use2.devtunnels.ms",  # VS Code tunnel (if used)
    "lxjshlcs-8000.use2.devtunnels.ms",  # Direct Django tunnel (if used)
]

# 3. Application Definition (unchanged)
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "django_filters",
    "drf_spectacular",
    "core",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

# DOCKER UPDATE: CORS Configuration for multiple frontends
CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",     # Next.js direct
    "http://app.localhost",      # Next.js via Traefik
    "http://angular.localhost",  # Angular via Traefik (future)
    "http://vue.localhost",      # Vue via Traefik (future)
    "http://svelte.localhost",   # Svelte via Traefik (future)
    "https://lxjshlcs-3000.use2.devtunnels.ms",  # Next.js tunnel
    "https://lxjshlcs-8000.use2.devtunnels.ms",  # ADD THIS LINE
]

CORS_ALLOW_ALL_ORIGINS = False  # Keep this False
CORS_ALLOW_CREDENTIALS = True

CORS_ALLOW_METHODS = [
    'DELETE',
    'GET',
    'OPTIONS',
    'PATCH',
    'POST',
    'PUT',
]

CORS_ALLOW_HEADERS = [
    'accept',
    'accept-encoding',
    'authorization',
    'content-type',
    'dnt',
    'origin',
    'user-agent',
    'x-csrftoken',
    'x-requested-with',
]

CORS_PREFLIGHT_MAX_AGE = 86400

# DOCKER UPDATE: CSRF Configuration
CSRF_TRUSTED_ORIGINS = [
    "http://localhost:3000",
    "http://app.localhost",
    "https://lxjshlcs-3000.use2.devtunnels.ms",
    "https://lxjshlcs-80.use2.devtunnels.ms",
    "https://lxjshlcs-8000.use2.devtunnels.ms"
]

# 5. Templates & WSGI (unchanged)
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# DOCKER UPDATE: Database Configuration
# Docker Compose will set DATABASE_URL environment variable
DATABASES = {
    "default": env.db(),  # Reads from DATABASE_URL
}

# Optional: Add NFL database if needed
# DATABASES["nfl"] = env.db("NFL_DATABASE_URL", default="")

# 7. Password Validation (unchanged)
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# 8. Internationalization (unchanged)
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# 9. Static Files (unchanged)
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# 10. API Settings (unchanged)
REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_FILTER_BACKENDS": ["django_filters.rest_framework.DjangoFilterBackend"],
    "DEFAULT_PERMISSION_CLASSES": [     # ADD THIS
        "rest_framework.permissions.AllowAny",
    ],
}

# DOCKER UPDATE: Optional Redis Configuration
REDIS_URL = env("REDIS_URL", default="redis://localhost:6379/0")

# DOCKER UPDATE: Optional MinIO Configuration
MINIO_ENDPOINT = env("MINIO_ENDPOINT", default="localhost:9000")
MINIO_ACCESS_KEY = env("MINIO_ACCESS_KEY", default="atlas_admin")
MINIO_SECRET_KEY = env("MINIO_SECRET_KEY", default="atlas_password")
MINIO_USE_SSL = env.bool("MINIO_USE_SSL", default=False)
