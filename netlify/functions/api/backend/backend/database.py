from pathlib import Path
from sqlalchemy import create_engine, text

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "market.db"

def get_engine():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return create_engine(f"sqlite:///{DB_PATH}", future=True)

def init_schema():
    # Prices table: one row per date/symbol
    ddl = '''
    CREATE TABLE IF NOT EXISTS prices (
        symbol TEXT NOT NULL,
        date   TEXT NOT NULL,  -- ISO yyyy-mm-dd
        open   REAL,
        high   REAL,
        low    REAL,
        close  REAL,
        adj_close REAL,
        volume INTEGER,
        PRIMARY KEY (symbol, date)
    );
    '''
    eng = get_engine()
    with eng.begin() as con:
        con.execute(text(ddl))
