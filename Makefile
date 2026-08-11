# Convenience targets for local (source-built) deployments.
#
# The admin "Update available" check compares the image's baked APP_VERSION
# against the latest commit on UPDATE_CHECK_BRANCH. A plain `docker compose up
# --build` bakes APP_VERSION=dev, which the check treats as "no comparison" so
# it never reports an update. These targets stamp the real git SHA instead.

# Full stack, real version stamped.
.PHONY: up
up:
	APP_VERSION=$$(git rev-parse HEAD) docker compose up -d --build

# Rebuild just the web image/container with the current SHA baked, then bounce
# nginx (recreating only `web` can leave nginx pointing at the old container IP).
.PHONY: up-web
up-web:
	APP_VERSION=$$(git rev-parse HEAD) docker compose up -d --build web
	docker compose restart nginx

# Single-container deployment (Dockerfile.single): PostgreSQL, web + embedded
# slicer proxy/MCP, poller and exporter in ONE container. No nginx, Redis or
# Prometheus — see README "Single-container deployment".
.PHONY: up-single
up-single:
	APP_VERSION=$$(git rev-parse HEAD) docker compose -f docker-compose.single.yml up -d --build

.PHONY: logs-single
logs-single:
	docker compose -f docker-compose.single.yml logs -f

# Pull + run the CI-published images (full one-click "Update now" flow via
# Watchtower). Requires IMAGE_PREFIX + WATCHTOWER_TOKEN in .env.
.PHONY: up-deploy
up-deploy:
	docker compose -f docker-compose.yml -f docker-compose.deploy.yml pull
	docker compose -f docker-compose.yml -f docker-compose.deploy.yml up -d
