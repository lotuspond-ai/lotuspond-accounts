#!/bin/sh
# Runs once, when the PostgreSQL volume is first created. Makes the three databases of ADR-0002, each owned by its
# own role, with no access for any other role: the directory, the India account cell, and Hydra's store.
set -eu

make_database() {
  name="$1"
  password="$2"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -v name="$name" -v pw="$password" <<'SQL'
CREATE ROLE :"name" LOGIN PASSWORD :'pw';
CREATE DATABASE :"name" OWNER :"name";
REVOKE ALL ON DATABASE :"name" FROM PUBLIC;
SQL
}

make_database accounts_directory "$DIRECTORY_DB_PASSWORD"
make_database accounts_in "$CELL_IN_DB_PASSWORD"
make_database hydra "$HYDRA_DB_PASSWORD"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -c 'REVOKE ALL ON DATABASE postgres FROM PUBLIC;'
