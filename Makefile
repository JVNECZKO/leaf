.PHONY: up down dev-backend dev-frontend build logs clean

up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose build

logs:
	docker compose logs -f

dev-backend:
	cd backend && go run main.go

dev-frontend:
	cd frontend && npm run dev

install-frontend:
	cd frontend && npm install

tidy:
	cd backend && go mod tidy

clean:
	docker compose down -v
	rm -rf frontend/node_modules frontend/.next
