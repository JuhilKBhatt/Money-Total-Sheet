# ./backend/models.py
from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey, Text
from sqlalchemy.orm import relationship
from database import Base

class Company(Base):
    __tablename__ = "companies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)

    pickups = relationship("Pickup", back_populates="company")
    deductions = relationship("Deduction", back_populates="company")

class Pickup(Base):
    __tablename__ = "pickups"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"))
    date = Column(Date, index=True)
    yard = Column(String)
    notes = Column(Text, nullable=True)
    deduction = Column(Float, default=0.0) 
    total_amount = Column(Float, default=0.0)
    currency = Column(String(10), default="$")

    company = relationship("Company", back_populates="pickups")
    metals = relationship("MetalItem", back_populates="pickup", cascade="all, delete-orphan")

class MetalItem(Base):
    __tablename__ = "metal_items"

    id = Column(Integer, primary_key=True, index=True)
    pickup_id = Column(Integer, ForeignKey("pickups.id"))
    metal_name = Column(String, index=True)
    net_weight = Column(Float)
    weight_unit = Column(String(10), default="kg")
    price_per_unit = Column(Float)
    total = Column(Float) 

    pickup = relationship("Pickup", back_populates="metals")

class Deduction(Base):
    __tablename__ = "deductions"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"))
    date = Column(Date, index=True)
    amount = Column(Float)
    notes = Column(Text, nullable=True)
    currency = Column(String(10), default="$")

    company = relationship("Company", back_populates="deductions")

class Yard(Base):
    __tablename__ = "yards"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)

class CurrencyOption(Base):
    __tablename__ = "currency_options"
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(10), unique=True)
    symbol = Column(String(5))
    label = Column(String(20))

class UnitOption(Base):
    __tablename__ = "unit_options"
    id = Column(Integer, primary_key=True, index=True)
    value = Column(String(10), unique=True)
    label = Column(String(20))