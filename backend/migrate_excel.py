# ./backend/migrate_excel.py
import os
import pandas as pd
from datetime import datetime
from sqlalchemy.orm import Session
from database import SessionLocal, engine
import models

# Ensure tables exist just in case
models.Base.metadata.create_all(bind=engine)

def parse_date(val):
    if pd.isna(val):
        return None
    if isinstance(val, datetime):
        return val.date()
    try:
        return pd.to_datetime(val).date()
    except Exception:
        return None

def migrate_data(file_path: str):
    db: Session = SessionLocal()
    
    print(f"📂 Loading Excel file: {file_path}")
    xls = pd.ExcelFile(file_path)
    
    for sheet_name in xls.sheet_names:
        print(f"\n🏢 Processing Company/Sheet: {sheet_name}")
        df = pd.read_excel(xls, sheet_name=sheet_name, header=None)
        
        # 1. Find the header row (the row starting with 'Date')
        header_idx = 1
        for i, row in df.iterrows():
            if str(row[0]).strip().lower() == 'date':
                header_idx = i
                break
                
        # 2. Get or Create Company
        company_name = sheet_name.strip()
        company = db.query(models.Company).filter(models.Company.name == company_name).first()
        if not company:
            company = models.Company(name=company_name)
            db.add(company)
            db.commit()
            db.refresh(company)
            print(f"   [+] Created new company: {company.name}")
        
        # Slice dataframe to only data rows
        data_df = df.iloc[header_idx + 1:].reset_index(drop=True)
        
        current_pickup = None
        
        for index, row in data_df.iterrows():
            col_date = row[0]
            col_yard = row[1]
            col_metal = row[2]
            col_kg = row[3]
            col_price = row[4]
            col_total = row[5]
            # Deductions are located in columns 6 (Date) and 7 (Notes)
            col_deduct_date = row[6] if len(row) > 6 else None
            col_deduct_notes = row[7] if len(row) > 7 else None
            
            # Skip empty rows or "BAL till date >" rows
            if pd.notna(col_yard) and 'BAL till date >' in str(col_yard):
                continue
                
            # --- PROCESS DEDUCTIONS ---
            if pd.notna(col_total) and pd.notna(col_deduct_date) and str(col_deduct_date).strip() != '':
                d_date = parse_date(col_deduct_date)
                if d_date:
                    try:
                        amount = float(col_total)
                        deduction = models.Deduction(
                            company_id=company.id,
                            date=d_date,
                            amount=amount,
                            notes=str(col_deduct_notes) if pd.notna(col_deduct_notes) else "",
                            currency="$"  # Defaulting legacy data to $
                        )
                        db.add(deduction)
                        db.commit()
                        print(f"   [-] Added Deduction: {amount} on {d_date}")
                    except ValueError:
                        print(f"   [!] Failed to parse deduction amount: {col_total}")
                continue
            
            # --- PROCESS PICKUP START ---
            if pd.notna(col_date) and pd.notna(col_yard) and str(col_date).strip() != '':
                p_date = parse_date(col_date)
                if p_date:
                    current_pickup = models.Pickup(
                        company_id=company.id,
                        date=p_date,
                        yard=str(col_yard),
                        notes="",
                        deduction=0.0,
                        total_amount=0.0,
                        currency="$"  # Defaulting legacy data to $
                    )
                    db.add(current_pickup)
                    db.commit()
                    db.refresh(current_pickup)
                    print(f"   [🚚] New Pickup: {col_yard} on {p_date}")
                    
            # --- PROCESS METAL ITEMS ---
            # Triggers if there is a metal name and a weight. Applies to the current_pickup block.
            if pd.notna(col_metal) and pd.notna(col_kg) and current_pickup is not None:
                try:
                    net_weight = float(col_kg)
                    price = float(col_price) if pd.notna(col_price) else 0.0
                    total = net_weight * price
                    
                    metal_item = models.MetalItem(
                        pickup_id=current_pickup.id,
                        metal_name=str(col_metal),
                        net_weight=net_weight,
                        weight_unit="kg",
                        price_per_unit=price,
                        total=total
                    )
                    db.add(metal_item)
                    db.commit()
                    
                    # Update pickup running total
                    current_pickup.total_amount += total
                    db.commit()
                    print(f"       -> Added Metal: {col_metal} ({net_weight}kg)")
                except ValueError:
                    print(f"   [!] Failed to parse metal item: {col_metal} / {col_kg} / {col_price}")
                    
    print("\n✅ Data Migration Complete!")
    db.close()

if __name__ == "__main__":
    # Ensure your Excel file is placed in the backend folder!
    excel_file = "SCR Sales Record.xlsx"
    
    if os.path.exists(excel_file):
        migrate_data(excel_file)
    else:
        print(f"❌ Could not find '{excel_file}'. Please place it in the backend folder.")