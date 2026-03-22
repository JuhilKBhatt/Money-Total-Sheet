# Money-Total-Sheet

make .env file 

"
POSTGRES_USER=
POSTGRES_PASSWORD=
POSTGRES_DB=
DATABASE_URL=postgresql://:@db:5432/

VITE_API_URL=
"

## 2.2 - Deployment

### 2.2.1 - Development

Run:

```
docker-compose -f docker-compose.dev.yml down

docker-compose -f docker-compose.dev.yml up --build -d
```

### 2.2.2 - Production

Run:

```
docker-compose -f docker-compose.prod.yml down

docker-compose -f docker-compose.prod.yml up --build -d

wait for 10sec

docker-compose -f docker-compose.prod.yml exec backend python migrate_excel.py
```

go to http://localhost:8080

Add Yards, Currencies, Weight Units
