# Money-Total-Sheet

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
```


Apply and Run!
Stop your existing broken containers: docker-compose -f docker-compose.dev.yml down -v

Start them up so they load the newly attached .env file: docker-compose -f docker-compose.dev.yml up -d --build

Run your migration script: python manage_db.py update -m "Initial tables"