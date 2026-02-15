import os
import sys
from pathlib import Path
import environ

env = environ.Env(DEBUG=(bool, False))
BASE_DIR = Path(__file__).resolve().parent.parent
environ.Env.read_env(os.path.join(BASE_DIR, ".env"))

SECRET_KEY = env("SECRET_KEY")
DEBUG = env("DEBUG")

ALLOWED_HOSTS = [
    "localhost",
    "127.0.0.1",
    "api.localhost",
    "lxjshlcs-80.use2.devtunnels.ms",
    "lxjshlcs-8000.use2.devtunnels.ms",
]

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
    "gridstream",
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

CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://app.localhost",
    "https://app.localhost",
    "https://lxjshlcs-3000.use2.devtunnels.ms",
]

CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOW_CREDENTIALS = True

CORS_ALLOW_METHODS = [
    "DELETE",
    "GET",
    "OPTIONS",
    "PATCH",
    "POST",
    "PUT",
]

CORS_ALLOW_HEADERS = [
    "accept",
    "accept-encoding",
    "authorization",
    "content-type",
    "dnt",
    "origin",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
]

CORS_PREFLIGHT_MAX_AGE = 86400

CSRF_TRUSTED_ORIGINS = [
    "http://localhost:3000",
    "http://app.localhost",
    "https://lxjshlcs-3000.use2.devtunnels.ms",
]

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

# databases
# default is atlas core app, nfl is the gridstream app plus raw nflverse plays

DATABASES = {
    "default": env.db(),
    "nfl": env.db("NFL_DATABASE_URL"),
}

DATABASE_ROUTERS = ["gridstream.db_router.GridstreamRouter"]

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"
    },
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_FILTER_BACKENDS": ["django_filters.rest_framework.DjangoFilterBackend"],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.AllowAny",
    ],
}

REDIS_URL = env("REDIS_URL", default="redis://localhost:6379/0")

MINIO_ENDPOINT = env("MINIO_ENDPOINT", default="localhost:9000")
MINIO_ACCESS_KEY = env("MINIO_ACCESS_KEY", default="atlas_admin")
MINIO_SECRET_KEY = env("MINIO_SECRET_KEY", default="atlas_password")
MINIO_USE_SSL = env.bool("MINIO_USE_SSL", default=False)

if "test" in sys.argv or "pytest" in sys.modules:
    db_host = "localhost" if os.getenv("CI") else "postgres-atlas"
    nfl_db_host = "localhost" if os.getenv("CI") else "postgres-nfl"
    nfl_db_port = "5433" if os.getenv("CI") else "5432"

    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": "atlas_db",
            "USER": "atlas_user",
            "PASSWORD": "atlas_password",
            "HOST": db_host,
            "PORT": "5432",
            "TEST": {
                "NAME": "test_atlas_db",
            },
        },
        "nfl": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": "nfl_data",
            "USER": "admin",
            "PASSWORD": "password",
            "HOST": nfl_db_host,
            "PORT": nfl_db_port,
            "TEST": {
                "NAME": "test_nfl_data",
                "DEPENDENCIES": [],
            },
        },
    }
