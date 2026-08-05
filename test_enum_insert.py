import sys
from sqlalchemy import create_engine, Column, Integer, String, Enum, select
from sqlalchemy.orm import declarative_base, Session
import enum

Base = declarative_base()

class MealType(enum.Enum):
    BREAKFAST = "Breakfast"
    OTHER = "Other"

class Recipe(Base):
    __tablename__ = 'test_recipes'
    id = Column(Integer, primary_key=True)
    meal_type = Column(Enum(MealType))

engine = create_engine('sqlite:///:memory:')
Base.metadata.create_all(engine)

session = Session(engine)
r1 = Recipe(meal_type="Other")
session.add(r1)
session.commit()

r2 = Recipe(meal_type=MealType.OTHER)
session.add(r2)
session.commit()

with engine.connect() as conn:
    print("Raw DB values:")
    result = conn.execute(select(Recipe.__table__.c.meal_type))
    for row in result:
        print(repr(row[0]))

print("\nORM instances:")
for r in session.query(Recipe).all():
    print(r.id, repr(r.meal_type))
