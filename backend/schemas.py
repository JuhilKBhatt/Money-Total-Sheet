# ./backend/app/schemas.py
from pydantic import BaseModel
from typing import List, Optional
from datetime import date

# --- Metal Item Schemas ---
class MetalItemBase(BaseModel):
    metal_name: str
    net_weight: float
    price_per_unit: float

class MetalItemCreate(MetalItemBase):
    pass

class MetalItem(MetalItemBase):
    id: int
    pickup_id: int
    total: float

    class Config:
        from_attributes = True

# --- Pickup Schemas ---
class PickupBase(BaseModel):
    date: date
    yard: str
    notes: Optional[str] = None
    deduction: float = 0.0

class PickupCreate(PickupBase):
    company_id: int
    metals: List[MetalItemCreate]

class Pickup(PickupBase):
    id: int
    company_id: int
    total_amount: float
    metals: List[MetalItem]

    class Config:
        from_attributes = True

# --- Deduction Schemas ---
class DeductionBase(BaseModel):
    amount: float
    date: date
    notes: Optional[str] = None

class DeductionCreate(DeductionBase):
    company_id: int

class Deduction(DeductionBase):
    id: int
    company_id: int

    class Config:
        from_attributes = True

# --- Company Schemas ---
class CompanyBase(BaseModel):
    name: str

class CompanyCreate(CompanyBase):
    pass

class Company(CompanyBase):
    id: int
    pickups: List[Pickup] = []
    deductions: List[Deduction] = []

    class Config:
        from_attributes = True

class CompanyUpdate(BaseModel):
    name: Optional[str] = None

class PickupUpdate(BaseModel):
    date: Optional[date] = None
    yard: Optional[str] = None
    notes: Optional[str] = None
    deduction: Optional[float] = None

class MetalItemUpdate(BaseModel):
    metal_name: Optional[str] = None
    net_weight: Optional[float] = None
    price_per_unit: Optional[float] = None

class DeductionUpdate(BaseModel):
    amount: Optional[float] = None
    date: Optional[date] = None
    notes: Optional[str] = None

# --- Yard Schemas ---
class YardBase(BaseModel):
    name: str

class YardCreate(YardBase):
    pass

class Yard(YardBase):
    id: int

    class Config:
        from_attributes = True