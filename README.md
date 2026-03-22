# Money-Total-Sheet

## 1 - Setup

Before deploying the application, you need to configure your environment variables. 

Create a `.env` file in the root directory of the project and add the following template. Be sure to fill in your specific credentials:

```
POSTGRES_USER=your_db_user
POSTGRES_PASSWORD=your_db_password
POSTGRES_DB=your_db_name
DATABASE_URL=postgresql://your_db_user:your_db_password@db:5432/your_db_name

VITE_API_URL=http://localhost:8001
```

## 2 - Deployment

### 2.1 - Development

To run the application in a local development environment (with hot-reloading enabled), run the following commands:

Run:

```
docker-compose -f docker-compose.dev.yml down

docker-compose -f docker-compose.dev.yml up --build -d
```

### 2.2 - Production

To deploy the application in a production-ready environment, run the following commands:

Run:

```
docker-compose -f docker-compose.prod.yml down

docker-compose -f docker-compose.prod.yml up --build -d
```

# 3 - Excel Data Migration (Optional)

If you have historical data in an .xlsx file that needs to be imported into the production database:

Wait for about 10 seconds after running the production startup commands to ensure the database has fully initialized.

Place your `.xlsx` file directly into the `./backend/` folder.

Execute the migration script by running:
`
docker-compose -f docker-compose.prod.yml exec backend python migrate_excel.py
`

# 4 - Post Deployment Steps
Once the containers are running and any data is migrated:

Open your web browser and go to: http://localhost:8080

Go to the Settings page in the app.

Manually add your required Yards, Currencies, and Weight Units before creating new transactions.