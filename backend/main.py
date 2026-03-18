# ./backend/main.py
from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List

import schemas, crud
from database import get_db
from utilities.backup_manager import start_backup_scheduler, create_on_update_backup

app = FastAPI(title="Money Total Sheet API")

@app.on_event("startup")
def startup_event():
    start_backup_scheduler()

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/companies/", response_model=schemas.Company)
def create_company(company: schemas.CompanyCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    res = crud.create_company(db=db, company=company)
    background_tasks.add_task(create_on_update_backup)
    return res

@app.get("/companies/", response_model=List[schemas.Company])
def read_companies(db: Session = Depends(get_db)):
    return crud.get_companies(db)

@app.post("/pickups/", response_model=schemas.Pickup)
def create_pickup(pickup: schemas.PickupCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    res = crud.create_pickup(db=db, pickup=pickup)
    background_tasks.add_task(create_on_update_backup)
    return res

@app.get("/companies/{company_id}/pickups/", response_model=List[schemas.Pickup])
def read_pickups_for_company(company_id: int, db: Session = Depends(get_db)):
    return crud.get_pickups_by_company(db=db, company_id=company_id)

@app.post("/deductions/", response_model=schemas.Deduction)
def create_deduction(deduction: schemas.DeductionCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    res = crud.create_deduction(db=db, deduction=deduction)
    background_tasks.add_task(create_on_update_backup)
    return res

@app.get("/companies/{company_id}/deductions/", response_model=List[schemas.Deduction])
def read_deductions_for_company(company_id: int, db: Session = Depends(get_db)):
    return crud.get_deductions_by_company(db=db, company_id=company_id)

@app.put("/companies/{company_id}", response_model=schemas.Company)
def update_company(company_id: int, company: schemas.CompanyUpdate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    db_company = crud.update_company(db, company_id=company_id, company=company)
    if db_company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    background_tasks.add_task(create_on_update_backup)
    return db_company

@app.delete("/companies/{company_id}")
def delete_company(company_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    db_company = crud.delete_company(db, company_id=company_id)
    if db_company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    background_tasks.add_task(create_on_update_backup)
    return {"detail": "Company deleted successfully"}

# --- Yard Routes ---
@app.post("/yards/", response_model=schemas.Yard)
def create_yard(yard: schemas.YardCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    res = crud.create_yard(db=db, yard=yard)
    background_tasks.add_task(create_on_update_backup)
    return res

@app.get("/yards/", response_model=List[schemas.Yard])
def read_yards(db: Session = Depends(get_db)):
    return crud.get_yards(db)

@app.delete("/yards/{yard_id}")
def delete_yard(yard_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    db_yard = crud.delete_yard(db, yard_id=yard_id)
    if db_yard is None:
        raise HTTPException(status_code=404, detail="Yard not found")
    background_tasks.add_task(create_on_update_backup)
    return {"detail": "Yard deleted successfully"}

@app.put("/yards/{yard_id}", response_model=schemas.Yard)
def update_yard(yard_id: int, yard: schemas.YardUpdate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    db_yard = crud.update_yard(db, yard_id=yard_id, yard=yard)
    if db_yard is None:
        raise HTTPException(status_code=404, detail="Yard not found")
    background_tasks.add_task(create_on_update_backup)
    return db_yard

# --- Currency Routes ---
@app.post("/currencies/", response_model=schemas.CurrencyOption)
def create_currency(currency: schemas.CurrencyOptionCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    res = crud.create_currency(db=db, currency=currency)
    background_tasks.add_task(create_on_update_backup)
    return res

@app.get("/currencies/", response_model=List[schemas.CurrencyOption])
def read_currencies(db: Session = Depends(get_db)):
    return crud.get_currencies(db)

@app.put("/currencies/{currency_id}", response_model=schemas.CurrencyOption)
def update_currency(currency_id: int, currency: schemas.CurrencyOptionCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    db_curr = crud.update_currency(db, currency_id=currency_id, currency=currency)
    if db_curr is None:
        raise HTTPException(status_code=404, detail="Currency not found")
    background_tasks.add_task(create_on_update_backup)
    return db_curr

@app.delete("/currencies/{currency_id}")
def delete_currency(currency_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    db_curr = crud.delete_currency(db, currency_id)
    if db_curr is None:
        raise HTTPException(status_code=404, detail="Currency not found")
    background_tasks.add_task(create_on_update_backup)
    return {"detail": "Currency deleted successfully"}

# --- Unit Routes ---
@app.post("/units/", response_model=schemas.UnitOption)
def create_unit(unit: schemas.UnitOptionCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    res = crud.create_unit(db=db, unit=unit)
    background_tasks.add_task(create_on_update_backup)
    return res

@app.get("/units/", response_model=List[schemas.UnitOption])
def read_units(db: Session = Depends(get_db)):
    return crud.get_units(db)

@app.put("/units/{unit_id}", response_model=schemas.UnitOption)
def update_unit(unit_id: int, unit: schemas.UnitOptionCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    db_unit = crud.update_unit(db, unit_id=unit_id, unit=unit)
    if db_unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    background_tasks.add_task(create_on_update_backup)
    return db_unit

@app.delete("/units/{unit_id}")
def delete_unit(unit_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    db_unit = crud.delete_unit(db, unit_id)
    if db_unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    background_tasks.add_task(create_on_update_backup)
    return {"detail": "Unit deleted successfully"}

@app.put("/pickups/{pickup_id}", response_model=schemas.Pickup)
def update_pickup(pickup_id: int, pickup: schemas.PickupUpdate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    db_pickup = crud.update_pickup(db, pickup_id=pickup_id, pickup=pickup)
    if db_pickup is None:
        raise HTTPException(status_code=404, detail="Pickup not found")
    background_tasks.add_task(create_on_update_backup)
    return db_pickup

@app.delete("/pickups/{pickup_id}")
def delete_pickup(pickup_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    db_pickup = crud.delete_pickup(db, pickup_id=pickup_id)
    if db_pickup is None:
        raise HTTPException(status_code=404, detail="Pickup not found")
    background_tasks.add_task(create_on_update_backup)
    return {"detail": "Pickup deleted successfully"}

@app.put("/deductions/{deduction_id}", response_model=schemas.Deduction)
def update_deduction(deduction_id: int, deduction: schemas.DeductionUpdate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    db_deduction = crud.update_deduction(db, deduction_id=deduction_id, deduction=deduction)
    if db_deduction is None:
        raise HTTPException(status_code=404, detail="Deduction not found")
    background_tasks.add_task(create_on_update_backup)
    return db_deduction

@app.delete("/deductions/{deduction_id}")
def delete_deduction(deduction_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    db_deduction = crud.delete_deduction(db, deduction_id=deduction_id)
    if db_deduction is None:
        raise HTTPException(status_code=404, detail="Deduction not found")
    background_tasks.add_task(create_on_update_backup)
    return {"detail": "Deduction deleted successfully"}