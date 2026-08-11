# Convenience targets for local (source-built) deployments.
#
# The admin "Update available" check compares the image's baked APP_VERSION
# against the latest commit on UPDATE_CHECK_BRANCH. A plain `docker compose up
# --build` bakes APP_VERSION=dev, which the check treats as "no comparison" so
# it never reports an update. These targets stamp the real git SHA instead.

# Default stack: everything in ONE container (docker-compose.yml →
# Dockerfile.single). PostgreSQL, web + embedded slicer proxy/MCP, poller and
# exporter, with no nginx, Redis or Prometheus.
.PHONY: up
up:
	APP_VERSION=$$(git rev-parse HEAD) docker compose up -d --build

.PHONY: logs
logs:
	docker compose logs -f

# Original eight-service stack (docker-compose.multi.yml). Use it when you need
# nginx's rate limiting, Redis, the bundled Prometheus, the Watchtower one-click
# update path, poller sharding, or per-service scaling.
.PHONY: up-multi
up-multi:
	APP_VERSION=$$(git rev-parse HEAD) docker compose -f docker-compose.multi.yml up -d --build

# Multi-container stack: rebuild just the web image/container with the current
# SHA baked, then bounce nginx (recreating only `web` can leave nginx pointing at
# the old container IP).
.PHONY: up-web
up-web:
	APP_VERSION=$$(git rev-parse HEAD) docker compose -f docker-compose.multi.yml up -d --build web
	docker compose -f docker-compose.multi.yml restart nginx

# Pull + run the CI-published images (full one-click "Update now" flow via
# Watchtower). Multi-container only — requires IMAGE_PREFIX + WATCHTOWER_TOKEN
# in .env.
.PHONY: up-deploy
up-deploy:
	docker compose -f docker-compose.multi.yml -f docker-compose.deploy.yml pull
	docker compose -f docker-compose.multi.yml -f docker-compose.deploy.yml up -d
