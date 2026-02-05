.PHONY: dev dev-backend dev-frontend build-frontend preview-frontend \
	docker-up docker-down docker-logs db-up db-down

dev:
	$(MAKE) -j 2 dev-backend dev-frontend

dev-backend:
	cd backend && go run .

dev-frontend:
	cd frontend && npm run dev

build-frontend:
	cd frontend && npm run build

preview-frontend:
	cd frontend && npm run preview

docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

db-up:
	docker compose up -d db

db-down:
	docker compose stop db
