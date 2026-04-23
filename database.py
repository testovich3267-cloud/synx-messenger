from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = "mssql+pyodbc://messenger_user:AsTrA134@localhost/Messenger?driver=ODBC+Driver+17+for+SQL+Server"

engine = create_engine(
    DATABASE_URL,
    connect_args={"timeout": 30}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

