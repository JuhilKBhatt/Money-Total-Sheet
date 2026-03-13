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