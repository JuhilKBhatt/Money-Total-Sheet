# ./backend/app/services/crud.py
from sqlalchemy.orm import Session
import models, schemas

def get_companies(db: Session):
    return db.query(models.Company).all()

def create_company(db: Session, company: schemas.CompanyCreate):
    db_company = models.Company(name=company.name)
    db.add(db_company)
    db.commit()
    db.refresh(db_company)
    return db_company

def get_pickups_by_company(db: Session, company_id: int):
    return db.query(models.Pickup).filter(models.Pickup.company_id == company_id).all()

def create_pickup(db: Session, pickup: schemas.PickupCreate):
    # 1. Create the base pickup record
    db_pickup = models.Pickup(
        company_id=pickup.company_id,
        date=pickup.date,
        yard=pickup.yard,
        notes=pickup.notes,
        deduction=pickup.deduction,
        total_amount=0.0 # Will calculate below
    )
    db.add(db_pickup)
    db.commit()
    db.refresh(db_pickup)

    # 2. Iterate through metals, calculate their totals, and sum the gross total
    gross_total = 0.0
    for metal_data in pickup.metals:
        metal_total = metal_data.net_weight * metal_data.price_per_unit
        gross_total += metal_total
        
        db_metal = models.MetalItem(
            pickup_id=db_pickup.id,
            metal_name=metal_data.metal_name,
            net_weight=metal_data.net_weight,
            price_per_unit=metal_data.price_per_unit,
            total=metal_total
        )
        db.add(db_metal)

    # 3. Calculate final pickup total (Gross - Deductions)
    db_pickup.total_amount = gross_total - pickup.deduction
    
    # 4. Commit all metals and the updated pickup total
    db.commit()
    db.refresh(db_pickup)
    return db_pickup

def create_deduction(db: Session, deduction: schemas.DeductionCreate):
    db_deduction = models.Deduction(
        company_id=deduction.company_id,
        amount=deduction.amount,
        date=deduction.date,
        notes=deduction.notes
    )
    db.add(db_deduction)
    db.commit()
    db.refresh(db_deduction)
    return db_deduction

def get_deductions_by_company(db: Session, company_id: int):
    return db.query(models.Deduction).filter(models.Deduction.company_id == company_id).all()

# --- Helper to Recalculate Pickup Total ---
def recalculate_pickup_total(db: Session, pickup_id: int):
    db_pickup = db.query(models.Pickup).filter(models.Pickup.id == pickup_id).first()
    if not db_pickup:
        return None
    
    gross_total = sum([metal.total for metal in db_pickup.metals])
    db_pickup.total_amount = gross_total - db_pickup.deduction
    db.commit()
    db.refresh(db_pickup)
    return db_pickup

# --- Company Edit/Delete ---
def update_company(db: Session, company_id: int, company: schemas.CompanyUpdate):
    db_company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if db_company:
        if company.name is not None:
            db_company.name = company.name
        db.commit()
        db.refresh(db_company)
    return db_company

def delete_company(db: Session, company_id: int):
    db_company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if db_company:
        db.delete(db_company)
        db.commit()
    return db_company

# --- Pickup Edit/Delete ---
def update_pickup(db: Session, pickup_id: int, pickup: schemas.PickupUpdate):
    db_pickup = db.query(models.Pickup).filter(models.Pickup.id == pickup_id).first()
    if db_pickup:
        if pickup.date is not None:
            db_pickup.date = pickup.date
        if pickup.yard is not None:
            db_pickup.yard = pickup.yard
        if pickup.notes is not None:
            db_pickup.notes = pickup.notes
        if pickup.deduction is not None:
            db_pickup.deduction = pickup.deduction
            
        db.commit()
        # Recalculate total in case deduction was changed
        return recalculate_pickup_total(db, pickup_id)
    return None

def delete_pickup(db: Session, pickup_id: int):
    db_pickup = db.query(models.Pickup).filter(models.Pickup.id == pickup_id).first()
    if db_pickup:
        db.delete(db_pickup)
        db.commit()
    return db_pickup

# --- MetalItem Edit/Delete (and Create for existing pickups) ---
def create_metal_item(db: Session, pickup_id: int, item: schemas.MetalItemCreate):
    metal_total = item.net_weight * item.price_per_unit
    db_metal = models.MetalItem(
        pickup_id=pickup_id,
        metal_name=item.metal_name,
        net_weight=item.net_weight,
        price_per_unit=item.price_per_unit,
        total=metal_total
    )
    db.add(db_metal)
    db.commit()
    db.refresh(db_metal)
    recalculate_pickup_total(db, pickup_id)
    return db_metal

def update_metal_item(db: Session, item_id: int, item: schemas.MetalItemUpdate):
    db_metal = db.query(models.MetalItem).filter(models.MetalItem.id == item_id).first()
    if db_metal:
        if item.metal_name is not None:
            db_metal.metal_name = item.metal_name
        if item.net_weight is not None:
            db_metal.net_weight = item.net_weight
        if item.price_per_unit is not None:
            db_metal.price_per_unit = item.price_per_unit
            
        # Recalculate this specific metal's total
        db_metal.total = db_metal.net_weight * db_metal.price_per_unit
        db.commit()
        db.refresh(db_metal)
        
        # Recalculate the parent pickup's total
        recalculate_pickup_total(db, db_metal.pickup_id)
    return db_metal

def delete_metal_item(db: Session, item_id: int):
    db_metal = db.query(models.MetalItem).filter(models.MetalItem.id == item_id).first()
    if db_metal:
        pickup_id = db_metal.pickup_id
        db.delete(db_metal)
        db.commit()
        # Recalculate the parent pickup's total
        recalculate_pickup_total(db, pickup_id)
    return db_metal

# --- Deduction Edit/Delete ---
def update_deduction(db: Session, deduction_id: int, deduction: schemas.DeductionUpdate):
    db_deduction = db.query(models.Deduction).filter(models.Deduction.id == deduction_id).first()
    if db_deduction:
        if deduction.amount is not None:
            db_deduction.amount = deduction.amount
        if deduction.date is not None:
            db_deduction.date = deduction.date
        if deduction.notes is not None:
            db_deduction.notes = deduction.notes
        db.commit()
        db.refresh(db_deduction)
    return db_deduction

def delete_deduction(db: Session, deduction_id: int):
    db_deduction = db.query(models.Deduction).filter(models.Deduction.id == deduction_id).first()
    if db_deduction:
        db.delete(db_deduction)
        db.commit()
    return db_deduction

# --- Yard Operations ---
def get_yards(db: Session):
    return db.query(models.Yard).all()

def create_yard(db: Session, yard: schemas.YardCreate):
    db_yard = models.Yard(name=yard.name)
    db.add(db_yard)
    db.commit()
    db.refresh(db_yard)
    return db_yard

def delete_yard(db: Session, yard_id: int):
    db_yard = db.query(models.Yard).filter(models.Yard.id == yard_id).first()
    if db_yard:
        db.delete(db_yard)
        db.commit()
    return db_yard

def update_yard(db: Session, yard_id: int, yard: schemas.YardUpdate):
    db_yard = db.query(models.Yard).filter(models.Yard.id == yard_id).first()
    
    if db_yard:
        if yard.name is not None and yard.name != db_yard.name:
            old_yard_name = db_yard.name
            new_yard_name = yard.name
            
            # 1. Update the name in the Yards table
            db_yard.name = new_yard_name
            
            # 2. Automatically find and update ALL pickups that used the old yard name
            db.query(models.Pickup)\
              .filter(models.Pickup.yard == old_yard_name)\
              .update({"yard": new_yard_name})
              
        db.commit()
        db.refresh(db_yard)
        
    return db_yard