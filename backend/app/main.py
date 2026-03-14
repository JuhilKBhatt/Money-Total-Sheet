# ./backend/app/main.py
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List

import models, schemas, crud
from database import engine, get_db

# Create database tables automatically
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Money Total Sheet API")

# Setup CORS to allow React frontend to talk to FastAPI
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # For production, change this to ["http://localhost:8080"]
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/companies/", response_model=schemas.Company)
def create_company(company: schemas.CompanyCreate, db: Session = Depends(get_db)):
    return crud.create_company(db=db, company=company)

@app.get("/companies/", response_model=List[schemas.Company])
def read_companies(db: Session = Depends(get_db)):
    return crud.get_companies(db)

@app.post("/pickups/", response_model=schemas.Pickup)
def create_pickup(pickup: schemas.PickupCreate, db: Session = Depends(get_db)):
    return crud.create_pickup(db=db, pickup=pickup)

@app.get("/companies/{company_id}/pickups/", response_model=List[schemas.Pickup])
def read_pickups_for_company(company_id: int, db: Session = Depends(get_db)):
    return crud.get_pickups_by_company(db=db, company_id=company_id)

@app.post("/deductions/", response_model=schemas.Deduction)
def create_deduction(deduction: schemas.DeductionCreate, db: Session = Depends(get_db)):
    """Create a new standalone deduction for a company"""
    return crud.create_deduction(db=db, deduction=deduction)

@app.get("/companies/{company_id}/deductions/", response_model=List[schemas.Deduction])
def read_deductions_for_company(company_id: int, db: Session = Depends(get_db)):
    """Get all deductions for a specific company"""
    return crud.get_deductions_by_company(db=db, company_id=company_id)