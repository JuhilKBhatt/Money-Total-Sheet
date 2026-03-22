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
    if pd.isna(val) or str(val).strip() == '':
        return None
    if isinstance(val, datetime):
        return val.date()
    try:
        # dayfirst=True is crucial for parsing Australian DD/MM/YYYY dates securely
        return pd.to_datetime(val, dayfirst=True).date()
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
        header_idx = 0
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
            # Extract columns safely (handles cases where row might be unexpectedly short)
            col_date = row[0] if len(row) > 0 else None
            col_yard = row[1] if len(row) > 1 else None
            col_metal = row[2] if len(row) > 2 else None
            col_kg = row[3] if len(row) > 3 else None
            col_price = row[4] if len(row) > 4 else None
            col_total = row[5] if len(row) > 5 else None
            col_deduct_date = row[6] if len(row) > 6 else None
            col_deduct_notes = row[7] if len(row) > 7 else None
            
            # Identify if this is a "BAL till date" row by scanning all cells in the row
            is_bal_row = any('BAL ' in str(c).upper() for c in row if pd.notna(c))
            if is_bal_row:
                continue
                
            # If the metal column has text, it's a metal item row
            is_metal_row = pd.notna(col_metal) and str(col_metal).strip() != ''
            
            # --- PROCESS DEDUCTIONS ---
            if not is_metal_row:
                amount_val = None
                # Check Total column first, then fallback to Price column if misaligned
                for val in [col_total, col_price]:
                    if pd.notna(val) and str(val).strip() != '':
                        amount_val = val
                        break
                        
                if amount_val is not None:
                    # Strip commas and dollar signs out so float() doesn't crash
                    amount_str = str(amount_val).replace('$', '').replace(',', '').strip()
                    try:
                        amount = float(amount_str)
                        if amount == 0:
                            continue # Skip empty deduction rows
                            
                        # 1. Try to get date from deduction column
                        d_date = parse_date(col_deduct_date)
                        # 2. Fallback to row's primary date column
                        if not d_date and pd.notna(col_date):
                            d_date = parse_date(col_date)
                        # 3. Fallback to inheriting the date from the pickup above it
                        if not d_date and current_pickup:
                            d_date = current_pickup.date
                        # 4. Absolute fallback
                        if not d_date:
                            d_date = datetime.now().date()
                            
                        notes_str = str(col_deduct_notes).strip() if pd.notna(col_deduct_notes) else ""
                        
                        # If deduct_date had text but wasn't a valid date, it's probably notes
                        if pd.notna(col_deduct_date) and not parse_date(col_deduct_date):
                            if notes_str:
                                notes_str = str(col_deduct_date).strip() + " - " + notes_str
                            else:
                                notes_str = str(col_deduct_date).strip()
                                
                        deduction = models.Deduction(
                            company_id=company.id,
                            date=d_date,
                            amount=amount,
                            notes=notes_str,
                            currency="$"
                        )
                        db.add(deduction)
                        db.commit()
                        print(f"   [-] Added Deduction: {amount} on {d_date}")
                    except ValueError:
                        print(f"   [!] Failed to parse deduction amount: {amount_val}")
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
                        currency="$"
                    )
                    db.add(current_pickup)
                    db.commit()
                    db.refresh(current_pickup)
                    print(f"   [🚚] New Pickup: {col_yard} on {p_date}")
                    
            # --- PROCESS METAL ITEMS ---
            if is_metal_row and current_pickup is not None:
                try:
                    # Strip commas from weight
                    kg_str = str(col_kg).replace(',', '').strip() if pd.notna(col_kg) else "0"
                    net_weight = float(kg_str) if kg_str != '' else 0.0
                    
                    # Strip commas and $ from price
                    price = 0.0
                    if pd.notna(col_price) and str(col_price).strip() != '':
                        price_str = str(col_price).replace('$', '').replace(',', '').strip()
                        price = float(price_str)
                        
                    total = net_weight * price
                    
                    metal_item = models.MetalItem(
                        pickup_id=current_pickup.id,
                        metal_name=str(col_metal).strip(),
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
                    print(f"       -> Added Metal: {col_metal} ({net_weight}kg @ ${price})")
                except ValueError:
                    print(f"   [!] Failed to parse metal item: {col_metal} / {col_kg} / {col_price}")
                    
    print("\n✅ Data Migration Complete!")
    db.close()

if __name__ == "__main__":
    excel_file = "SCR Sales Record.xlsx"
    if os.path.exists(excel_file):
        migrate_data(excel_file)
    else:
        print(f"❌ Could not find '{excel_file}'. Please place it in the backend folder.")