import duckdb
import time

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs;")
# Configure DuckDB httpfs to follow redirects and set memory limit
con.execute("SET enable_http_metadata_cache = true;")

url = "https://huggingface.co/datasets/HiTeckGroup/HiTeckgroop/resolve/refs%2Fconvert%2Fparquet/default/train/0000.parquet"
t0 = time.time()
sql = f"SELECT name, phoneNumber, address FROM read_parquet('{url}') WHERE phoneNumber LIKE '%9431472865%' LIMIT 5"
print("Running query...")
res = con.execute(sql).fetchall()
print("Query took:", time.time() - t0, "sec")
print("Results:", res)
